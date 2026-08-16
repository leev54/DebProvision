import type { ScoredSample } from './types.js';
export class DatasetCurator {
  select(samples:ScoredSample[],maxCount=200,maxSeconds=600){
    const eligible=samples.filter(s=>s.active&&s.reviewStatus!=='rejected');
    const accepted=eligible.filter(s=>s.reviewStatus==='accepted'||s.selectedForRebuild).sort((a,b)=>b.qualityScore-a.qualityScore);
    const rest=eligible.filter(s=>s.reviewStatus==='pending'&&!s.selectedForRebuild&&s.qualityScore>=.65).sort((a,b)=>b.qualityScore-a.qualityScore);
    const out:ScoredSample[]=[];let ms=0;for(const s of [...accepted,...rest]){if(out.length>=maxCount||ms+s.durationMs>maxSeconds*1000)continue;if(out.some(x=>Math.abs(x.durationMs-s.durationMs)<300&&Math.abs(x.rms-s.rms)<.005))continue;out.push(s);ms+=s.durationMs;}return out;
  }
  prune(samples:ScoredSample[],maxCount:number){const keep=this.select(samples,maxCount,Number.MAX_SAFE_INTEGER);return {kept:keep,removed:samples.filter(s=>!keep.includes(s)&&s.reviewStatus!=='accepted'&&!s.selectedForRebuild)};}
}
