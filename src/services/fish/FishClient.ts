import { readFile } from 'node:fs/promises';
import path from 'node:path';
import WebSocket from 'ws';
import {decode,encode} from '@msgpack/msgpack';
import type { VoiceProvider,VoiceReference } from './VoiceProvider.js';

export class FishClient implements VoiceProvider {
  constructor(private apiKey:string,private base='https://api.fish.audio',private timeoutMs=60_000){}
  private headers(extra:HeadersInit={}){return {Authorization:`Bearer ${this.apiKey}`,...extra};}
  private async request(url:string,init:RequestInit,operation:string){
    const res=await fetch(url,{...init,signal:AbortSignal.timeout(this.timeoutMs)});
    if(!res.ok){const detail=(await res.text()).replace(/\s+/g,' ').slice(0,500);throw new Error(`${operation} failed: ${res.status}${detail?` — ${detail}`:''}`);}
    return res;
  }
  async createVoice(input:{name:string;references:VoiceReference[]}){
    if(!input.references.length)throw new Error('Fish model creation requires at least one reference');
    const form=new FormData();form.set('title',input.name);form.set('visibility','private');form.set('type','tts');form.set('train_mode','fast');
    for(const r of input.references){form.append('voices',new Blob([await readFile(r.path)]),path.basename(r.path));form.append('texts',r.transcript??'');}
    const res=await this.request(`${this.base}/model`,{method:'POST',headers:this.headers(),body:form},'Fish model creation');
    const body=await res.json() as {id?:string;_id?:string};const id=body.id??body._id;if(!id)throw new Error('Fish returned no model ID');return {id};
  }
  async synthesize(i:{voiceId:string;text:string;speed?:number}){
    const res=await this.request(`${this.base}/v1/tts`,{method:'POST',headers:this.headers({'Content-Type':'application/json'}),body:JSON.stringify({text:i.text,reference_id:i.voiceId,format:'mp3',latency:'balanced',prosody:{speed:i.speed??1}})},'Fish TTS');
    const bytes=new Uint8Array(await res.arrayBuffer());if(!bytes.length)throw new Error('Fish TTS returned empty audio');return bytes;
  }
  async streamSynthesize(i:{voiceId:string;text:string;speed?:number},onAudio:(chunk:Uint8Array)=>Promise<void>|void,signal?:AbortSignal){
    const url=new URL('/v1/tts/live',this.base.replace(/^http/,'ws'));
    await new Promise<void>((resolve,reject)=>{
      const ws=new WebSocket(url,{headers:{Authorization:`Bearer ${this.apiKey}`}});let settled=false;let audioWrites=Promise.resolve();
      const finish=(error?:Error)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',abort);if(error)reject(error);else resolve();};
      const abort=()=>{ws.close();finish(new DOMException('TTS streaming aborted','AbortError'));};signal?.addEventListener('abort',abort,{once:true});
      ws.once('open',()=>{ws.send(encode({event:'start',request:{text:'',reference_id:i.voiceId,format:'mp3',latency:'balanced',prosody:{speed:i.speed??1}}}));ws.send(encode({event:'text',text:i.text}));ws.send(encode({event:'flush'}));ws.send(encode({event:'stop'}));});
      ws.on('message',data=>{try{const event=decode(data instanceof Buffer?data:Buffer.from(data as ArrayBuffer)) as {event?:string;audio?:Uint8Array;message?:string};if(event.event==='audio'&&event.audio?.length)audioWrites=audioWrites.then(()=>onAudio(event.audio!) as Promise<void>|void);else if(event.event==='finish')void audioWrites.then(()=>finish(),error=>finish(error instanceof Error?error:new Error(String(error))));else if(event.event==='error')finish(new Error(`Fish realtime TTS failed: ${event.message??'unknown error'}`));}catch(error){finish(error instanceof Error?error:new Error(String(error)));}});
      ws.once('error',error=>finish(error));ws.once('close',()=>void audioWrites.then(()=>finish(),error=>finish(error instanceof Error?error:new Error(String(error)))));
    });
  }
  async deleteVoice(id:string){
    const res=await fetch(`${this.base}/model/${encodeURIComponent(id)}`,{method:'DELETE',headers:this.headers(),signal:AbortSignal.timeout(this.timeoutMs)});
    if(!res.ok&&res.status!==404){const detail=(await res.text()).replace(/\s+/g,' ').slice(0,500);throw new Error(`Fish deletion failed: ${res.status}${detail?` — ${detail}`:''}`);}
  }
}
