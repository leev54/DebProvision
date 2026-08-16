import type {Transcription,TranscriptionService} from './TranscriptionService.js';

/** Fish Audio's official multipart POST /v1/asr implementation. */
export class FishTranscriptionService implements TranscriptionService {
  constructor(private apiKey:string,private base='https://api.fish.audio',private timeoutMs=30_000){}
  async transcribeWav(audio:Uint8Array,signal?:AbortSignal):Promise<Transcription>{
    const form=new FormData();
    form.set('audio',new Blob([Buffer.from(audio)],{type:'audio/wav'}),'speech.wav');
    form.set('ignore_timestamps','true');
    const timeout=AbortSignal.timeout(this.timeoutMs);const combined=signal?AbortSignal.any([signal,timeout]):timeout;
    const response=await fetch(`${this.base}/v1/asr`,{method:'POST',headers:{Authorization:`Bearer ${this.apiKey}`},body:form,signal:combined});
    if(!response.ok)throw new Error(`Fish ASR failed: ${response.status} ${(await response.text()).replace(/\s+/g,' ').slice(0,300)}`);
    const body=await response.json() as {text:string};
    return {text:body.text.trim()};
  }
}
