export interface QueueItem {id:string;label:string;play:(signal:AbortSignal)=>Promise<void>;cleanup?:()=>Promise<void>}
export class PlaybackQueue {
  private items:QueueItem[]=[];private active?:QueueItem;private controller?:AbortController;private running=false;
  enqueue(item:QueueItem){this.items.push(item);void this.drain();}
  list(){return [this.active,...this.items].filter(Boolean) as QueueItem[];}
  skip(){if(!this.active)return false;this.controller?.abort();return true;}
  async stop(){this.items=[];this.controller?.abort();}
  private async drain(){if(this.running)return;this.running=true;while((this.active=this.items.shift())){const x=this.active;this.controller=new AbortController();try{await x.play(this.controller.signal);}catch(e){if(!this.controller.signal.aborted)throw e;}finally{await x.cleanup?.();if(this.active===x)this.active=undefined;}}this.controller=undefined;this.running=false;}
}
