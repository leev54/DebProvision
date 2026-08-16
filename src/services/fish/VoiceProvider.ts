export interface VoiceReference {path:string;transcript?:string}
export interface SynthesisInput {voiceId:string;text:string;speed?:number}
export interface VoiceProvider {
  createVoice(input:{name:string;references:VoiceReference[]}):Promise<{id:string}>;
  synthesize(input:SynthesisInput):Promise<Uint8Array>;
  streamSynthesize(input:SynthesisInput,onAudio:(chunk:Uint8Array)=>Promise<void>|void,signal?:AbortSignal):Promise<void>;
  deleteVoice(id:string):Promise<void>;
}
