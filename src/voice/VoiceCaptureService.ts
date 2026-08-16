import {EndBehaviorType,type VoiceConnection} from '@discordjs/voice';
import prism from 'prism-media';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {wavFromPcm} from '../audio/wav.js';
import {SampleFeatureExtractor} from '../training/SampleFeatureExtractor.js';
import {SampleQualityScorer} from '../training/SampleQualityScorer.js';
import type {ScoredSample} from '../training/types.js';

export class VoiceCaptureService {
  private listeners=new Map<string,()=>void>();private activeUsers=new Map<string,Set<string>>();
  constructor(private root='/data/training',private extractor=new SampleFeatureExtractor(),private scorer=new SampleQualityScorer()){}
  start(guild:string,connection:VoiceConnection,users:string[],onSample:(sample:ScoredSample)=>Promise<void>|void){this.stop(guild);this.activeUsers.set(guild,new Set(users));const handler=(userId:string)=>{if(!this.activeUsers.get(guild)?.has(userId))return;const opus=connection.receiver.subscribe(userId,{end:{behavior:EndBehaviorType.AfterSilence,duration:1000}});const decoder=new prism.opus.Decoder({rate:48_000,channels:2,frameSize:960});const chunks:Buffer[]=[];decoder.on('data',(chunk:Buffer)=>chunks.push(Buffer.from(chunk)));decoder.once('end',()=>void this.finish(guild,userId,chunks,onSample));opus.on('error',()=>decoder.destroy());opus.pipe(decoder);};connection.receiver.speaking.on('start',handler);this.listeners.set(guild,()=>connection.receiver.speaking.off('start',handler));}
  stop(guild:string){this.listeners.get(guild)?.();this.listeners.delete(guild);this.activeUsers.delete(guild);}
  removeUser(guild:string,user:string){this.activeUsers.get(guild)?.delete(user);}
  private async finish(guild:string,user:string,chunks:Buffer[],onSample:(s:ScoredSample)=>Promise<void>|void){const pcm=Buffer.concat(chunks);if(pcm.length<48_000*2*2*5)return;const id=randomUUID();const dir=path.join(this.root,guild,user);await mkdir(dir,{recursive:true});const file=path.join(dir,`${id}.wav`);await writeFile(file,wavFromPcm(pcm));const values=new Int16Array(pcm.buffer,pcm.byteOffset,Math.floor(pcm.byteLength/2));const sample=this.scorer.score(this.extractor.extract(values),{id,ownerId:user});sample.filePath=file;await onSample(sample);}
}
