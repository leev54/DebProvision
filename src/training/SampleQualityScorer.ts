import type {Features,ScoredSample} from './types.js';
const clamp=(x:number)=>Math.max(0,Math.min(1,x));
export class SampleQualityScorer {
  score(f:Features,base:{id:string;ownerId:string;capturedAt?:number}):ScoredSample {
    const duration=clamp(1-Math.abs(f.durationMs-18_000)/18_000);const loudness=clamp(f.rms/.08)*clamp((.35-f.rms)/.2);const snr=clamp(f.snrEstimate/30);const unclipped=1-clamp(f.clippingRatio*20);
    let qualityScore=.25*duration+.25*f.speechRatio+.15*loudness+.2*snr+.1*unclipped+.05*(f.continuity??0);
    if(f.durationMs<5000||f.durationMs>30000)qualityScore*=.45;if(f.speechRatio<.35)qualityScore*=.5;qualityScore=clamp(qualityScore);
    const reasons:string[]=[];
    if(f.snrEstimate>=20)reasons.push(`Strong measured SNR (${f.snrEstimate.toFixed(1)} dB)`);else reasons.push(`Measured SNR ${f.snrEstimate.toFixed(1)} dB`);
    reasons.push(`${(f.speechRatio*100).toFixed(0)}% speech detected`);
    if(f.durationMs>=8000&&f.durationMs<=30000)reasons.push(`Good ${(f.durationMs/1000).toFixed(1)} second duration`);
    if(f.clippingRatio<.001)reasons.push('No clipping detected');else reasons.push(`${(f.clippingRatio*100).toFixed(2)}% clipped samples`);
    return {...f,...base,capturedAt:base.capturedAt??Date.now(),qualityScore,reasons,exceptionalCandidate:qualityScore>=.9&&f.durationMs>=10000&&f.durationMs<=30000&&f.clippingRatio<.002&&f.speechRatio>.75,selectedForRebuild:false,isBestSample:false,active:true};
  }
}
