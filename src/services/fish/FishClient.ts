import { readFile } from 'node:fs/promises';
import path from 'node:path';
import WebSocket from 'ws';
import {decode,encode} from '@msgpack/msgpack';
import type { VoiceProvider,VoiceReference } from './VoiceProvider.js';
export class FishApiError extends Error {constructor(message:string,readonly status:number|undefined,readonly retryable:boolean,readonly diagnostic?:string){super(message);this.name='FishApiError';}}

export class FishClient implements VoiceProvider {
  constructor(private apiKey:string,private base='https://api.fish.audio',private timeoutMs=60_000,private ttsModel:'s1'|'s2-pro'|'s2.1-pro'|'s2.1-pro-free'='s2.1-pro-free',private realtimeModel:'s1'|'s2-pro'|'s2.1-pro'|'s2.1-pro-free'='s2-pro'){}
  private headers(extra:HeadersInit={}){return {Authorization:`Bearer ${this.apiKey}`,...extra};}
  private async request(url:string,init:RequestInit,operation:string){
    let res:Response;try{res=await fetch(url,{...init,signal:init.signal?AbortSignal.any([init.signal,AbortSignal.timeout(this.timeoutMs)]):AbortSignal.timeout(this.timeoutMs)});}catch{if(init.signal?.aborted)throw init.signal.reason;throw new FishApiError(`${operation} transport failed`,undefined,true);}
    if(!res.ok){const detail=(await res.text()).replace(/\s+/g,' ').slice(0,500);throw new FishApiError(`${operation} failed (${res.status})`,res.status,res.status===429||res.status>=500,detail||undefined);}
    return res;
  }
  async createVoice(input:{name:string;references:VoiceReference[]}){
    if(!input.references.length)throw new Error('Fish model creation requires at least one reference');
    if(input.references.length>20)throw new Error('Fish model creation supports at most 20 references');
    const form=new FormData();form.set('title',input.name);form.set('visibility','private');form.set('type','tts');form.set('train_mode','fast');
    const transcripts=input.references.map(r=>r.transcript?.trim());
    if(transcripts.some(Boolean)&&!transcripts.every(Boolean))throw new Error('Fish reference transcripts must be supplied for every reference or omitted for automatic ASR');
    for(const r of input.references)form.append('voices',new Blob([await readFile(r.path)]),path.basename(r.path));
    if(transcripts.every(Boolean))for(const transcript of transcripts)form.append('texts',transcript!);
    const res=await this.request(`${this.base}/model`,{method:'POST',headers:this.headers(),body:form},'Fish model creation');
    const body=await res.json() as {id?:string;_id?:string};const id=body.id??body._id;if(!id)throw new Error('Fish returned no model ID');return {id};
  }
  async synthesize(i:{voiceId:string;text:string;speed?:number;signal?:AbortSignal}){
    if(i.speed!==undefined&&(i.speed<.5||i.speed>2))throw new Error('Fish TTS speed must be between 0.5 and 2.0');
    const res=await this.request(`${this.base}/v1/tts`,{method:'POST',headers:this.headers({'Content-Type':'application/json',model:this.ttsModel}),body:JSON.stringify({text:i.text,reference_id:i.voiceId,format:'mp3',latency:'balanced',prosody:{speed:i.speed??1}}),signal:i.signal},'Fish TTS');
    const bytes=new Uint8Array(await res.arrayBuffer());if(!bytes.length)throw new Error('Fish TTS returned empty audio');return bytes;
  }
  async streamSynthesize(i:{voiceId:string;text:string;speed?:number},onAudio:(chunk:Uint8Array)=>Promise<void>|void,signal?:AbortSignal){
    if(i.speed!==undefined&&(i.speed<.5||i.speed>2))throw new Error('Fish TTS speed must be between 0.5 and 2.0');
    const url=new URL('/v1/tts/live',this.base.replace(/^http/,'ws'));
    await new Promise<void>((resolve,reject)=>{
      const ws=new WebSocket(url,{headers:{Authorization:`Bearer ${this.apiKey}`,model:this.realtimeModel}});let settled=false,successfulFinish=false,receivedAudio=false;let audioWrites=Promise.resolve();let firstTimer:NodeJS.Timeout|undefined,idleTimer:NodeJS.Timeout|undefined;
      const openTimer=setTimeout(()=>finish(new Error('Fish realtime TTS connection timeout')),this.timeoutMs);
      const clearTimers=()=>{clearTimeout(openTimer);if(firstTimer)clearTimeout(firstTimer);if(idleTimer)clearTimeout(idleTimer);};
      const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimers();signal?.removeEventListener('abort',abort);ws.removeAllListeners();ws.on('error',()=>undefined);if(ws.readyState===WebSocket.OPEN)ws.close();else if(ws.readyState===WebSocket.CONNECTING)ws.terminate();if(error)reject(error);else resolve();};
      const resetIdle=()=>{if(idleTimer)clearTimeout(idleTimer);idleTimer=setTimeout(()=>finish(new Error('Fish realtime TTS idle timeout')),this.timeoutMs);};
      const abort=()=>finish(new DOMException('TTS streaming aborted','AbortError'));if(signal?.aborted)return abort();signal?.addEventListener('abort',abort,{once:true});
      ws.once('open',()=>{clearTimeout(openTimer);firstTimer=setTimeout(()=>finish(new Error('Fish realtime TTS first-audio timeout')),this.timeoutMs);resetIdle();ws.send(encode({event:'start',request:{text:'',reference_id:i.voiceId,format:'mp3',latency:'balanced',prosody:{speed:i.speed??1}}}));ws.send(encode({event:'text',text:i.text}));ws.send(encode({event:'flush'}));ws.send(encode({event:'stop'}));});
      ws.on('message',data=>{try{resetIdle();const event=decode(data instanceof Buffer?data:Buffer.from(data as ArrayBuffer)) as {event?:string;audio?:Uint8Array;message?:string;reason?:string};if(event.event==='audio'&&event.audio?.length){receivedAudio=true;if(firstTimer)clearTimeout(firstTimer);audioWrites=audioWrites.then(()=>onAudio(event.audio!) as Promise<void>|void);audioWrites.catch(error=>finish(error instanceof Error?error:new Error(String(error))));}else if(event.event==='finish'){if(event.reason!=='stop')return finish(new Error(`Fish realtime TTS failed: finish reason ${event.reason??'missing'}`));if(!receivedAudio)return finish(new Error('Fish realtime TTS finished without audio'));successfulFinish=true;void audioWrites.then(()=>finish(),error=>finish(error instanceof Error?error:new Error(String(error))));}else if(event.event==='error')finish(new Error(`Fish realtime TTS failed: ${event.message??'unknown error'}`));}catch(error){finish(error instanceof Error?error:new Error(String(error)));}});
      ws.once('error',error=>finish(error));ws.once('close',()=>{if(!successfulFinish)finish(new Error('Fish realtime TTS socket closed before finish(stop)'));});
    });
  }
  async deleteVoice(id:string){
    const res=await fetch(`${this.base}/model/${encodeURIComponent(id)}`,{method:'DELETE',headers:this.headers(),signal:AbortSignal.timeout(this.timeoutMs)});
    if(!res.ok&&res.status!==404){const detail=(await res.text()).replace(/\s+/g,' ').slice(0,500);throw new FishApiError(`Fish deletion failed (${res.status})`,res.status,res.status===429||res.status>=500,detail||undefined);}
  }
}
