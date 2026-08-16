export interface Transcription {text:string}
export interface TranscriptionService {transcribeWav(audio:Uint8Array):Promise<Transcription>}
