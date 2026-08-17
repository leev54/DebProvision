/** A process-wide serialization barrier for managed storage snapshots and mutations. */
export class StorageCoordinator {
  private tail:Promise<void>=Promise.resolve();
  async acquire(){let release!:()=>void;const previous=this.tail;this.tail=new Promise(resolve=>release=resolve);await previous;return release;}
  async run<T>(operation:()=>Promise<T>):Promise<T>{const release=await this.acquire();try{return await operation();}finally{release();}}
}
