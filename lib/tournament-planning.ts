export type TournamentPlanningInput={players:number;pools:number;qualifyPerPool:number;boards:number;matchMinutes:number;finalMinutes:number;restMinutes:number;changeMinutes:number;format:'pools-ko'|'knockout'|'round-robin'|'double-elimination'|'swiss';rounds?:number;thirdPlace?:boolean;consolation?:boolean;startAt?:string;deadline?:string};
export type PlanningFixture={id:string;phase:string;round:number;players:string[];dependsOn:string[];durationMinutes:number;writerId?:string};
export type PlannedFixture=PlanningFixture&{board:number;startMinute:number;endMinute:number};
export type TournamentPlan={input:TournamentPlanningInput;matchCount:number;totalMatchMinutes:number;lowerBoundMinutes:number;plannedMinutes:number;endAt:string|null;warnings:string[];fixtures:PlannedFixture[];model:'dag-list-v1'};
const integer=(value:unknown,fallback:number,min:number,max:number)=>{const parsed=Number(value??fallback);if(!Number.isSafeInteger(parsed)||parsed<min||parsed>max)throw new Error('Gebruik geldige aantallen en tijden voor de planning.');return parsed;};
export function parseTournamentPlanning(value:unknown,defaults:Partial<TournamentPlanningInput>={}):TournamentPlanningInput{
 const v=value&&typeof value==='object'?value as Record<string,unknown>:{};
 const format=String(v.format??defaults.format??'pools-ko');if(!['pools-ko','knockout','round-robin','double-elimination','swiss'].includes(format))throw new Error('Kies een ondersteund planningsformat.');
 const input:TournamentPlanningInput={players:integer(v.players,defaults.players??16,2,256),pools:integer(v.pools,defaults.pools??4,1,64),qualifyPerPool:integer(v.qualifyPerPool,defaults.qualifyPerPool??2,1,16),boards:integer(v.boards,defaults.boards??4,1,64),matchMinutes:integer(v.matchMinutes,defaults.matchMinutes??20,1,240),finalMinutes:integer(v.finalMinutes,defaults.finalMinutes??20,1,480),restMinutes:integer(v.restMinutes,defaults.restMinutes??5,0,120),changeMinutes:integer(v.changeMinutes,defaults.changeMinutes??0,0,60),format:format as TournamentPlanningInput['format'],rounds:integer(v.rounds,defaults.rounds??5,1,32),thirdPlace:v.thirdPlace===true||v.thirdPlace==='true'||defaults.thirdPlace===true,consolation:v.consolation===true||v.consolation==='true'||defaults.consolation===true};
 if(input.consolation&&input.format!=='knockout')throw new Error('Een afzonderlijke troostbeker hoort bij enkele eliminatie.');
 if(input.format==='pools-ko'&&(input.pools>input.players||Math.floor(input.players/input.pools)<input.qualifyPerPool||input.pools*input.qualifyPerPool<2))throw new Error('Iedere poule moet voldoende deelnemers voor het aantal kwalificanten bevatten.');
 for(const key of ['startAt','deadline'] as const){const raw=v[key]??defaults[key];if(raw){const date=new Date(String(raw));if(!Number.isFinite(date.getTime()))throw new Error('Geef een geldige begin- en eindtijd.');input[key]=date.toISOString();}}
 if(input.startAt&&input.deadline&&Date.parse(input.deadline)<=Date.parse(input.startAt))throw new Error('De eindtijd moet na de begintijd liggen.');
 return input;
}
function roundRobin(players:string[],prefix:string,duration:number):PlanningFixture[]{
 const ring=[...players];if(ring.length%2)ring.push('bye');const result:PlanningFixture[]=[];
 for(let round=1;round<ring.length;round++){for(let i=0;i<ring.length/2;i++){const pair=[ring[i],ring[ring.length-1-i]];if(!pair.includes('bye'))result.push({id:`${prefix}-${round}-${i+1}`,phase:'pool',round,players:pair,dependsOn:[],durationMinutes:duration});}ring.splice(1,0,ring.pop()!);}
 return result;
}
/** A deterministic dependency schedule. It never assigns a live board lease. */
export function schedulePlanningFixtures(fixtures:PlanningFixture[],input:TournamentPlanningInput):TournamentPlan{
 const ids=new Set(fixtures.map(f=>f.id));if(ids.size!==fixtures.length||fixtures.some(f=>f.dependsOn.some(id=>!ids.has(id))))throw new Error('De planning bevat een ongeldige wedstrijdafhankelijkheid.');
 if(fixtures.length>32640||fixtures.reduce((n,f)=>n+f.dependsOn.length,0)>262144)throw new Error('De planning bevat te veel wedstrijdafhankelijkheden. Verdeel dit programma in afzonderlijke fasen.');
 const done=new Map<string,PlannedFixture>(),boardReady=Array(input.boards).fill(0)as number[],actorReady=new Map<string,number>(),remaining=new Map<string,number>(),dependents=new Map<string,string[]>(),byId=new Map(fixtures.map(f=>[f.id,f]));
 const ready:PlanningFixture[]=[],compare=(a:PlanningFixture,b:PlanningFixture)=>a.round-b.round||a.id.localeCompare(b.id);
 const push=(fixture:PlanningFixture)=>{ready.push(fixture);let i=ready.length-1;while(i>0){const parent=Math.floor((i-1)/2);if(compare(ready[parent],ready[i])<=0)break;[ready[parent],ready[i]]=[ready[i],ready[parent]];i=parent;}};
 const pop=()=>{const first=ready[0],last=ready.pop()!;if(ready.length){ready[0]=last;let i=0;for(;;){let next=i;for(const child of[i*2+1,i*2+2])if(child<ready.length&&compare(ready[child],ready[next])<0)next=child;if(next===i)break;[ready[i],ready[next]]=[ready[next],ready[i]];i=next;}}return first;};
 for(const f of fixtures){const deps=[...new Set(f.dependsOn)];remaining.set(f.id,deps.length);if(!deps.length)push(f);for(const id of deps){const rows=dependents.get(id)??[];rows.push(f.id);dependents.set(id,rows);}}
 // Stable round/slot priority and a topological ready heap bound the work to
 // O(F log F + edges + F*boards). This is a feasible estimate, not an optimum.
 while(ready.length){
  const f=pop(),dependency=f.dependsOn.reduce((n,id)=>Math.max(n,done.get(id)!.endMinute+input.restMinutes),0),actors=[...f.players,...(f.writerId?[f.writerId]:[])],available=actors.reduce((n,id)=>Math.max(n,actorReady.get(id)??0),dependency);
  const board=boardReady.reduce((best,time,index)=>Math.max(time,available)<Math.max(boardReady[best],available)?index:best,0),start=Math.max(boardReady[board],available),slot:PlannedFixture={...f,board:board+1,startMinute:start,endMinute:start+f.durationMinutes};done.set(f.id,slot);boardReady[board]=slot.endMinute+input.changeMinutes;
  for(const actor of actors)actorReady.set(actor,slot.endMinute+input.restMinutes);
  for(const id of dependents.get(f.id)??[]){const count=remaining.get(id)!-1;remaining.set(id,count);if(!count)push(byId.get(id)!);}
 }
 if(done.size!==fixtures.length)throw new Error('De planning bevat een kring van afhankelijke wedstrijden.');
 const planned=[...done.values()].sort((a,b)=>a.startMinute-b.startMinute||a.board-b.board||a.id.localeCompare(b.id)),total=fixtures.reduce((sum,f)=>sum+f.durationMinutes,0),minutes=Math.max(0,...planned.map(f=>f.endMinute)),endAt=input.startAt?new Date(Date.parse(input.startAt)+minutes*60_000).toISOString():null,warnings:string[]=[];
 if(input.format==='pools-ko'&&input.players%input.pools)warnings.push('De poules zijn ongelijk van grootte. Controleer vóór vrijgave de gepubliceerde vergelijking van kwalificanten.');
 if(input.format==='double-elimination')warnings.push('De extra resetfinale is meegerekend; bij winst vanuit de winnaarskant vervalt die partij.');
 if(endAt&&input.deadline&&Date.parse(endAt)>Date.parse(input.deadline))warnings.push('Het programma eindigt na de opgegeven eindtijd. Voeg banen toe, begin eerder of wijzig de vooraf gepubliceerde speelduur.');
 if(minutes>Math.ceil(total/input.boards))warnings.push('De geplande duur bevat afhankelijkheden, spelersrust en baanwissels boven de mechanische ondergrens.');
 return{input,matchCount:fixtures.length,totalMatchMinutes:total,lowerBoundMinutes:Math.ceil(total/input.boards),plannedMinutes:minutes,endAt,warnings,fixtures:planned,model:'dag-list-v1'};
}
export function buildTournamentPlan(raw:TournamentPlanningInput):TournamentPlan{
 const input=parseTournamentPlanning(raw),fixtures:PlanningFixture[]=[],players=Array.from({length:input.players},(_,i)=>`speler-${i+1}`);
 if(input.format==='round-robin')fixtures.push(...roundRobin(players,'rr',input.matchMinutes));
 else if(input.format==='swiss'){
  let prior:string[]=[];for(let round=1;round<=(input.rounds??5);round++){const current:string[]=[];for(let i=0;i<Math.floor(input.players/2);i++){const id=`swiss-${round}-${i+1}`;fixtures.push({id,phase:'swiss',round,players:[`swiss-slot-${i*2}`,`swiss-slot-${i*2+1}`],dependsOn:prior,durationMinutes:input.matchMinutes});current.push(id);}prior=current;}
 }else if(input.format==='double-elimination'){
  // The exact bracket can be supplied to schedulePlanningFixtures. This safe
  // preview includes every possible real match, including the reset, and waits
  // for each prior match rather than claiming unproven parallel availability.
  for(let i=0;i<2*input.players-1;i++)fixtures.push({id:`de-${i+1}`,phase:i>=2*input.players-3?'final':'double-elimination',round:i+1,players:[],dependsOn:i?[`de-${i}`]:[],durationMinutes:i>=2*input.players-3?input.finalMinutes:input.matchMinutes});
 }else{
  let slots:string[],poolDependencies:string[]=[];
  if(input.format==='pools-ko'){
   const groups=Array.from({length:input.pools},()=>[] as string[]);players.forEach((p,i)=>groups[i%input.pools].push(p));
   groups.forEach((group,i)=>fixtures.push(...roundRobin(group,`pool-${i+1}`,input.matchMinutes)));poolDependencies=fixtures.map(f=>f.id);
   slots=Array.from({length:input.qualifyPerPool},(_,place)=>Array.from({length:input.pools},(_,pool)=>`poule-${pool+1}-plaats-${place+1}`)).flat();
  }else slots=players;
  const capacity=2**Math.ceil(Math.log2(slots.length));let prior:(string|null)[]=spreadByeSlots(slots,capacity),round=1;const semis:string[]=[];
  while(prior.length>1){const next:(string|null)[]=[];for(let i=0;i<prior.length;i+=2){const a=prior[i],b=prior[i+1];if(!a||!b){next.push(a??b);continue;}const id=`ko-${round}-${i/2+1}`,dependencies=[a,b].filter(value=>idsOf(fixtures).has(value));fixtures.push({id,phase:prior.length===2?'final':'knockout',round:100+round,players:round===1?[a,b]:[],dependsOn:[...dependencies,...(round===1?poolDependencies:[])],durationMinutes:prior.length===2?input.finalMinutes:input.matchMinutes});next.push(id);if(prior.length===4)semis.push(id);}prior=next;round++;}
  if(input.consolation){const entrants=fixtures.filter(f=>f.round===101&&['knockout','final'].includes(f.phase));if(entrants.length>=2){const size=2**Math.ceil(Math.log2(entrants.length)),sources=new Map(entrants.map(f=>[`loser-${f.id}`,f.id]));let previous=spreadByeSlots(entrants.map(f=>`loser-${f.id}`),size),troostRound=1;while(previous.length>1){const next:(string|null)[]=[];for(let i=0;i<previous.length;i+=2){const a=previous[i],b=previous[i+1];if(!a||!b){next.push(a??b);continue;}const id=`consolation-${troostRound}-${i/2+1}`;fixtures.push({id,phase:'consolation',round:200+troostRound,players:troostRound===1?[a,b]:[],dependsOn:[sources.get(a)??a,sources.get(b)??b],durationMinutes:input.matchMinutes});next.push(id);}previous=next;troostRound++;}}}
  if(input.thirdPlace&&semis.length===2)fixtures.push({id:'bronze',phase:'bronze',round:100+round,players:[],dependsOn:semis,durationMinutes:input.matchMinutes});
 }
 return schedulePlanningFixtures(fixtures,input);
}
const idsOf=(fixtures:PlanningFixture[])=>new Set(fixtures.map(f=>f.id));

function spreadByeSlots(values:string[],capacity:number):(string|null)[]{const slots:(string|null)[]=[],byes=capacity-values.length;let i=0;for(let pair=0;pair<capacity/2;pair++)slots.push(values[i++],pair<byes?null:values[i++]);return slots;}
