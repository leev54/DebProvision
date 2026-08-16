import {createAudioPlayer,createAudioResource,entersState,joinVoiceChannel,AudioPlayerStatus,NoSubscriberBehavior,StreamType,VoiceConnectionStatus,type VoiceConnection} from '@discordjs/voice';
import {PassThrough,Readable} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {PlaybackQueue} from './PlaybackQueue.js';

interface GuildAudio {connection:VoiceConnection;queue:PlaybackQueue}
/** Preserve synthesized audio as binary chunks; Readable.from(bytes) emits numbers. */
export const binaryPlaybackInput=(bytes:Uint8Array)=>Readable.from([Buffer.from(bytes)]);
export class DiscordVoiceRuntime {
  constructor(private playerFactory:typeof createAudioPlayer=createAudioPlayer,private resourceFactory:typeof createAudioResource=createAudioResource){}
  private guilds=new Map<string,GuildAudio>();
  async join(guildId:string,channelId:string,adapterCreator:any){const existing=this.guilds.get(guildId);if(existing){if(existing.connection.joinConfig.channelId===channelId){if(existing.connection.state.status!==VoiceConnectionStatus.Ready)await entersState(existing.connection,VoiceConnectionStatus.Ready,20_000);return existing.connection;}existing.connection.rejoin({channelId,selfDeaf:false,selfMute:false});await entersState(existing.connection,VoiceConnectionStatus.Ready,20_000);return existing.connection;}const connection=joinVoiceChannel({guildId,channelId,adapterCreator,selfDeaf:false,selfMute:false});await entersState(connection,VoiceConnectionStatus.Ready,20_000);this.guilds.set(guildId,{connection,queue:new PlaybackQueue()});return connection;}
  connection(guildId:string){return this.guilds.get(guildId)?.connection;}
  async leave(guildId:string){const state=this.guilds.get(guildId);if(!state)return false;await state.queue.stop();state.connection.destroy();this.guilds.delete(guildId);return true;}
  queue(guildId:string){const state=this.guilds.get(guildId);if(!state)throw new Error('Join a voice channel first');return state.queue;}
  enqueueBytes(guildId:string,label:string,bytes:Uint8Array,_format:'mp3'|'wav'='mp3'){const state=this.guilds.get(guildId);if(!state)throw new Error('Join a voice channel first');const id=randomUUID();state.queue.enqueue({id,label,play:async signal=>{const player=this.playerFactory({behaviors:{noSubscriber:NoSubscriberBehavior.Play}});const resource=this.resourceFactory(binaryPlaybackInput(bytes),{inputType:StreamType.Arbitrary});state.connection.subscribe(player);signal.addEventListener('abort',()=>player.stop(true),{once:true});player.play(resource);await entersState(player,AudioPlayerStatus.Playing,10_000);await new Promise<void>((resolve,reject)=>{player.once(AudioPlayerStatus.Idle,resolve);player.once('error',reject);signal.addEventListener('abort',()=>resolve(),{once:true});});}});return id;}
  enqueueStream(guildId:string,label:string,produce:(stream:PassThrough,signal:AbortSignal)=>Promise<void>,groupId?:string){const state=this.guilds.get(guildId);if(!state)throw new Error('Join a voice channel first');const id=randomUUID();state.queue.enqueue({id,label,groupId,play:async queueSignal=>{const stream=new PassThrough({highWaterMark:64*1024}),producerController=new AbortController(),producerSignal=AbortSignal.any([queueSignal,producerController.signal]);const player=this.playerFactory({behaviors:{noSubscriber:NoSubscriberBehavior.Play}});state.connection.subscribe(player);queueSignal.addEventListener('abort',()=>{producerController.abort(queueSignal.reason);stream.destroy();player.stop(true);},{once:true});player.play(this.resourceFactory(stream,{inputType:StreamType.Arbitrary}));const generated=produce(stream,producerSignal).then(()=>stream.end()).catch(error=>{stream.destroy();throw error;});void generated.catch(()=>undefined);let playbackError:unknown;try{await new Promise<void>((resolve,reject)=>{player.once(AudioPlayerStatus.Idle,resolve);player.once('error',reject);queueSignal.addEventListener('abort',()=>resolve(),{once:true});});}catch(error){playbackError=error;producerController.abort(error);stream.destroy();}try{await generated;}catch(error){if(!playbackError)throw error;}if(playbackError)throw playbackError;}});return id;}
  cancelGroup(guildId:string,groupId:string){return this.guilds.get(guildId)?.queue.cancelGroup(groupId)??0;}
  list(guildId:string){return this.guilds.get(guildId)?.queue.list()??[];}
  skip(guildId:string){return this.guilds.get(guildId)?.queue.skip()??false;}
  async stopAll(){await Promise.all([...this.guilds.keys()].map(guild=>this.leave(guild)));}
  async stop(guildId:string){await this.guilds.get(guildId)?.queue.stop();}
}
