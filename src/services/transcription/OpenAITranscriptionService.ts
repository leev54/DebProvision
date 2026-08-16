import type {Transcription,TranscriptionService} from './TranscriptionService.js';
export class OpenAITranscriptionService implements TranscriptionService {
  constructor(private apiKey:string,private model='gpt-4o-mini-transcribe',private base='https://api.openai.com/v1'){}
  async transcribeWav(audio:Uint8Array):Promise<Transcription>{const form=new FormData();form.set('model',this.model);form.set('response_format','json');form.set('file',new Blob([Buffer.from(audio)],{type:'audio/wav'}),'speech.wav');const response=await fetch(`${this.base}/audio/transcriptions`,{method:'POST',headers:{Authorization:`Bearer ${this.apiKey}`},body:form,signal:AbortSignal.timeout(30_000)});if(!response.ok)throw new Error(`Transcription failed: ${response.status} ${(await response.text()).slice(0,300)}`);const body=await response.json() as {text?:string};return {text:body.text?.trim()??'',confidence:body.text?.trim()?1:0};}
}
