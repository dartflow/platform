/** Public display events contain no writer capability, actor ID, or request secret. */
export type OcheScoreEvent = {id:string;revision:number;kind:'score'|'undo';score?:number;checkout?:boolean;bust?:boolean;playerIndex?:number;playerName?:string};
export type OcheCueSnapshot = {sessionKey?:string;scoreEvents?:OcheScoreEvent[];match?:null|{revision:number;players:{name:string}[]}};
export type OcheCue = {id:string;kind:'maximum'|'finish';label:'Maximum'|'Hoge finish';score:number;player:string;startedAt:number};
export const OCHE_CUE_DURATION=1800;
export function celebrationForEvent(event:OcheScoreEvent):Pick<OcheCue,'kind'|'label'|'score'>|null{
  const score=event.score;
  if(event.kind!=='score'||event.bust||typeof score!=='number'||!Number.isInteger(score))return null;
  if(event.checkout&&score>=100)return {kind:'finish',label:'Hoge finish',score};
  if(!event.checkout&&event.score===180)return {kind:'maximum',label:'Maximum',score:180};
  return null;
}

/** Initial load and reconnect establish a baseline; only newly accepted events celebrate. */
export function createOcheVisuals(clock:()=>number=Date.now){
  let sessionKey:string|undefined,cursor=-1,connected=false,active:OcheCue|null=null;
  let pending:Omit<OcheCue,'startedAt'>[]=[];
  const seen=new Set<string>();
  function advance():OcheCue|null{
    const now=clock();
    if(active&&now-active.startedAt<OCHE_CUE_DURATION)return active;
    const next=pending.shift();active=next?{...next,startedAt:now}:null;return active;
  }
  function observe(snapshot:OcheCueSnapshot|null|undefined,online:boolean):OcheCue|null{
    if(!online||!snapshot?.sessionKey){connected=false;active=null;pending=[];return null;}
    const events=(snapshot.scoreEvents??[]).filter(event=>Boolean(event&&typeof event.id==='string'&&event.id&&Number.isSafeInteger(event.revision)&&event.revision>=0)).sort((a,b)=>a.revision-b.revision);
    const revision=Math.max(snapshot.match?.revision??-1,...events.map(event=>event.revision));
    if(!connected||sessionKey===snapshot.sessionKey&&revision<cursor){
      connected=true;sessionKey=snapshot.sessionKey;cursor=revision;active=null;pending=[];seen.clear();for(const event of events)seen.add(event.id);return null;
    }
    if(sessionKey!==snapshot.sessionKey){
      // A continuously watched free board may start and receive its first throw between polls.
      sessionKey=snapshot.sessionKey;cursor=-1;active=null;pending=[];seen.clear();
    }
    const fresh=events.filter(event=>event.revision>cursor&&!seen.has(event.id));
    cursor=Math.max(cursor,revision);
    for(const event of fresh){
      seen.add(event.id);
      if(event.kind==='undo'){active=null;pending=[];continue;}
      const moment=celebrationForEvent(event);
      if(moment)pending.push({...moment,id:event.id,player:event.playerName??snapshot.match?.players[event.playerIndex??-1]?.name??''});
    }
    // The revision cursor remains authoritative even after old event IDs leave this bounded set.
    if(seen.size>1024){seen.clear();for(const event of events)seen.add(event.id);}
    return advance();
  }
  return {observe,tick:advance};
}
