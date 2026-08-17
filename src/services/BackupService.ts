import Database from 'better-sqlite3';
import {cp,mkdir,readdir,rename,rm,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {DB} from '../db/client.js';
import type {StateRepository} from '../db/repositories/StateRepository.js';
import {logger} from '../utils/logger.js';
import type {StorageCoordinator} from './StorageCoordinator.js';

/** Produces atomic, self-contained local snapshots without copying a live WAL database. */
export class BackupService {
  private timer?:NodeJS.Timeout;private running?:Promise<void>;
  constructor(private db:DB,private state:StateRepository,private directory:string,private retention:number,private dataRoot='/data',private storage?:StorageCoordinator){}
  start(intervalMs:number){this.timer=setInterval(()=>void this.run(),intervalMs);this.timer.unref();}
  async stopAndDrain(){if(this.timer)clearInterval(this.timer);await this.running;}
  run(){if(this.running)return this.running;this.running=(this.storage?this.storage.run(()=>this.create()):this.create()).catch(error=>{this.state.backupFailed(error);logger.error({err:error},'automatic backup failed');}).finally(()=>this.running=undefined);return this.running;}
  private async create(){
    await mkdir(this.directory,{recursive:true});const name=`backup-${new Date().toISOString().replace(/[:.]/g,'-')}`,temporary=path.join(this.directory,`.${name}.tmp`),destination=path.join(this.directory,name);await rm(temporary,{recursive:true,force:true});await mkdir(temporary,{recursive:true});
    try{
      const snapshot=path.join(temporary,'bot.db');await this.db.backup(snapshot);const check=new Database(snapshot,{readonly:true});try{const result=check.pragma('integrity_check',{simple:true});if(result!=='ok')throw new Error(`SQLite snapshot integrity check failed: ${String(result)}`);}finally{check.close();}
      const training=path.join(this.dataRoot,'training');if(await stat(training).then(x=>x.isDirectory(),()=>false))await cp(training,path.join(temporary,'training'),{recursive:true,errorOnExist:true});
      await writeFile(path.join(temporary,'manifest.json'),JSON.stringify({version:1,createdAt:new Date().toISOString(),contents:['bot.db','training/']},null,2),{mode:0o600});await rename(temporary,destination);this.state.backupSucceeded(destination);await this.prune();logger.info({backup:name},'automatic backup completed');
    }catch(error){await rm(temporary,{recursive:true,force:true});throw error;}
  }
  private async prune(){const entries=(await readdir(this.directory,{withFileTypes:true})).filter(x=>x.isDirectory()&&x.name.startsWith('backup-')).sort((a,b)=>b.name.localeCompare(a.name));await Promise.all(entries.slice(this.retention).map(x=>rm(path.join(this.directory,x.name),{recursive:true,force:true})));}
}
