export type X01Hit=string;
export function dartValue(hit:string):number{
 if(hit==='MISS')return 0;if(hit==='SB')return 25;if(hit==='DB')return 50;
 const match=/^([SDT])([1-9]|1[0-9]|20)$/.exec(hit);if(!match)throw new Error('Ongeldige pijl. Kies MISS, S1–S20, D1–D20, T1–T20, SB of DB.');
 return Number(match[2])*(match[1]==='T'?3:match[1]==='D'?2:1);
}
/** Sequential evaluation never invents targets from a visit total. */
export function evaluateX01Visit(input:{remaining:number;opened?:boolean;outRule?:'straight'|'double'|'master';hits:string[]}){
 if(!Number.isInteger(input.remaining)||input.remaining<1||!Array.isArray(input.hits)||input.hits.length<1||input.hits.length>3)throw new Error('Een beurt bestaat uit één tot drie geldige pijlen.');
 const originalOpened=input.opened??true;let opened=originalOpened,remaining=input.remaining,observedScore=0;
 const out=input.outRule??'double';let endReason:'turn'|'bust'|'finish'='turn';
 for(const hit of input.hits){
  if(endReason!=='turn')throw new Error('Er kan geen pijl volgen na een finish of bust.');
  const value=dartValue(hit);observedScore+=value;
  const double=hit==='DB'||hit.startsWith('D');
  if(!opened){if(!double)continue;opened=true;}
  remaining-=value;
  if(remaining<0||(out!=='straight'&&remaining===1)||(remaining===0&&!(out==='straight'||double||out==='master'&&hit.startsWith('T')))){
   endReason='bust';remaining=input.remaining;opened=originalOpened;
  }else if(remaining===0)endReason='finish';
 }
 return {remaining,opened,endReason,observedScore,points:endReason==='bust'?0:input.remaining-remaining,countedDarts:endReason==='finish'?input.hits.length:3};
}
