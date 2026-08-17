import {createHash} from 'node:crypto';
import type {DB} from '../client.js';
import type {ScoredSample} from '../../training/types.js';
export class ModelReadinessRepository {
  constructor(private db:DB){}
  version(samples:ScoredSample[]){return createHash('sha256').update(samples.map(x=>x.id).sort().join('\n')).digest('hex');}
  detect(guild:string,owner:string,samples:ScoredSample[]){if(!samples.length){this.db.prepare('DELETE FROM model_readiness WHERE guild_id=? AND owner_id=?').run(guild,owner);return false;}const version=this.version(samples),row=this.db.prepare('SELECT rebuilt_version FROM model_readiness WHERE guild_id=? AND owner_id=?').get(guild,owner) as {rebuilt_version:string|null}|undefined,ready=row?.rebuilt_version!==version;this.db.prepare('INSERT INTO model_readiness(guild_id,owner_id,dataset_version,rebuilt_version,ready,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(guild_id,owner_id) DO UPDATE SET dataset_version=excluded.dataset_version,ready=excluded.ready,updated_at=excluded.updated_at').run(guild,owner,version,row?.rebuilt_version??null,+ready,Date.now());return ready;}
  rebuilt(guild:string,owner:string,samples:ScoredSample[]){const version=this.version(samples);this.db.prepare('INSERT INTO model_readiness(guild_id,owner_id,dataset_version,rebuilt_version,ready,updated_at) VALUES(?,?,?,?,0,?) ON CONFLICT(guild_id,owner_id) DO UPDATE SET dataset_version=excluded.dataset_version,rebuilt_version=excluded.rebuilt_version,ready=0,updated_at=excluded.updated_at').run(guild,owner,version,version,Date.now());}
  isReady(guild:string,owner:string){return !!(this.db.prepare('SELECT ready FROM model_readiness WHERE guild_id=? AND owner_id=?').get(guild,owner) as {ready:number}|undefined)?.ready;}
}
