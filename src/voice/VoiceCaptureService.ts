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
import type {StorageReservation} from '../db/repositories/SampleRepository.js';
type Finalizer={destroy:(error?:Error)=>void};
export class VoiceCaptureService {
  private stoppingGuilds=new Set<string>();private storageBlocked=new Set<string>();private listeners=new Map<string,()=>void>();private activeUsers=new Map<string,Set<string>>();private streams=new Map<string,Map<string,Set<Finalizer>>>();private pending=new Map<string,Map<string,Set<Promise<void>>>>();
  constructor(private root='/data/training',private extractor=new SampleFeatureExtractor(),private scorer=new SampleQualityScorer(),private maxSegmentMs=30_000,private reserveStorage?:(bytes:number)=>Promise<StorageReservation|void>,private minSegmentMs=2_000){}
  start(guild:string,connection:VoiceConnection,users:string[],onSample:(sample:ScoredSample)=>Promise<boolean|void>|boolean|void){
    if(this.listeners.has(guild))throw new Error('Capture is already running');this.stoppingGuilds.delete(guild);for(const user of users)this.storageBlocked.delete(`${guild}:${user}`);this.activeUsers.set(guild,new Set(users));this.streams.set(guild,new Map());this.pending.set(guild,new Map(users.map(user=>[user,new Set()])));
    const begin=(userId:string)=>{if(this.stoppingGuilds.has(guild)||!this.activeUsers.get(guild)?.has(userId))return;const userStreams=this.streams.get(guild)?.get(userId)??new Set<Finalizer>();this.streams.get(guild)?.set(userId,userStreams);if(userStreams.size)return;
      const opus=connection.receiver.subscribe(userId,{end:{behavior:EndBehaviorType.AfterSilence,duration:1000}});const decoder=new prism.opus.Decoder({rate:48_000,channels:2,frameSize:960});const chunks:Buffer[]=[];let completed=false;
      let resolveCompletion!:()=>void;const completion=new Promise<void>(resolve=>{resolveCompletion=resolve});const pending=this.pending.get(guild)?.get(userId)??new Set<Promise<void>>();this.pending.get(guild)?.set(userId,pending);pending.add(completion);
      const control={destroy:()=>complete(true)};userStreams.add(control);
      const complete=(keep:boolean,error?:unknown)=>{if(completed)return;completed=true;if(timer)clearTimeout(timer);userStreams.delete(control);opus.unpipe(decoder);if(!opus.destroyed)opus.destroy();if(!decoder.destroyed)decoder.destroy();if(error)logger.warn({err:error,guild,user:userId},'training receive segment discarded after stream error');const persistence=keep?this.finish(guild,userId,chunks,onSample):Promise.resolve();void persistence.finally(()=>{pending.delete(completion);resolveCompletion();});};
      const timer=setTimeout(()=>{complete(true);if(!this.stoppingGuilds.has(guild)&&this.activeUsers.get(guild)?.has(userId))setImmediate(()=>begin(userId));},this.maxSegmentMs);decoder.on('data',(chunk:Buffer)=>chunks.push(Buffer.from(chunk)));
      opus.once('end',()=>complete(true));opus.once('error',error=>complete(false,error));opus.once('close',()=>complete(false));decoder.once('end',()=>complete(true));decoder.once('error',error=>complete(false,error));decoder.once('close',()=>complete(false));opus.pipe(decoder);
    };
    connection.receiver.speaking.on('start',begin);this.listeners.set(guild,()=>connection.receiver.speaking.off('start',begin));
  }
  async stopAndDrain(guild:string){this.stoppingGuilds.add(guild);this.listeners.get(guild)?.();this.listeners.delete(guild);for(const set of this.streams.get(guild)?.values()??[])for(const stream of [...set])stream.destroy();const all=()=>[...(this.pending.get(guild)?.values()??[])].flatMap(set=>[...set]);while(all().length)await Promise.allSettled(all());this.activeUsers.delete(guild);this.streams.delete(guild);this.pending.delete(guild);this.stoppingGuilds.delete(guild);}
  async stopAllAndDrain(){await Promise.all([...this.listeners.keys()].map(guild=>this.stopAndDrain(guild)));}
  async removeUserAndDrain(guild:string,user:string){this.activeUsers.get(guild)?.delete(user);for(const stream of [...(this.streams.get(guild)?.get(user)??[])])stream.destroy();const pending=this.pending.get(guild)?.get(user);while(pending?.size)await Promise.allSettled([...pending]);this.pending.get(guild)?.delete(user);this.streams.get(guild)?.delete(user);}
  private async finish(guild:string,user:string,chunks:Buffer[],onSample:(s:ScoredSample)=>Promise<boolean|void>|boolean|void){const pcm=Buffer.concat(chunks);if(this.storageBlocked.has(`${guild}:${user}`)||pcm.length<48_000*2*2*this.minSegmentMs/1000)return;const id=randomUUID();const dir=path.join(this.root,guild,user);const file=path.join(dir,`${id}.wav`);let reservation:StorageReservation|void=undefined;try{const wav=wavFromPcm(pcm);reservation=await this.reserveStorage?.(wav.byteLength);if(!this.activeUsers.get(guild)?.has(user))return;reservation?.bind(file);await mkdir(dir,{recursive:true});await writeFile(file,wav);reservation?.commit();if(!this.activeUsers.get(guild)?.has(user)){await rm(file,{force:true});return;}const values=new Int16Array(pcm.buffer,pcm.byteOffset,Math.floor(pcm.byteLength/2));const sample=this.scorer.score(this.extractor.extract(values),{id,ownerId:user});sample.filePath=file;const accepted=await onSample(sample);if(accepted===false||!this.activeUsers.get(guild)?.has(user))await rm(file,{force:true});}catch(err){await rm(file,{force:true});if(err instanceof Error&&err.message.startsWith('Training storage limit reached'))this.storageBlocked.add(`${guild}:${user}`);logger.error({err,guild,user},'training capture could not be stored');}finally{reservation?.release();}}
}
