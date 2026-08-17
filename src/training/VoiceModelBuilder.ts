import type { VoiceProvider } from '../services/fish/VoiceProvider.js';
import type { ScoredSample } from './types.js';
import { DatasetCurator } from './DatasetCurator.js';
import type {ProviderDeletionOutcome} from '../services/fish/ProviderDeletionQueue.js';
import {realpath,stat} from 'node:fs/promises';import path from 'node:path';
export interface RebuildPlan {selectedSamples:ScoredSample[];selectedIds:string[];selectedBytes:number;candidateCount:number}
export class VoiceModelBuilder {
  constructor(private provider:VoiceProvider,private cleanup:(id:string)=>Promise<ProviderDeletionOutcome>,private curator=new DatasetCurator(),private maxCount=20,private maxSeconds=600,private stage:(id:string)=>void=()=>{},private unstage:(id:string)=>void=()=>{},private managedRoot?:string,private maxUploadBytes=8*1024*1024){}
  async plan(samples:ScoredSample[]):Promise<RebuildPlan>{
    const candidates=samples.filter(s=>s.filePath&&s.reviewStatus!=='rejected'),curated=this.curator.select(candidates,Math.min(20,this.maxCount),this.maxSeconds);const selectedSamples:ScoredSample[]=[];let selectedBytes=0;
    const uploadBudget=Math.floor(this.maxUploadBytes*.9);for(const sample of curated){const bytes=await stat(sample.filePath!).then(x=>x.size,()=>1);if(!bytes||selectedBytes+bytes>uploadBudget)continue;selectedSamples.push(sample);selectedBytes+=bytes;}
    return {selectedSamples,selectedIds:selectedSamples.map(x=>x.id),selectedBytes,candidateCount:candidates.length};
  }
  async build(name:string,samples:ScoredSample[],validate:(id:string)=>Promise<void>){
    const planned=await this.plan(samples),selected=[...planned.selectedSamples];
    if(!selected.length)throw new Error('No curated reference samples');
    if(this.managedRoot){const root=await realpath(this.managedRoot);for(const sample of selected){const file=await realpath(sample.filePath!);const parts=path.relative(root,file).split(path.sep);if(!file.startsWith(`${root}${path.sep}`)||parts.length!==3||!/^\d{15,22}$/.test(parts[0]!)||!/^\d{15,22}$/.test(parts[1]!)||!(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.wav$/i).test(parts[2]!))throw new Error('Curated reference is outside managed training storage');}}
    let replacement:{id:string};for(;;){try{replacement=await this.provider.createVoice({name,references:selected.map(s=>({path:s.filePath!,...(s.transcript?.trim()?{transcript:s.transcript.trim()}: {})}))});break;}catch(error){if(!(error instanceof Error)||!('status' in error)||(error as Error&{status?:number}).status!==413||selected.length<=1)throw error;selected.pop();}}
    try{this.stage(replacement.id);}catch(stageError){
      try{await this.cleanup(replacement.id);}catch(outboxError){
        try{await this.provider.deleteVoice(replacement.id);}catch(deleteError){throw new AggregateError([stageError,outboxError,deleteError],'Provider candidate staging failed and cleanup durability could not be guaranteed');}
      }
      throw stageError;
    }
    try{await validate(replacement.id);return {...replacement,selectedIds:selected.map(sample=>sample.id)};}catch(e){const cleanup=await this.cleanup(replacement.id);this.unstage(replacement.id);if(cleanup!=='deleted')throw new AggregateError([e],'Model validation failed; provider cleanup did not complete');throw e;}
  }
}
