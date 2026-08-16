import type { VoiceProvider } from '../services/fish/VoiceProvider.js';
import type { ScoredSample } from './types.js';
import { DatasetCurator } from './DatasetCurator.js';
import type {ProviderDeletionOutcome} from '../services/fish/ProviderDeletionQueue.js';
export class VoiceModelBuilder {
  constructor(private provider:VoiceProvider,private cleanup:(id:string)=>Promise<ProviderDeletionOutcome>,private curator=new DatasetCurator(),private maxCount=20,private maxSeconds=600){}
  async build(name:string,samples:ScoredSample[],validate:(id:string)=>Promise<void>){
    const selected=this.curator.select(samples,Math.min(20,this.maxCount),this.maxSeconds).filter(s=>s.filePath&&s.reviewStatus!=='rejected');
    if(!selected.length)throw new Error('No curated reference samples');
    const replacement=await this.provider.createVoice({name,references:selected.map(s=>({path:s.filePath!,...(s.transcript?.trim()?{transcript:s.transcript.trim()}: {})}))});
    try{await validate(replacement.id);return replacement;}catch(e){const cleanup=await this.cleanup(replacement.id);if(cleanup!=='deleted')throw new AggregateError([e],'Model validation failed; provider cleanup did not complete');throw e;}
  }
}
