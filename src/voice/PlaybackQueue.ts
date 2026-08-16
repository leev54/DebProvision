import {logger} from '../utils/logger.js';
export interface QueueItem {id:string;label:string;groupId?:string;play:(signal:AbortSignal)=>Promise<void>;cleanup?:()=>Promise<void>}
export class PlaybackQueue {
  private items:QueueItem[]=[];private active?:QueueItem;private controller?:AbortController;private running=false;private draining?:Promise<void>;
  enqueue(item:QueueItem){this.items.push(item);this.kick();}
  list(){return [this.active,...this.items].filter(Boolean) as QueueItem[];}
  skip(){if(!this.active)return false;this.controller?.abort();return true;}
  cancelGroup(groupId:string){const before=this.items.length;this.items=this.items.filter(x=>x.groupId!==groupId);if(this.active?.groupId===groupId)this.controller?.abort();return before-this.items.length+(this.active?.groupId===groupId?1:0);}
  async stop(){this.items=[];this.controller?.abort();await this.draining;}
  private kick(){if(this.draining)return;this.draining=this.drain().catch(err=>logger.error({err},'playback queue drain failed')).finally(()=>{this.draining=undefined;if(this.items.length)this.kick();});}
  private async drain(){
    if(this.running)return;this.running=true;
    try{while((this.active=this.items.shift())){const x=this.active;const controller=new AbortController();this.controller=controller;try{await x.play(controller.signal);}catch(err){if(!controller.signal.aborted)logger.error({err,itemId:x.id,label:x.label},'playback item failed');}finally{try{await x.cleanup?.();}catch(err){logger.error({err,itemId:x.id},'playback cleanup failed');}if(this.controller===controller)this.controller=undefined;if(this.active===x)this.active=undefined;}}}
    finally{this.active=undefined;this.controller=undefined;this.running=false;}
  }
}
