import type { ScoredSample } from './types.js';
export class BestSampleSelector {
  private ranked=new Map<string,ScoredSample[]>();
  add(s:ScoredSample){const a=this.ranked.get(s.ownerId)??[];a.push(s);a.sort((x,y)=>y.qualityScore-x.qualityScore);this.ranked.set(s.ownerId,a.slice(0,20));return this.top(s.ownerId,1)[0];}
  top(owner:string,n=5){return (this.ranked.get(owner)??[]).filter(s=>s.active&&s.reviewStatus!=='rejected').slice(0,n);}
  chooseNovel(owner:string,previous:ScoredSample[]=[]){return this.top(owner).find(s=>previous.every(p=>Math.abs(p.durationMs-s.durationMs)>1000||Math.abs(p.rms-s.rms)>.02));}
  accept(owner:string,id:string){const s=this.top(owner,20).find(x=>x.id===id);if(s){s.reviewStatus='accepted';s.selectedForRebuild=true;s.isBestSample=true;}return s;}
  reject(owner:string,id:string){const s=(this.ranked.get(owner)??[]).find(x=>x.id===id);if(s){s.reviewStatus='rejected';s.selectedForRebuild=false;s.isBestSample=false;}return s;}
}
