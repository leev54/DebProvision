import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,readFile,rm,writeFile,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from './db/client.js';
import {SampleRepository} from './db/repositories/SampleRepository.js';
import {wavFromPcm} from './audio/wav.js';
import type {ScoredSample} from './training/types.js';
import {VoiceCaptureService} from './voice/VoiceCaptureService.js';
import {TrainingSessionManager} from './training/TrainingSessionManager.js';
import {EnrollmentRepository} from './db/repositories/EnrollmentRepository.js';

const roots:string[]=[];
afterEach(async()=>Promise.all(roots.splice(0).map(x=>rm(x,{recursive:true,force:true}))));
const sample=(file:string):ScoredSample=>({id:'sample-1',ownerId:'user-1',filePath:file,durationMs:6000,capturedAt:1,qualityScore:.9,speechRatio:.8,silenceRatio:.2,rms:.1,peak:.5,clippingRatio:0,snrEstimate:25,reasons:['clean'],isBestSample:false,exceptionalCandidate:false,selectedForRebuild:false,reviewStatus:'pending',active:true,continuity:.8});

describe('production audio and persistence seams',()=>{
  it('creates a standards-compliant PCM WAV',()=>{const pcm=Buffer.alloc(48000*2*2);const wav=wavFromPcm(pcm);expect(wav.subarray(0,4).toString()).toBe('RIFF');expect(wav.subarray(8,12).toString()).toBe('WAVE');expect(wav.readUInt16LE(20)).toBe(1);expect(wav.readUInt32LE(24)).toBe(48000);expect(wav.readUInt32LE(40)).toBe(pcm.length);});
  it('persists review decisions and removes cleared sample files',async()=>{const root=await mkdtemp(path.join(tmpdir(),'voice-bot-'));roots.push(root);const file=path.join(root,'sample.wav');await writeFile(file,wavFromPcm(Buffer.alloc(100)));const db=openDatabase(path.join(root,'bot.db'));const repo=new SampleRepository(db);repo.save('guild-1',sample(file));expect(repo.list('guild-1','user-1')).toHaveLength(1);expect(repo.review('sample-1','user-1','accepted')).toBe(1);expect(repo.get('sample-1')?.selectedForRebuild).toBe(true);expect(repo.history('user-1')[0].decision).toBe('accepted');expect(await repo.clear('guild-1','user-1')).toBe(1);await expect(readFile(file)).rejects.toThrow();db.close();});
  it('drains speech in progress before training closes and keeps its WAV',async()=>{const root=await mkdtemp(path.join(tmpdir(),'voice-drain-'));roots.push(root);const scored=sample('');const capture=new VoiceCaptureService(root,{extract:()=>scored} as any,{score:(_f:any,input:any)=>({...scored,...input})} as any);const training=new TrainingSessionManager();training.start('guild-1',['user-1']);const internals=capture as any;internals.activeUsers.set('guild-1',new Set(['user-1']));internals.streams.set('guild-1',new Map());internals.listeners.set('guild-1',()=>{});internals.pending.set('guild-1',new Set());const work=internals.finish('guild-1','user-1',[Buffer.alloc(48_000*2*2*5)],async(s:ScoredSample)=>training.add('guild-1','user-1',s));internals.pending.get('guild-1').add(work);work.finally(()=>internals.pending.get('guild-1')?.delete(work));await capture.stopAndDrain('guild-1');const result=await training.stop('guild-1');expect(result[0]?.samples).toHaveLength(1);await expect(access(result[0]!.samples[0]!.filePath!)).resolves.toBeUndefined();});
  it('removes both the database row and WAV transactionally',async()=>{const root=await mkdtemp(path.join(tmpdir(),'voice-remove-'));roots.push(root);const file=path.join(root,'sample.wav');await writeFile(file,Buffer.from('wav'));const db=openDatabase(path.join(root,'bot.db'));const repo=new SampleRepository(db);repo.save('guild-1',sample(file));await repo.remove('sample-1');expect(repo.get('sample-1')).toBeUndefined();await expect(access(file)).rejects.toThrow();db.close();});
  it('selects stopped-session samples only from active repository state',async()=>{const training=new TrainingSessionManager();training.start('g',['user-1']);training.add('g','user-1',sample('/gone.wav'));training.add('g','user-1',{...sample('/kept.wav'),id:'kept'});const result=await training.stop('g',undefined,true,new Set(['kept']));expect(result[0]?.samples.map(x=>x.id)).toEqual(['kept']);});
  it('resets a built voice while preserving enrollment and alias',async()=>{const root=await mkdtemp(path.join(tmpdir(),'voice-reset-'));roots.push(root);const db=openDatabase(path.join(root,'bot.db'));const repo=new EnrollmentRepository(db);repo.enroll('g','u','Friendly');repo.activate('g','u','provider-secret',0);repo.resetVoice('g','u','Friendly');expect(repo.isEnrolled('g','u')).toBe(true);expect(repo.voiceByOwner('g','u')).toMatchObject({alias:'Friendly',fish_voice_id:null,model_version:0});db.close();});
});

