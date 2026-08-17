import type {PassThrough} from 'node:stream';
export interface MusicTrack {title:string;artist?:string;durationSeconds?:number;sourceId:string;sourceUrl:string;requesterId:string}
export interface MusicSourceResolver {resolve(query:string,requesterId:string,signal?:AbortSignal):Promise<MusicTrack|undefined>;stream(track:MusicTrack,output:PassThrough,signal:AbortSignal):Promise<void>;stopAll():Promise<void>}
