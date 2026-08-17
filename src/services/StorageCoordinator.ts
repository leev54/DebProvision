/** A FIFO barrier shared by managed-file mutations and consistent backups. */
export class StorageCoordinator {
  private tail:Promise<void>=Promise.resolve();
  async acquire(){let release!:()=>void;const previous=this.tail;this.tail=new Promise<void>(resolve=>release=resolve);await previous;return release;}
  async exclusive<T>(operation:()=>Promise<T>|T):Promise<T>{
    const release=await this.acquire();
    try{return await operation();}finally{release();}
  }
}
