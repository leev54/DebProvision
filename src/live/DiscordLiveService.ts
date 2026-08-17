import {EndBehaviorType,type VoiceConnection} from '@discordjs/voice';
import prism from 'prism-media';
import {randomUUID} from 'node:crypto';
import type {VoiceProvider} from '../services/fish/VoiceProvider.js';import type {TranscriptionService} from '../services/transcription/TranscriptionService.js';import type {DiscordVoiceRuntime} from '../voice/DiscordVoiceRuntime.js';import {wavFromPcm} from '../audio/wav.js';import {LiveVoicePipeline} from './LiveVoicePipeline.js';import {logger} from '../utils/logger.js';
interface Session {pipeline:LiveVoicePipeline;controller:AbortController;detach:()=>void;streams:Set<{destroy:(error?:Error)=>void}>;receiving?:symbol;groupId:string;sequence:number;tail:Promise<void>}
export class DiscordLiveService {
  private sessions=new Map<string,Session>();
  constructor(private transcription:TranscriptionService,private fish:VoiceProvider,private voice:DiscordVoiceRuntime,private maxLagMs=3000,private maxUtteranceMs=120_000){}
  start(guild:string,connection:VoiceConnection,sourceUser:string,voiceId:string,alias=voiceId){
    if(this.sessions.has(guild))throw new Error('Live mode is already active');
    const pipeline=new LiveVoicePipeline(sourceUser,voiceId,this.maxLagMs,alias);const session:Session={pipeline,controller:new AbortController(),streams:new Set(),groupId:`live:${guild}:${randomUUID()}`,detach:()=>{},sequence:0,tail:Promise.resolve()};
    const handler=(user:string)=>{
      if(user!==sourceUser||session.controller.signal.aborted||session.receiving)return;const token=Symbol('live-segment');session.receiving=token;
      const beganAt=Date.now(),sequence=session.sequence++;const opus=connection.receiver.subscribe(user,{end:{behavior:EndBehaviorType.AfterSilence,duration:350}});const decoder=new prism.opus.Decoder({rate:48_000,channels:2,frameSize:960});const chunks:Buffer[]=[];let bytes=0,completed=false,cleanEnding=false;
      const release=()=>{if(session.receiving===token)session.receiving=undefined;};const complete=(keep:boolean,error?:unknown)=>{if(completed)return;completed=true;release();clearTimeout(timer);session.streams.delete(control);opus.unpipe(decoder);if(!opus.destroyed)opus.destroy();if(!decoder.destroyed)decoder.destroy();if(error&&!session.controller.signal.aborted)logger.warn({err:error,guild},'live receive stream ended with an error');if(keep&&!session.controller.signal.aborted){const pcm=Buffer.concat(chunks),completedAt=Date.now();session.tail=session.tail.then(()=>this.process(guild,session,pcm,beganAt,completedAt,sequence));}};
      const endCleanly=(continuation=false)=>{if(completed||cleanEnding)return;cleanEnding=true;release();clearTimeout(timer);opus.unpipe(decoder);if(!opus.destroyed)opus.destroy();decoder.end();if(continuation&&!session.controller.signal.aborted)setImmediate(()=>handler(user));};
      const control={destroy:()=>complete(false)};session.streams.add(control);const timer=setTimeout(()=>endCleanly(true),this.maxUtteranceMs);
      decoder.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes<=this.maxUtteranceMs*48_000*2*2/1000)chunks.push(Buffer.from(chunk));else endCleanly(true);});
      opus.once('end',()=>endCleanly());opus.once('error',error=>complete(false,error));opus.once('close',()=>{if(!cleanEnding)complete(false)});
      decoder.once('end',()=>complete(cleanEnding));decoder.once('error',error=>complete(false,error));decoder.once('close',()=>{if(!completed)complete(false)});opus.pipe(decoder);
    };
    connection.receiver.speaking.on('start',handler);session.detach=()=>connection.receiver.speaking.off('start',handler);this.sessions.set(guild,session);
  }
  private async process(guild:string,session:Session,pcm:Buffer,beganAt:number,completedAt:number,sequence:number){
    const timing={beganAt,completedAt,asrStartedAt:0,asrFinishedAt:0,ttsQueuedAt:0,playbackStartedAt:0,firstAudioAt:0};const deadline=completedAt+this.maxLagMs;const remaining=()=>deadline-Date.now();
    if(pcm.length<9600||session.controller.signal.aborted||remaining()<=0)return;
    try{
      timing.asrStartedAt=Date.now();const asrFreshness=AbortSignal.timeout(Math.max(1,remaining()));const asrSignal=AbortSignal.any([session.controller.signal,asrFreshness]);
      const result=await this.transcription.transcribeWav(wavFromPcm(pcm),asrSignal);timing.asrFinishedAt=Date.now();
      if(!result.text||!session.pipeline.active||session.controller.signal.aborted||remaining()<=0)return;
      timing.ttsQueuedAt=Date.now();
      this.voice.enqueueStream(guild,`Live utterance ${sequence}`,async(stream,playbackSignal)=>{
        timing.playbackStartedAt=Date.now();if(remaining()<=0)throw new Error('Live utterance discarded because completed speech became stale before playback');
        const freshness=new AbortController();const timer=setTimeout(()=>freshness.abort(new DOMException('Live first-audio deadline exceeded','TimeoutError')),Math.max(1,remaining()));const signal=AbortSignal.any([session.controller.signal,playbackSignal,freshness.signal]);
        try{await this.fish.streamSynthesize({voiceId:session.pipeline.target(),text:result.text},async chunk=>{if(!timing.firstAudioAt){timing.firstAudioAt=Date.now();clearTimeout(timer);if(timing.firstAudioAt>deadline)throw new DOMException('Live first-audio deadline exceeded','TimeoutError');}if(!stream.write(chunk))await new Promise<void>((resolve,reject)=>{let settled=false;const cleanup=()=>{stream.off('drain',drain);stream.off('error',fail);signal.removeEventListener('abort',abort)},settle=(error?:unknown)=>{if(settled)return;settled=true;cleanup();if(error)reject(error);else resolve()},drain=()=>settle(),fail=(error:Error)=>settle(error),abort=()=>settle(signal.reason);stream.once('drain',drain);stream.once('error',fail);signal.addEventListener('abort',abort,{once:true});});},signal);}finally{clearTimeout(timer);}
        const first=timing.firstAudioAt||Date.now();session.pipeline.latency.record({capture:timing.completedAt-timing.beganAt,asr:timing.asrFinishedAt-timing.asrStartedAt,queueWait:timing.playbackStartedAt-timing.ttsQueuedAt,ttsFirstAudio:first-timing.playbackStartedAt,mouthToFirstAudio:first-timing.beganAt});
      },session.groupId);
    }catch(err){if(!session.controller.signal.aborted&&!(err instanceof DOMException&&['AbortError','TimeoutError'].includes(err.name)))logger.error({err,guild},'live utterance failed');}
  }
  async stop(guild:string){const session=this.sessions.get(guild);if(!session)return false;session.detach();session.pipeline.stop();session.controller.abort();for(const stream of session.streams)stream.destroy();session.streams.clear();this.voice.cancelGroup(guild,session.groupId);await session.tail;this.sessions.delete(guild);return true;}
  async stopAll(){await Promise.all([...this.sessions.keys()].map(guild=>this.stop(guild)));}
  status(guild:string){return this.sessions.get(guild)?.pipeline;}
  async switchVoice(guild:string,id:string,alias?:string){
    const session=this.sessions.get(guild);if(!session)return false;
    if(session.pipeline.target()!==id)this.voice.cancelGroup(guild,session.groupId);
    session.pipeline.switchVoice(id,alias);return true;
  }
}
