import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtemp,rm,writeFile,mkdir,readdir} from 'node:fs/promises';
import path from 'node:path';import {tmpdir} from 'node:os';
import Database from 'better-sqlite3';
import {openDatabase} from './db/client.js';
import {StateRepository} from './db/repositories/StateRepository.js';
import {ModelReadinessRepository} from './db/repositories/ModelReadinessRepository.js';
import {BackupService} from './services/BackupService.js';
const roots:string[]=[];afterEach(async()=>{vi.restoreAllMocks();await Promise.all(roots.splice(0).map(x=>rm(x,{recursive:true,force:true})))});
describe('persistent controls',()=>{
 it('keeps paused state across database close and reopen',async()=>{const root=await mkdtemp(path.join(tmpdir(),'state-'));roots.push(root);const file=path.join(root,'bot.db');let db=openDatabase(file);new StateRepository(db).setPaused(true);db.close();db=openDatabase(file);expect(new StateRepository(db).isPaused()).toBe(true);db.close()});
 it('tracks unchanged model datasets without duplicate readiness',()=>{const db=openDatabase(':memory:'),ready=new ModelReadinessRepository(db),rows=['a'];expect(ready.detect('g','u',rows)).toBe(true);ready.rebuilt('g','u',rows);expect(ready.detect('g','u',rows)).toBe(false);expect(ready.detect('g','u',['high',...rows])).toBe(true);db.close()});
 it('creates an integrity-checked snapshot and enforces retention',async()=>{const root=await mkdtemp(path.join(tmpdir(),'backup-'));roots.push(root);const data=path.join(root,'data'),backups=path.join(data,'backups');await mkdir(path.join(data,'training'),{recursive:true});await writeFile(path.join(data,'training','sample.wav'),'audio');const db=openDatabase(path.join(data,'bot.db')),state=new StateRepository(db),service=new BackupService(db,state,backups,1,data);db.prepare("INSERT INTO voices(guild_id,owner_id,alias,created_at,updated_at) VALUES('g','u','voice',1,1)").run();await service.run();await new Promise(r=>setTimeout(r,2));await service.run();const names=(await readdir(backups)).filter(x=>x.startsWith('backup-'));expect(names).toHaveLength(1);const snapshot=new Database(path.join(backups,names[0]!,'bot.db'),{readonly:true});expect(snapshot.prepare('SELECT alias FROM voices').pluck().get()).toBe('voice');expect(snapshot.pragma('integrity_check',{simple:true})).toBe('ok');snapshot.close();expect(state.backupStatus().last_success_at).not.toBeNull();db.close()});
 it('records backup failures without rejecting the runtime call',async()=>{const db=openDatabase(':memory:'),state=new StateRepository(db),service=new BackupService(db,state,'/dev/null/backups',1,'/data');await expect(service.run()).resolves.toBeUndefined();expect(state.backupStatus().last_failure).toBeTruthy();db.close()});
});
