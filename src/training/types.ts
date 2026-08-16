/** Metrics in this type are derived directly from the captured PCM. */
export interface Features {durationMs:number;speechRatio:number;silenceRatio:number;rms:number;peak:number;clippingRatio:number;snrEstimate:number;continuity?:number}
export type SampleReviewStatus='pending'|'accepted'|'rejected';
export interface ScoredSample extends Features {id:string;ownerId:string;qualityScore:number;reasons:string[];exceptionalCandidate:boolean;selectedForRebuild:boolean;isBestSample:boolean;reviewStatus:SampleReviewStatus;active:boolean;filePath?:string;transcript?:string;capturedAt:number}
