import {access,mkdir,readdir,rm,stat} from 'node:fs/promises';import path from 'node:path';
import type {DB} from '../client.js';
import type {ScoredSample} from '../../training/types.js';
export interface StorageReservation {bind(filePath:string):void;commit():void;release():void}

export class SampleRepository {
  private reservationTail:Promise<void>=Promise.resolve();
  private reservedBytes=0;private reservedFiles=new Set<string>();
  constructor(private db:DB){}
  save(guild:string,s:ScoredSample){
    if(!s.filePath)throw new Error('A captured sample must have a file');
    this.db.prepare(`INSERT INTO samples(id,guild_id,voice_owner_id,file_path,duration_ms,captured_at,transcript,quality_score,speech_ratio,rms,peak,clipping_ratio,snr_estimate,reasons,is_best,exceptional,selected,review_status,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(s.id,guild,s.ownerId,s.filePath,Math.round(s.durationMs),s.capturedAt,s.transcript??null,s.qualityScore,s.speechRatio,s.rms,s.peak,s.clippingRatio,s.snrEstimate,JSON.stringify(s.reasons),+s.isBestSample,+s.exceptionalCandidate,+s.selectedForRebuild,s.reviewStatus??'pending',+s.active);
  }
  async remove(id:string){const sample=this.get(id);this.db.transaction(()=>{this.db.prepare('DELETE FROM sample_reviews WHERE sample_id=?').run(id);this.db.prepare('DELETE FROM samples WHERE id=?').run(id);})();if(sample?.filePath)await rm(sample.filePath,{force:true});}
  list(guild:string,owner?:string,active=true){const rows=this.db.prepare(`SELECT * FROM samples WHERE guild_id=? ${owner?'AND voice_owner_id=?':''} ${active?'AND active=1':''} ORDER BY quality_score DESC`).all(...(owner?[guild,owner]:[guild])) as any[];return rows.map(row=>this.map(row));}
  eligible(guild:string,owner:string){return this.list(guild,owner).filter(s=>s.reviewStatus!=='rejected');}
  pendingReviewCandidates(guild:string,owner:string){return this.list(guild,owner).filter(s=>s.reviewStatus==='pending');}
  get(id:string){const row=this.db.prepare('SELECT * FROM samples WHERE id=?').get(id) as any;return row?this.map(row):undefined;}
  review(id:string,reviewer:string,decision:'accepted'|'rejected'){const value=decision==='accepted';return this.db.transaction(()=>{const changed=this.db.prepare("UPDATE samples SET selected=?,is_best=?,review_status=? WHERE id=? AND active=1 AND review_status='pending'").run(+value,+value,decision,id).changes;if(changed)this.db.prepare('INSERT INTO sample_reviews(sample_id,reviewer_id,decision,created_at) VALUES(?,?,?,?)').run(id,reviewer,decision,Date.now());return changed;})();}
  history(guild:string,owner:string){return this.db.prepare('SELECT r.*,s.quality_score,s.duration_ms FROM sample_reviews r JOIN samples s ON s.id=r.sample_id WHERE s.guild_id=? AND s.voice_owner_id=? ORDER BY r.created_at DESC LIMIT 20').all(guild,owner) as any[];}
  async clear(guild:string,owner?:string){return this.purge(guild,owner);}
  async purge(guild:string,owner?:string){const samples=this.list(guild,owner,false);this.db.transaction(()=>{const reviews=this.db.prepare('DELETE FROM sample_reviews WHERE sample_id=?');const rows=this.db.prepare('DELETE FROM samples WHERE id=?');for(const sample of samples){reviews.run(sample.id);rows.run(sample.id);}})();await Promise.all(samples.map(s=>s.filePath?rm(s.filePath,{force:true}):undefined));return samples.length;}
  async deactivate(ids:string[]){const samples=ids.map(id=>this.get(id)).filter((s):s is ScoredSample=>!!s);const stmt=this.db.prepare('UPDATE samples SET active=0 WHERE id=?');this.db.transaction(()=>ids.forEach(id=>stmt.run(id)))();await Promise.all(samples.map(s=>s.filePath?rm(s.filePath,{force:true}):undefined));}
  markBest(id:string){const sample=this.get(id);if(!sample||!sample.active||sample.reviewStatus!=='pending')return;this.db.transaction(()=>{this.db.prepare("UPDATE samples SET is_best=0 WHERE guild_id=(SELECT guild_id FROM samples WHERE id=?) AND voice_owner_id=? AND review_status='pending'").run(id,sample.ownerId);this.db.prepare("UPDATE samples SET is_best=1 WHERE id=? AND active=1 AND review_status='pending'").run(id);})();}
  async reconcileManagedStorage(root='/data/training'){
    const managed=path.resolve(root);await mkdir(managed,{recursive:true});const rows=this.db.prepare('SELECT id,file_path,active FROM samples').all() as {id:string;file_path:string;active:number}[];const referenced=new Set<string>(),missing:string[]=[],finishedTombstones:string[]=[];const generated=(file:string)=>{const parts=path.relative(managed,file).split(path.sep);return parts.length===3&&/^\d{15,22}$/.test(parts[0]!)&&/^\d{15,22}$/.test(parts[1]!)&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.wav$/i.test(parts[2]!);};
    for(const row of rows){const file=path.resolve(row.file_path);if(!generated(file))continue;const absent=await access(file).then(()=>false,()=>true);if(row.active){if(absent)missing.push(row.id);else referenced.add(file);}else if(absent)finishedTombstones.push(row.id);else try{await rm(file);finishedTombstones.push(row.id);}catch{referenced.add(file);}}
    if(missing.length){const update=this.db.prepare('UPDATE samples SET active=0,is_best=0,selected=0 WHERE id=?');this.db.transaction(()=>missing.forEach(id=>update.run(id)))();}
    if(finishedTombstones.length){const reviews=this.db.prepare('DELETE FROM sample_reviews WHERE sample_id=?'),remove=this.db.prepare('DELETE FROM samples WHERE id=? AND active=0');this.db.transaction(()=>finishedTombstones.forEach(id=>{reviews.run(id);remove.run(id)}))();}
    const guilds=await readdir(managed,{withFileTypes:true});let removed=0;for(const guild of guilds){if(!guild.isDirectory()||!/^\d{15,22}$/.test(guild.name))continue;const guildPath=path.join(managed,guild.name);for(const owner of await readdir(guildPath,{withFileTypes:true})){if(!owner.isDirectory()||!/^\d{15,22}$/.test(owner.name))continue;const ownerPath=path.join(guildPath,owner.name);for(const entry of await readdir(ownerPath,{withFileTypes:true})){if(!entry.isFile())continue;const file=path.join(ownerPath,entry.name);if(generated(file)&&!referenced.has(file)){await rm(file,{force:true});removed++;}}}}
    return {removedOrphans:removed,deactivatedMissing:missing.length};
  }
  async reserveStorage(bytes:number,limitBytes:number,root='/data/training'):Promise<StorageReservation>{
    let unlock!:()=>void;const previous=this.reservationTail;this.reservationTail=new Promise(resolve=>{unlock=resolve});await previous;
    try{
      const rows=this.db.prepare("SELECT id,file_path,review_status,selected,is_best FROM samples WHERE active=1 ORDER BY quality_score ASC,captured_at ASC").all() as {id:string;file_path:string;review_status:string;selected:number;is_best:number}[];
      const sizes=await Promise.all(rows.map(async r=>({r,size:await stat(r.file_path).then(x=>x.size).catch(()=>0)})));
      const diskUsage=async(dir:string):Promise<number>=>{const entries=await readdir(dir,{withFileTypes:true}).catch(()=>[]);return (await Promise.all(entries.map(entry=>entry.isDirectory()?diskUsage(`${dir}/${entry.name}`):this.reservedFiles.has(path.resolve(dir,entry.name))?0:stat(`${dir}/${entry.name}`).then(x=>x.size).catch(()=>0)))).reduce((a,b)=>a+b,0);};
      let used=await diskUsage(root);for(const x of sizes){if(used+this.reservedBytes+bytes<=limitBytes)break;if(x.r.review_status==='accepted'||x.r.selected||x.r.is_best)continue;await this.deactivate([x.r.id]);used-=x.size;}
      if(used+this.reservedBytes+bytes>limitBytes)throw new Error(`Training storage limit reached (${Math.round(limitBytes/1024/1024)} MB); accepted samples were preserved`);
      this.reservedBytes+=bytes;let settled=false,bound:string|undefined;const settle=()=>{if(!settled){settled=true;this.reservedBytes-=bytes;if(bound)this.reservedFiles.delete(bound);}};return {bind:file=>{if(settled)throw new Error('Storage reservation is already settled');if(bound)this.reservedFiles.delete(bound);bound=path.resolve(file);this.reservedFiles.add(bound);},commit:settle,release:settle};
    }finally{unlock();}
  }
  private map(r:any):ScoredSample{return {id:r.id,ownerId:r.voice_owner_id,filePath:r.file_path,transcript:r.transcript??undefined,durationMs:r.duration_ms,capturedAt:r.captured_at,qualityScore:r.quality_score,speechRatio:r.speech_ratio,silenceRatio:1-r.speech_ratio,rms:r.rms,peak:r.peak,clippingRatio:r.clipping_ratio,snrEstimate:r.snr_estimate,reasons:JSON.parse(r.reasons),isBestSample:!!r.is_best,exceptionalCandidate:!!r.exceptional,selectedForRebuild:!!r.selected,reviewStatus:r.review_status??'pending',active:!!r.active};}
}
