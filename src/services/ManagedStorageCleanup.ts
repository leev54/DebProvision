import type {SampleRepository} from '../db/repositories/SampleRepository.js';
import {logger} from '../utils/logger.js';
export class ManagedStorageCleanup {
  private timer?:NodeJS.Timeout;private stopping=false;private inFlight?:Promise<void>;
  constructor(private samples:SampleRepository,private root='/data/training',private intervalMs=10*60_000){}
  start(){if(this.timer||this.stopping)return;this.timer=setInterval(()=>this.run(),this.intervalMs);this.timer.unref();}
  run(){if(this.stopping||this.inFlight)return this.inFlight??Promise.resolve();this.inFlight=(async()=>{const queued=await this.samples.cleanupQueuedFiles();if(queued.cleanupFailures.length)logger.warn({count:queued.cleanupFailures.length},'managed local-file cleanup remains pending');const reconciliation=await this.samples.reconcileManagedStorage(this.root);const failures='cleanupFailures' in reconciliation?(reconciliation.cleanupFailures?.length??0):0;if(failures)logger.warn({count:failures},'managed orphan cleanup encountered failures');})().catch(error=>logger.error({err:error},'managed storage reconciliation failed')).finally(()=>{this.inFlight=undefined});return this.inFlight;}
  async stopAndDrain(){this.stopping=true;if(this.timer)clearInterval(this.timer);this.timer=undefined;await this.inFlight;}
}
