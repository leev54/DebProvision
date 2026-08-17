import type {DB} from '../../db/client.js';
import type {VoiceProvider} from './VoiceProvider.js';
import {FishApiError} from './FishClient.js';
import {logger} from '../../utils/logger.js';

export type ProviderDeletionOutcome='deleted'|'retry_scheduled'|'permanent_failure';
export class ProviderDeletionQueue {
  static readonly CRASH_RECOVERY_HOLD_MS=5*60_000;
  private timer?:NodeJS.Timeout;private retryRun?:Promise<void>;private stopping=false;private flights=new Map<string,Promise<ProviderDeletionOutcome>>();private operations=new Set<Promise<unknown>>();
  constructor(private db:DB,private provider:VoiceProvider,private intervalMs=60_000,private now=()=>Date.now()){}
  enqueue(remoteId:string){const now=this.now();this.db.prepare('INSERT INTO pending_provider_deletions(remote_id,next_retry_at,created_at,retryable,ready_at) VALUES(?,?,?,1,?) ON CONFLICT(remote_id) DO UPDATE SET ready_at=COALESCE(pending_provider_deletions.ready_at,excluded.ready_at),next_retry_at=MIN(pending_provider_deletions.next_retry_at,excluded.next_retry_at)').run(remoteId,now,now,now);}
  arm(remoteId:string){const now=this.now();this.db.prepare('UPDATE pending_provider_deletions SET ready_at=?,next_retry_at=? WHERE remote_id=?').run(now,now,remoteId);}
  async delete(remoteId:string){this.enqueue(remoteId);return this.stopping?'retry_scheduled':this.attempt(remoteId);}
  attempt(remoteId:string){if(this.stopping){this.enqueue(remoteId);return Promise.resolve('retry_scheduled' as const);}const existing=this.flights.get(remoteId);if(existing)return existing;const work=this.perform(remoteId).finally(()=>this.flights.delete(remoteId));this.flights.set(remoteId,work);this.track(work);return work;}
  private async perform(remoteId:string){try{await this.provider.deleteVoice(remoteId);this.db.prepare('DELETE FROM pending_provider_deletions WHERE remote_id=?').run(remoteId);return 'deleted' as const;}catch(error){const row=this.db.prepare('SELECT attempts FROM pending_provider_deletions WHERE remote_id=?').get(remoteId) as {attempts:number}|undefined;const attempts=(row?.attempts??0)+1;const retryable=!(error instanceof FishApiError)||error.retryable;const delay=Math.min(60*60_000,1000*2**Math.min(attempts-1,12));this.db.prepare('UPDATE pending_provider_deletions SET attempts=?,last_error=?,next_retry_at=?,retryable=? WHERE remote_id=?').run(attempts,error instanceof FishApiError&&error.diagnostic?`${error.message}: ${error.diagnostic}`:error instanceof Error?error.message:String(error),this.now()+delay,+retryable,remoteId);logger.error({err:error,attempts,retryable,remoteId},retryable?'provider voice cleanup queued for retry':'provider voice cleanup requires operator intervention');return retryable?'retry_scheduled' as const:'permanent_failure' as const;}}
  retryDue(){if(this.stopping)return Promise.resolve();if(this.retryRun)return this.retryRun;const run=(async()=>{const now=this.now();const rows=this.db.prepare('SELECT remote_id FROM pending_provider_deletions WHERE retryable=1 AND next_retry_at<=? AND (ready_at IS NOT NULL OR created_at<=?) ORDER BY next_retry_at').all(now,now-ProviderDeletionQueue.CRASH_RECOVERY_HOLD_MS) as {remote_id:string}[];for(const row of rows)await this.attempt(row.remote_id);})();this.retryRun=run.finally(()=>{this.retryRun=undefined;});this.track(this.retryRun);return this.retryRun;}
  private track<T>(operation:Promise<T>){this.operations.add(operation);void operation.then(()=>this.operations.delete(operation),()=>this.operations.delete(operation));}
  start(){if(this.stopping)throw new Error('Provider deletion queue has stopped');void this.retryDue();this.timer=setInterval(()=>void this.retryDue(),this.intervalMs);this.timer.unref();}
  async stopAndDrain(){this.stopping=true;if(this.timer)clearInterval(this.timer);this.timer=undefined;while(this.operations.size)await Promise.allSettled([...this.operations]);}
  async stop(){await this.stopAndDrain();}
}
