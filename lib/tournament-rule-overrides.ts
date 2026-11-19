import{DomainError,validateSettings}from'./domain';
import type{Fixture}from'./platform-types';
import type{Settings}from'./types';
export type TournamentRuleOverride={phase:Fixture['phase'];round?:number;settings:Partial<Settings>};
export const tournamentPhases=['pool','knockout','league','winners','losers','final','reset','swiss']as const;
const keys=new Set(['startScore','bestOfLegs','bestOfSets','legLimit','discipline','cricketMode','inRule','outRule','sideStartScores','startProcedure','setOpener','decidingLeg','legWinByTwo','setWinByTwo']);
export function parseTournamentRuleOverrides(input:unknown,base:Settings):TournamentRuleOverride[]{
 if(!Array.isArray(input)||input.length>64)throw new DomainError('invalid_phase_rules','Kies maximaal 64 fase- of ronderegels.');const seen=new Set<string>();
 const rules=input.map(item=>{if(!item||typeof item!=='object'||!tournamentPhases.includes(item.phase)||item.round!==undefined&&(!Number.isSafeInteger(item.round)||item.round<1||item.round>256)||!item.settings||typeof item.settings!=='object'||Array.isArray(item.settings)||Object.keys(item.settings).some(key=>!keys.has(key)))throw new DomainError('invalid_phase_rules','Kies een herkenbare fase, ronde en geldige spelregels.');const id=`${item.phase}:${item.round??0}`;if(seen.has(id))throw new DomainError('phase_rule_conflict','Publiceer één regel per fase en ronde.');seen.add(id);const settings={...item.settings}as Partial<Settings>;return{phase:item.phase as Fixture['phase'],...(item.round===undefined?{}:{round:item.round as number}),settings};}).sort((a,b)=>a.phase.localeCompare(b.phase)||(a.round??0)-(b.round??0));
 for(const rule of rules){const inherited=rules.find(r=>r.phase===rule.phase&&r.round===undefined);validateSettings({...base,...inherited?.settings,...rule.settings});}
 return rules.map(rule=>{const validated=validateSettings({...base,...rules.find(r=>r.phase===rule.phase&&r.round===undefined)?.settings,...rule.settings});return{...rule,settings:Object.fromEntries(Object.keys(rule.settings).map(key=>[key,validated[key as keyof Settings]]))as Partial<Settings>};});
}
export function tournamentFixtureSettings(base:Settings,rules:TournamentRuleOverride[]|undefined,fixture:Pick<Fixture,'phase'|'round'|'purpose'>):Settings{
 if(fixture.purpose==='pool-decider')return{startScore:501,bestOfLegs:5,bestOfSets:1};
 return validateSettings({...base,...rules?.find(r=>r.phase===fixture.phase&&r.round===undefined)?.settings,...rules?.find(r=>r.phase===fixture.phase&&r.round===fixture.round)?.settings});
}
export function snapshotTournamentRules(state:{settings?:Settings;tournamentRuleOverrides?:TournamentRuleOverride[];fixtures?:Fixture[]}):void{if(!state.settings||!state.tournamentRuleOverrides?.length)return;for(const fixture of state.fixtures??[])if(!fixture.matchId&&fixture.purpose!=='pool-decider')fixture.settings=tournamentFixtureSettings(state.settings,state.tournamentRuleOverrides,fixture);}
