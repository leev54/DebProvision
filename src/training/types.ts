/** Metrics in this type are derived directly from the captured PCM. */
export interface Features {durationMs:number;speechRatio:number;silenceRatio:number;rms:number;peak:number;clippingRatio:number;snrEstimate:number;continuity?:number}
export interface ScoredSample extends Features {id:string;ownerId:string;qualityScore:number;reasons:string[];exceptionalCandidate:boolean;selectedForRebuild:boolean;isBestSample:boolean;active:boolean;filePath?:string;capturedAt:number}
