import type { VoiceProvider } from '../services/fish/VoiceProvider.js';
import type { ScoredSample } from './types.js';
import { DatasetCurator } from './DatasetCurator.js';
import type {ProviderDeletionOutcome} from '../services/fish/ProviderDeletionQueue.js';
import {realpath} from 'node:fs/promises';import path from 'node:path';
export class VoiceModelBuilder {
  constructor(private provider:VoiceProvider,private cleanup:(id:string)=>Promise<ProviderDeletionOutcome>,private curator=new DatasetCurator(),private maxCount=20,private maxSeconds=600,private stage:(id:string)=>void=()=>{},private unstage:(id:string)=>void=()=>{},private managedRoot?:string){}
  async build(name:string,samples:ScoredSample[],validate:(id:string)=>Promise<void>){
    const selected=this.curator.select(samples,Math.min(20,this.maxCount),this.maxSeconds).filter(s=>s.filePath&&s.reviewStatus!=='rejected');
    if(!selected.length)throw new Error('No curated reference samples');
    if(this.managedRoot){const root=await realpath(this.managedRoot);for(const sample of selected){const file=await realpath(sample.filePath!);const parts=path.relative(root,file).split(path.sep);if(!file.startsWith(`${root}${path.sep}`)||parts.length!==3||!/^\d{15,22}$/.test(parts[0]!)||!/^\d{15,22}$/.test(parts[1]!)||!(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.wav$/i).test(parts[2]!))throw new Error('Curated reference is outside managed training storage');}}
    const replacement=await this.provider.createVoice({name,references:selected.map(s=>({path:s.filePath!,...(s.transcript?.trim()?{transcript:s.transcript.trim()}: {})}))});
    try{this.stage(replacement.id);}catch(stageError){
      try{await this.cleanup(replacement.id);}catch(outboxError){
        try{await this.provider.deleteVoice(replacement.id);}catch(deleteError){throw new AggregateError([stageError,outboxError,deleteError],'Provider candidate staging failed and cleanup durability could not be guaranteed');}
      }
      throw stageError;
    }
    try{await validate(replacement.id);return {...replacement,selectedIds:selected.map(sample=>sample.id)};}catch(e){const cleanup=await this.cleanup(replacement.id);this.unstage(replacement.id);if(cleanup!=='deleted')throw new AggregateError([e],'Model validation failed; provider cleanup did not complete');throw e;}
  }
}
