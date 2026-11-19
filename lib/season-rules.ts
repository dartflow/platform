import {DomainError,validateSettings} from './domain';
import {coreSeasonSettings,type SeasonSettings,type SeasonFixture,type SeasonSlot} from './seasons-types';
import type {Settings} from './types';
const fields=new Set(['startScore','bestOfLegs','bestOfSets','legLimit','inRule','outRule','sideStartScores','discipline','cricketMode','startProcedure','setOpener','decidingLeg','legWinByTwo','setWinByTwo']);
export function validateSeasonSlotRules(value:unknown,base:Settings):SeasonSettings['slotRules']{
 if(value===undefined)return undefined;if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>7)throw new DomainError('invalid_slot_rules','Kies maximaal zeven genummerde onderdeelregels.');
 const result:NonNullable<SeasonSettings['slotRules']>={};for(const [index,raw]of Object.entries(value)){if(!/^[0-6]$/.test(index)||!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(key=>!fields.has(key)))throw new DomainError('invalid_slot_rules','Onderdeelregels gebruiken index 0 tot en met 6 en alleen bekende spelregels.');validateSettings({...base,...raw});result[index]=structuredClone(raw as Partial<Settings>);}return result;
}
/** Published per-component rules are the shared source for scoring and ranking manifests. */
export function seasonSlotSettings(settings:SeasonSettings,fixture:Pick<SeasonFixture,'settings'|'classification'>,slot:Pick<SeasonSlot,'index'>):Settings{return fixture.classification?validateSettings({...fixture.settings,...(settings.startProcedure?{startProcedure:settings.startProcedure}:{}),...(settings.setOpener?{setOpener:settings.setOpener}:{}),...(settings.decidingLeg?{decidingLeg:settings.decidingLeg}:{})}):validateSettings({...coreSeasonSettings(settings),...settings.slotRules?.[String(slot.index)],...fixture.settings});}
export function hasCustomSeasonRules(settings:SeasonSettings):boolean{return !!settings.legWinByTwo||!!settings.setWinByTwo||settings.inRule==='double'||!!settings.outRule&&settings.outRule!=='double'||!!settings.sideStartScores||Object.keys(settings.slotRules??{}).length>0;}
