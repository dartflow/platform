export type WinByTwo={maximum:number};
/** The published best-of sets the initial target; the cap makes the final tie decisive. */
export function seriesWinner(scores:number[],bestOf:number,extension?:WinByTwo):0|1|null{
 const target=Math.ceil(bestOf/2),side=scores[0]>scores[1]?0:1;
 if(scores[side]<target||scores[0]===scores[1])return null;
 return !extension||Math.abs(scores[0]-scores[1])>=2||scores[0]+scores[1]>=extension.maximum?side:null;
}
