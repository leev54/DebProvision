import type {Features} from './types.js';

export class SampleFeatureExtractor {
  extract(pcm:Int16Array,sampleRate=48_000,channels=2):Features {
    const frameSamples=Math.max(channels,Math.round(sampleRate*channels*.02));
    const levels:number[]=[];let sum=0,peak=0,clip=0;
    for(let start=0;start<pcm.length;start+=frameSamples){let frameSum=0;const end=Math.min(pcm.length,start+frameSamples);for(let i=start;i<end;i++){const a=Math.abs(pcm[i]!)/32768;sum+=a*a;frameSum+=a*a;peak=Math.max(peak,a);if(a>.98)clip++;}levels.push(Math.sqrt(frameSum/Math.max(1,end-start)));}
    const sorted=[...levels].sort((a,b)=>a-b);const noiseFloor=sorted[Math.floor(sorted.length*.2)]??0;
    const speechThreshold=Math.max(.006,noiseFloor*3);const voiced=levels.map(x=>x>=speechThreshold);const speechFrames=voiced.filter(Boolean).length;
    let runs=0;for(let i=0;i<voiced.length;i++)if(voiced[i]&&(i===0||!voiced[i-1]))runs++;
    const rms=Math.sqrt(sum/Math.max(1,pcm.length));const speechLevel=levels.filter((_,i)=>voiced[i]).reduce((a,x)=>a+x,0)/Math.max(1,speechFrames);
    const snrEstimate=Math.max(0,20*Math.log10((speechLevel+1e-6)/(noiseFloor+1e-6)));
    const speechRatio=speechFrames/Math.max(1,levels.length);
    // Fewer fragmented voiced runs means more continuous speech; this is PCM-derived.
    const continuity=speechFrames?Math.max(0,1-(runs-1)/speechFrames):0;
    return {durationMs:pcm.length/sampleRate/channels*1000,speechRatio,silenceRatio:1-speechRatio,rms,peak,clippingRatio:clip/Math.max(1,pcm.length),snrEstimate,continuity};
  }
}
