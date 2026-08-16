import {EndBehaviorType,type VoiceConnection} from '@discordjs/voice';
import prism from 'prism-media';
import type {VoiceProvider} from '../services/fish/VoiceProvider.js';
import type {TranscriptionService} from '../services/transcription/TranscriptionService.js';
import type {DiscordVoiceRuntime} from '../voice/DiscordVoiceRuntime.js';
import {wavFromPcm} from '../audio/wav.js';
import {LiveVoicePipeline} from './LiveVoicePipeline.js';
import {logger} from '../utils/logger.js';

export class DiscordLiveService {
  private sessions=new Map<string,{pipeline:LiveVoicePipeline;detach:()=>void}>();
  constructor(private transcription:TranscriptionService,private fish:VoiceProvider,private voice:DiscordVoiceRuntime,private maxLagMs=3000){}
  start(guild:string,connection:VoiceConnection,sourceUser:string,voiceId:string){if(this.sessions.has(guild))throw new Error('Live mode is already active');const pipeline=new LiveVoicePipeline(sourceUser,voiceId,this.maxLagMs);const handler=(user:string)=>{if(user!==sourceUser)return;const began=Date.now();const opus=connection.receiver.subscribe(user,{end:{behavior:EndBehaviorType.AfterSilence,duration:350}});const decoder=new prism.opus.Decoder({rate:48_000,channels:2,frameSize:960});const chunks:Buffer[]=[];decoder.on('data',(b:Buffer)=>chunks.push(Buffer.from(b)));decoder.once('end',()=>void this.process(guild,pipeline,Buffer.concat(chunks),began));opus.pipe(decoder);};connection.receiver.speaking.on('start',handler);this.sessions.set(guild,{pipeline,detach:()=>connection.receiver.speaking.off('start',handler)});}
  private async process(guild:string,pipeline:LiveVoicePipeline,pcm:Buffer,began:number){if(pcm.length<9600)return;try{const capture=Date.now()-began;if(capture>this.maxLagMs*2)return;const sttAt=Date.now();const result=await this.transcription.transcribeWav(wavFromPcm(pcm));const stt=Date.now()-sttAt;if(!result.text)return;const ttsAt=Date.now();const audio=await this.fish.synthesize({voiceId:pipeline.target(),text:result.text});const tts=Date.now()-ttsAt;this.voice.enqueueBytes(guild,`Live: ${result.text.slice(0,50)}`,audio);pipeline.latency.record({capture,stt,tts,buffer:0,total:Date.now()-began});}catch(err){logger.error({err,guild},'live utterance failed');}}
  stop(guild:string){const session=this.sessions.get(guild);if(!session)return false;session.detach();session.pipeline.stop();this.sessions.delete(guild);return true;}
  status(guild:string){return this.sessions.get(guild)?.pipeline;}
  switchVoice(guild:string,id:string){const p=this.status(guild);if(!p)return false;p.switchVoice(id);return true;}
}
