export interface Transcription {text:string;confidence:number}
export interface TranscriptionService {transcribeWav(audio:Uint8Array):Promise<Transcription>}
