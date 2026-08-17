import type {VoiceProvider} from '../services/fish/VoiceProvider.js';
import {FishApiError} from '../services/fish/FishClient.js';
import type {ScoredSample} from './types.js';
import {DatasetCurator} from './DatasetCurator.js';
import type {ProviderDeletionOutcome} from '../services/fish/ProviderDeletionQueue.js';
import {realpath,stat} from 'node:fs/promises';
import path from 'node:path';
import {PublicCommandError} from '../discord/PublicCommandError.js';
import {logger} from '../utils/logger.js';

export class VoiceModelBuilder {
  constructor(private provider:VoiceProvider,private cleanup:(id:string)=>Promise<ProviderDeletionOutcome>,private curator=new DatasetCurator(),private maxCount=20,private maxSeconds=600,private stage:(id:string)=>void=()=>{},private unstage:(id:string)=>void=()=>{},private managedRoot?:string,private maxUploadMb=64){}
  async build(name:string,samples:ScoredSample[],validate:(id:string)=>Promise<void>){
    const candidates=this.curator.select(samples,Math.min(20,this.maxCount),this.maxSeconds).filter(s=>s.filePath&&s.reviewStatus!=='rejected');
    if(!candidates.length)throw new Error('No curated reference samples');
    if(this.managedRoot){const root=await realpath(this.managedRoot);for(const sample of candidates){const file=await realpath(sample.filePath!);const parts=path.relative(root,file).split(path.sep);if(!file.startsWith(`${root}${path.sep}`)||parts.length!==3||!/^[0-9]{15,22}$/.test(parts[0]!)||!/^[0-9]{15,22}$/.test(parts[1]!)||!(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.wav$/i).test(parts[2]!))throw new Error('Curated reference is outside managed training storage');}}
    const sized=await Promise.all(candidates.map(async sample=>({sample,bytes:await stat(sample.filePath!).then(value=>value.size,error=>{if(this.managedRoot)throw error;return 0})})));
    const configuredBytes=Math.floor(this.maxUploadMb*1024*1024),headroomBytes=Math.floor(configuredBytes*.95);let targetBytes=headroomBytes,replacement:{id:string}|undefined,selected:typeof sized=[];
    for(let attempt=1;attempt<=3;attempt++){
      selected=[];let total=0;for(const item of sized)if(item.bytes<=targetBytes-total){selected.push(item);total+=item.bytes;}
      if(!selected.length)throw new PublicCommandError('No eligible training reference fits the configured Fish upload budget. The original recordings were preserved.');
      logger.info({attempt,eligibleCandidateCount:sized.length,selectedReferenceCount:selected.length,selectedTotalBytes:total,configuredByteBudget:configuredBytes},'creating Fish voice model');
      try{replacement=await this.provider.createVoice({name,references:selected.map(({sample})=>({path:sample.filePath!,...(sample.transcript?.trim()?{transcript:sample.transcript.trim()}: {})}))});break;}catch(error){
        logger.warn({attempt,eligibleCandidateCount:sized.length,selectedReferenceCount:selected.length,selectedTotalBytes:total,configuredByteBudget:configuredBytes,status:error instanceof FishApiError?error.status:undefined},'Fish voice model creation failed');
        if(!(error instanceof FishApiError)||error.status!==413)throw error;
        if(attempt===3||selected.length===1)throw new PublicCommandError('Fish rejected the training upload as too large even after reducing the reference set. The original recordings were preserved.');
        targetBytes=Math.max(1,Math.floor(total*.5));
      }
    }
    if(!replacement)throw new PublicCommandError('Fish rejected the training upload as too large. The original recordings were preserved.');
    try{this.stage(replacement.id);}catch(stageError){try{await this.cleanup(replacement.id);}catch(outboxError){try{await this.provider.deleteVoice(replacement.id);}catch(deleteError){throw new AggregateError([stageError,outboxError,deleteError],'Provider candidate staging failed and cleanup durability could not be guaranteed');}}throw stageError;}
    try{await validate(replacement.id);return {...replacement,selectedIds:selected.map(({sample})=>sample.id)};}catch(error){const cleanup=await this.cleanup(replacement.id);this.unstage(replacement.id);if(cleanup!=='deleted')throw new AggregateError([error],'Model validation failed; provider cleanup did not complete');throw error;}
  }
}
