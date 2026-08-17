import type {DB} from '../client.js';

export class StateRepository {
  constructor(private db:DB){}
  isPaused(){return !!(this.db.prepare('SELECT paused FROM application_state WHERE id=1').get() as {paused:number}).paused;}
  setPaused(paused:boolean){this.db.prepare('UPDATE application_state SET paused=?,updated_at=? WHERE id=1').run(+paused,Date.now());}
  backupStatus(){return this.db.prepare('SELECT * FROM backup_status WHERE id=1').get() as {last_success_at:number|null;last_success_path:string|null;last_failure_at:number|null;last_failure:string|null};}
  backupSucceeded(file:string){this.db.prepare('UPDATE backup_status SET last_success_at=?,last_success_path=?,last_failure_at=NULL,last_failure=NULL WHERE id=1').run(Date.now(),file);}
  backupFailed(error:unknown){const message=error instanceof Error?error.message:'Backup failed';this.db.prepare('UPDATE backup_status SET last_failure_at=?,last_failure=? WHERE id=1').run(Date.now(),message.slice(0,500));}
}
