import {EndBehaviorType,type VoiceConnection} from '@discordjs/voice';
import prism from 'prism-media';
import {mkdir,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {wavFromPcm} from '../audio/wav.js';
import {SampleFeatureExtractor} from '../training/SampleFeatureExtractor.js';
import {SampleQualityScorer} from '../training/SampleQualityScorer.js';
import type {ScoredSample} from '../training/types.js';
import {logger} from '../utils/logger.js';
import {StorageCapacityError,type StorageReservation} from '../db/repositories/SampleRepository.js';
type Finalizer={destroy:(error?:Error)=>void};
export class VoiceCaptureService {
  private listeners=new Map<string,()=>void>();private blocked=new Map<string,string>();private activeUsers=new Map<string,Set<string>>();private streams=new Map<string,Map<string,Set<Finalizer>>>();private pending=new Map<string,Map<string,Set<Promise<void>>>>();
  constructor(private root='/data/training',private extractor=new SampleFeatureExtractor(),private scorer=new SampleQualityScorer(),private maxSegmentMs=30_000,private reserveStorage?:(bytes:number)=>Promise<StorageReservation|void>,private minSegmentMs=2_000){}
  start(guild:string,connection:VoiceConnection,users:string[],onSample:(sample:ScoredSample)=>Promise<boolean|void>|boolean|void){
    if(this.listeners.has(guild))throw new Error('Capture is already running');for(const user of users)this.blocked.delete(`${guild}:${user}`);this.activeUsers.set(guild,new Set(users));this.streams.set(guild,new Map());this.pending.set(guild,new Map(users.map(user=>[user,new Set()])));
    const begin=(userId:string)=>{if(!this.activeUsers.get(guild)?.has(userId)||this.blocked.has(`${guild}:${userId}`))return;const userStreams=this.streams.get(guild)?.get(userId)??new Set<Finalizer>();this.streams.get(guild)?.set(userId,userStreams);
      const opus=connection.receiver.subscribe(userId,{end:{behavior:EndBehaviorType.AfterSilence,duration:1000}});const decoder=new prism.opus.Decoder({rate:48_000,channels:2,frameSize:960});const chunks:Buffer[]=[];let finalized=false;let continueAfterLimit=false;
      let completed!:()=>void;const completion=new Promise<void>(resolve=>{completed=resolve});const pending=this.pending.get(guild)?.get(userId)??new Set<Promise<void>>();this.pending.get(guild)?.set(userId,pending);pending.add(completion);
      const finalize=()=>{if(finalized)return;finalized=true;clearTimeout(timer);opus.unpipe(decoder);if(!opus.destroyed)opus.destroy();decoder.end();};const control={destroy:finalize};userStreams.add(control);
      const timer=setTimeout(()=>{continueAfterLimit=true;finalize();},this.maxSegmentMs);decoder.on('data',(chunk:Buffer)=>chunks.push(Buffer.from(chunk)));
      let completionStarted=false;const complete=()=>{if(completionStarted)return;completionStarted=true;finalized=true;clearTimeout(timer);opus.unpipe(decoder);if(!opus.destroyed)opus.destroy();void this.finish(guild,userId,chunks,onSample).finally(()=>{userStreams.delete(control);decoder.destroy();pending.delete(completion);completed();if(continueAfterLimit&&this.activeUsers.get(guild)?.has(userId))setImmediate(()=>begin(userId));});};
      decoder.once('end',complete);decoder.once('error',complete);decoder.once('close',complete);opus.once('error',finalize);opus.once('close',finalize);opus.pipe(decoder);
    };
    connection.receiver.speaking.on('start',begin);this.listeners.set(guild,()=>connection.receiver.speaking.off('start',begin));
  }
  blockedReason(guild:string,user:string){return this.blocked.get(`${guild}:${user}`);}
  async stopAndDrain(guild:string){this.listeners.get(guild)?.();this.listeners.delete(guild);for(const set of this.streams.get(guild)?.values()??[])for(const stream of [...set])stream.destroy();const all=()=>[...(this.pending.get(guild)?.values()??[])].flatMap(set=>[...set]);while(all().length)await Promise.allSettled(all());this.activeUsers.delete(guild);this.streams.delete(guild);this.pending.delete(guild);}
  async stopAllAndDrain(){await Promise.all([...this.listeners.keys()].map(guild=>this.stopAndDrain(guild)));}
  async removeUserAndDrain(guild:string,user:string){this.activeUsers.get(guild)?.delete(user);for(const stream of [...(this.streams.get(guild)?.get(user)??[])])stream.destroy();const pending=this.pending.get(guild)?.get(user);while(pending?.size)await Promise.allSettled([...pending]);this.pending.get(guild)?.delete(user);this.streams.get(guild)?.delete(user);}
  private async finish(guild:string,user:string,chunks:Buffer[],onSample:(s:ScoredSample)=>Promise<boolean|void>|boolean|void){const pcm=Buffer.concat(chunks);if(pcm.length<48_000*2*2*this.minSegmentMs/1000||this.blocked.has(`${guild}:${user}`))return;const id=randomUUID();const dir=path.join(this.root,guild,user);const file=path.join(dir,`${id}.wav`);let reservation:StorageReservation|void=undefined;try{const wav=wavFromPcm(pcm);reservation=await this.reserveStorage?.(wav.byteLength);if(!this.activeUsers.get(guild)?.has(user))return;await mkdir(dir,{recursive:true});await writeFile(file,wav);reservation?.commit();if(!this.activeUsers.get(guild)?.has(user)){await rm(file,{force:true});return;}const values=new Int16Array(pcm.buffer,pcm.byteOffset,Math.floor(pcm.byteLength/2));const sample=this.scorer.score(this.extractor.extract(values),{id,ownerId:user});sample.filePath=file;const accepted=await onSample(sample);if(accepted===false||!this.activeUsers.get(guild)?.has(user))await rm(file,{force:true});}catch(err){await rm(file,{force:true});if(err instanceof StorageCapacityError){const key=`${guild}:${user}`;if(!this.blocked.has(key)){this.blocked.set(key,err.message);logger.warn({guild,user},'training capture blocked by storage capacity');}}else logger.error({err,guild,user},'training capture could not be stored');}finally{reservation?.release();}}
}
