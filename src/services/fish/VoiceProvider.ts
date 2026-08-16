export interface VoiceReference {path:string;transcript?:string}
export interface VoiceProvider {createVoice(input:{name:string;references:VoiceReference[]}):Promise<{id:string}>;synthesize(input:{voiceId:string;text:string;speed?:number}):Promise<Uint8Array>;deleteVoice(id:string):Promise<void>;transcribe?(audio:Uint8Array):Promise<{text:string;confidence:number}>;}
