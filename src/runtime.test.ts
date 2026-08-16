import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from './db/client.js';
import {SampleRepository} from './db/repositories/SampleRepository.js';
import {wavFromPcm} from './audio/wav.js';
import type {ScoredSample} from './training/types.js';

const roots:string[]=[];
afterEach(async()=>Promise.all(roots.splice(0).map(x=>rm(x,{recursive:true,force:true}))));
const sample=(file:string):ScoredSample=>({id:'sample-1',ownerId:'user-1',filePath:file,durationMs:6000,capturedAt:1,qualityScore:.9,speechRatio:.8,silenceRatio:.2,rms:.1,peak:.5,clippingRatio:0,snrEstimate:25,overlapEstimate:0,reasons:['clean'],isBestSample:false,exceptionalCandidate:false,selectedForRebuild:false,active:true,packetLoss:0,transcriptConfidence:0,wordCount:0,continuity:.8,musicLikelihood:0,naturalness:.7,novelty:1});

describe('production audio and persistence seams',()=>{
  it('creates a standards-compliant PCM WAV',()=>{const pcm=Buffer.alloc(48000*2*2);const wav=wavFromPcm(pcm);expect(wav.subarray(0,4).toString()).toBe('RIFF');expect(wav.subarray(8,12).toString()).toBe('WAVE');expect(wav.readUInt16LE(20)).toBe(1);expect(wav.readUInt32LE(24)).toBe(48000);expect(wav.readUInt32LE(40)).toBe(pcm.length);});
  it('persists review decisions and removes cleared sample files',async()=>{const root=await mkdtemp(path.join(tmpdir(),'voice-bot-'));roots.push(root);const file=path.join(root,'sample.wav');await writeFile(file,wavFromPcm(Buffer.alloc(100)));const db=openDatabase(path.join(root,'bot.db'));const repo=new SampleRepository(db);repo.save('guild-1',sample(file));expect(repo.list('guild-1','user-1')).toHaveLength(1);expect(repo.review('sample-1','user-1','accepted')).toBe(1);expect(repo.get('sample-1')?.selectedForRebuild).toBe(true);expect(repo.history('user-1')[0].decision).toBe('accepted');expect(await repo.clear('guild-1','user-1')).toBe(1);await expect(readFile(file)).rejects.toThrow();db.close();});
});
