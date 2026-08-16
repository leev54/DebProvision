import {rm} from 'node:fs/promises';
import type {DB} from '../client.js';
import type {ScoredSample} from '../../training/types.js';

export class SampleRepository {
  constructor(private db:DB){}
  save(guild:string,s:ScoredSample){
    if(!s.filePath)throw new Error('A captured sample must have a file');
    this.db.prepare(`INSERT INTO samples(id,guild_id,voice_owner_id,file_path,duration_ms,captured_at,quality_score,speech_ratio,rms,peak,clipping_ratio,snr_estimate,overlap_estimate,reasons,is_best,exceptional,selected,active)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(s.id,guild,s.ownerId,s.filePath,Math.round(s.durationMs),s.capturedAt,s.qualityScore,s.speechRatio,s.rms,s.peak,s.clippingRatio,s.snrEstimate,s.overlapEstimate,JSON.stringify(s.reasons),+s.isBestSample,+s.exceptionalCandidate,+s.selectedForRebuild,+s.active);
  }
  list(guild:string,owner?:string,active=true){const rows=this.db.prepare(`SELECT * FROM samples WHERE guild_id=? ${owner?'AND voice_owner_id=?':''} ${active?'AND active=1':''} ORDER BY quality_score DESC`).all(...(owner?[guild,owner]:[guild])) as any[];return rows.map(row=>this.map(row));}
  get(id:string){const row=this.db.prepare('SELECT * FROM samples WHERE id=?').get(id) as any;return row?this.map(row):undefined;}
  review(id:string,reviewer:string,decision:'accepted'|'rejected'){const value=decision==='accepted';return this.db.transaction(()=>{const changed=this.db.prepare('UPDATE samples SET selected=?,is_best=? WHERE id=? AND active=1').run(+value,+value,id).changes;if(changed)this.db.prepare('INSERT INTO sample_reviews(sample_id,reviewer_id,decision,created_at) VALUES(?,?,?,?)').run(id,reviewer,decision,Date.now());return changed;})();}
  history(owner:string){return this.db.prepare('SELECT r.*,s.quality_score,s.duration_ms FROM sample_reviews r JOIN samples s ON s.id=r.sample_id WHERE s.voice_owner_id=? ORDER BY r.created_at DESC LIMIT 20').all(owner) as any[];}
  async clear(guild:string,owner?:string){const samples=this.list(guild,owner);this.db.prepare(`UPDATE samples SET active=0 WHERE guild_id=? ${owner?'AND voice_owner_id=?':''}`).run(...(owner?[guild,owner]:[guild]));await Promise.all(samples.map(s=>s.filePath?rm(s.filePath,{force:true}):undefined));return samples.length;}
  async deactivate(ids:string[]){const samples=ids.map(id=>this.get(id)).filter((s):s is ScoredSample=>!!s);const stmt=this.db.prepare('UPDATE samples SET active=0 WHERE id=?');this.db.transaction(()=>ids.forEach(id=>stmt.run(id)))();await Promise.all(samples.map(s=>s.filePath?rm(s.filePath,{force:true}):undefined));}
  markBest(id:string){this.db.prepare('UPDATE samples SET is_best=1 WHERE id=?').run(id);}
  private map(r:any):ScoredSample{return {id:r.id,ownerId:r.voice_owner_id,filePath:r.file_path,durationMs:r.duration_ms,capturedAt:r.captured_at,qualityScore:r.quality_score,speechRatio:r.speech_ratio,silenceRatio:1-r.speech_ratio,rms:r.rms,peak:r.peak,clippingRatio:r.clipping_ratio,snrEstimate:r.snr_estimate,overlapEstimate:r.overlap_estimate,reasons:JSON.parse(r.reasons),isBestSample:!!r.is_best,exceptionalCandidate:!!r.exceptional,selectedForRebuild:!!r.selected,active:!!r.active,packetLoss:0,transcriptConfidence:0,wordCount:0,continuity:r.speech_ratio,musicLikelihood:0,naturalness:.7,novelty:1};}
}