import {FishTranscriptionService} from './services/transcription/FishTranscriptionService.js';
import {loadConfig} from './config/env.js';

describe('Fish ASR and deployment configuration',()=>{
  it('uses Fish multipart ASR with the shared Fish key',async()=>{
    const original=globalThis.fetch;let request:RequestInit|undefined;
    globalThis.fetch=async(_url,init)=>{request=init;return new Response(JSON.stringify({text:' hello fish '}),{status:200,headers:{'content-type':'application/json'}});};
    try{await expect(new FishTranscriptionService('fish-key').transcribeWav(new Uint8Array([1,2]))).resolves.toEqual({text:'hello fish'});expect(request?.headers).toEqual({Authorization:'Bearer fish-key'});expect(request?.body).toBeInstanceOf(FormData);expect((request?.body as FormData).get('audio')).toBeInstanceOf(Blob);}finally{globalThis.fetch=original;}
  });
  it('starts from exactly the five required production settings',()=>{expect(loadConfig({DISCORD_TOKEN:'d',DISCORD_CLIENT_ID:'c',DISCORD_GUILD_ID:'g',FISH_API_KEY:'f',DATABASE_URL:'file:/data/bot.db'} as NodeJS.ProcessEnv).DATABASE_URL).toBe('file:/data/bot.db');});
});

import {binaryPlaybackInput} from './voice/DiscordVoiceRuntime.js';
describe('binary playback input',()=>{
  it('emits binary chunks rather than iterated byte numbers',async()=>{
    const chunks:unknown[]=[];for await(const chunk of binaryPlaybackInput(new Uint8Array([1,2,255])))chunks.push(chunk);
    expect(chunks).toHaveLength(1);expect(Buffer.isBuffer(chunks[0])||chunks[0] instanceof Uint8Array).toBe(true);expect(typeof chunks[0]).not.toBe('number');expect([...chunks[0] as Uint8Array]).toEqual([1,2,255]);
  });
});

describe('runtime regression wiring',()=>{
  it('uses production Fish realtime settings in the live integration script',async()=>{const source=await readFile(new URL('../scripts/liveIntegration.ts',import.meta.url),'utf8');expect(source).toContain("config.FISH_REALTIME_TIMEOUT_MS,config.FISH_TTS_MODEL");});
  it('awaits real shutdown drains without an arbitrary sleep',async()=>{const source=await readFile(new URL('./index.ts',import.meta.url),'utf8');expect(source).toContain('await capture.stopAllAndDrain();await live.stopAll();await voice.stopAll();db.close()');expect(source).not.toContain('setTimeout(resolve,250)');});
  it('never interpolates the provider voice id into Discord responses',async()=>{const source=await readFile(new URL('./discord/client.ts',import.meta.url),'utf8');expect(source).not.toContain('using Fish voice ${live.target()}');expect(source).not.toContain('Rebuilt and validated Fish model ${id}');expect(source).toContain('using ${live.displayAlias()}');});
  it('performs local deletion before separately handling remote failure',async()=>{const source=await readFile(new URL('./discord/client.ts',import.meta.url),'utf8');const command=source.slice(source.indexOf("i.commandName==='deletevoice'"),source.indexOf("i.commandName==='train'"));expect(command.indexOf('repo.resetVoice')).toBeLessThan(command.indexOf('s.fish.deleteVoice'));expect(command).toContain('Remote provider cleanup failed');});
});
