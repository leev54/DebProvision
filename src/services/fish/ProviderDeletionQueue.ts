import type {DB} from '../../db/client.js';
import type {VoiceProvider} from './VoiceProvider.js';
import {logger} from '../../utils/logger.js';
export class ProviderDeletionQueue {
  private timer?:NodeJS.Timeout;private running?:Promise<void>;
  constructor(private db:DB,private provider:VoiceProvider,private intervalMs=60_000,private now=()=>Date.now()){}
  enqueue(remoteId:string){const now=this.now();this.db.prepare('INSERT INTO pending_provider_deletions(remote_id,next_retry_at,created_at) VALUES(?,?,?) ON CONFLICT(remote_id) DO NOTHING').run(remoteId,now,now);}
  async delete(remoteId:string){this.enqueue(remoteId);return this.attempt(remoteId);}
  async attempt(remoteId:string){try{await this.provider.deleteVoice(remoteId);this.db.prepare('DELETE FROM pending_provider_deletions WHERE remote_id=?').run(remoteId);return true;}catch(error){const row=this.db.prepare('SELECT attempts FROM pending_provider_deletions WHERE remote_id=?').get(remoteId) as {attempts:number}|undefined;const attempts=(row?.attempts??0)+1;const delay=Math.min(60*60_000,1000*2**Math.min(attempts-1,12));this.db.prepare('UPDATE pending_provider_deletions SET attempts=?,last_error=?,next_retry_at=? WHERE remote_id=?').run(attempts,error instanceof Error?error.message:String(error),this.now()+delay,remoteId);logger.error({err:error,attempts},'provider voice cleanup queued for retry');return false;}}
  async retryDue(){if(this.running)return this.running;this.running=(async()=>{const rows=this.db.prepare('SELECT remote_id FROM pending_provider_deletions WHERE next_retry_at<=? ORDER BY next_retry_at').all(this.now()) as {remote_id:string}[];for(const row of rows)await this.attempt(row.remote_id);})().finally(()=>{this.running=undefined;});return this.running;}
  start(){void this.retryDue();this.timer=setInterval(()=>void this.retryDue(),this.intervalMs);this.timer.unref();}
  async stop(){if(this.timer)clearInterval(this.timer);await this.running;}
}
