import Database from 'better-sqlite3';
import {mkdirSync} from 'node:fs';
import path from 'node:path';

const samplesSchema=`CREATE TABLE samples(id TEXT PRIMARY KEY,guild_id TEXT NOT NULL DEFAULT '',voice_owner_id TEXT NOT NULL,file_path TEXT NOT NULL,duration_ms INTEGER NOT NULL,captured_at INTEGER NOT NULL,transcript TEXT,quality_score REAL NOT NULL,speech_ratio REAL NOT NULL,rms REAL NOT NULL DEFAULT 0,peak REAL NOT NULL DEFAULT 0,clipping_ratio REAL NOT NULL,snr_estimate REAL NOT NULL,reasons TEXT NOT NULL,is_best INTEGER NOT NULL DEFAULT 0,exceptional INTEGER NOT NULL DEFAULT 0,selected INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1)`;
export function openDatabase(file:string){
  mkdirSync(path.dirname(file),{recursive:true});const db=new Database(file);db.pragma('journal_mode = WAL');db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE IF NOT EXISTS enrollments(id INTEGER PRIMARY KEY,guild_id TEXT NOT NULL,user_id TEXT NOT NULL,enrolled_at INTEGER NOT NULL,training_enabled INTEGER NOT NULL DEFAULT 1,UNIQUE(guild_id,user_id));CREATE TABLE IF NOT EXISTS voices(id INTEGER PRIMARY KEY,guild_id TEXT NOT NULL,owner_id TEXT NOT NULL,alias TEXT NOT NULL COLLATE NOCASE,fish_voice_id TEXT,model_version INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,last_rebuilt_at INTEGER,UNIQUE(guild_id,owner_id),UNIQUE(guild_id,alias));${samplesSchema.replace('CREATE TABLE','CREATE TABLE IF NOT EXISTS')};CREATE TABLE IF NOT EXISTS sample_reviews(id INTEGER PRIMARY KEY, sample_id TEXT NOT NULL, reviewer_id TEXT NOT NULL, decision TEXT NOT NULL, created_at INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS generations(id TEXT PRIMARY KEY,guild_id TEXT NOT NULL,voice_id INTEGER NOT NULL,requester_id TEXT NOT NULL,text_length INTEGER NOT NULL,created_at INTEGER NOT NULL,status TEXT NOT NULL);`);
  let columns=db.prepare('PRAGMA table_info(samples)').all() as {name:string}[];
  if(!columns.some(c=>c.name==='guild_id')){db.exec("ALTER TABLE samples ADD COLUMN guild_id TEXT NOT NULL DEFAULT ''");columns=db.prepare('PRAGMA table_info(samples)').all() as {name:string}[];}
  // Remove the legacy overlap column rather than continuing to store a fabricated value.
  if(columns.some(c=>c.name==='overlap_estimate'))db.transaction(()=>{db.exec(`ALTER TABLE samples RENAME TO samples_legacy;${samplesSchema};INSERT INTO samples(id,guild_id,voice_owner_id,file_path,duration_ms,captured_at,transcript,quality_score,speech_ratio,rms,peak,clipping_ratio,snr_estimate,reasons,is_best,exceptional,selected,active) SELECT id,guild_id,voice_owner_id,file_path,duration_ms,captured_at,transcript,quality_score,speech_ratio,rms,peak,clipping_ratio,snr_estimate,reasons,is_best,exceptional,selected,active FROM samples_legacy;DROP TABLE samples_legacy`);})();
  return db;
}
export type DB=ReturnType<typeof openDatabase>;
