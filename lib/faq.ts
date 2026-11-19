import content from './content/faq.nl.json';

export type FaqItem={id:string;category:string;question:string;answer:string;keywords:string[];manualId?:string;audience?:'all'|'player'|'captain'|'organizer'|'club'|'platform'};
export type FaqSnapshot={version:string;publishedAt:string;categories:string[];items:FaqItem[]};
export const FAQ_VERSION='2026.11.19-play.1';
export const FAQ_PUBLISHED_AT='2026-11-19T22:10:00.000Z';
const items:readonly FaqItem[]=content;
const normalized=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('nl-NL');

/** The same versioned source serves the public help, contextual links and native app. */
export function filterFaq(snapshot:FaqSnapshot,input:{q?:string|null;category?:string|null;id?:string|null}={}):FaqSnapshot{
 const terms=normalized((input.q??'').trim().slice(0,200)).split(/\s+/).filter(Boolean);
 return {...snapshot,items:snapshot.items.filter(item=>(!input.id||item.id===input.id)&&(!input.category||item.category===input.category)&&terms.every(term=>normalized([item.question,item.answer,...item.keywords].join(' ')).includes(term)))};
}
export function getFaq(input:{q?:string|null;category?:string|null;id?:string|null}={}):FaqSnapshot{return filterFaq({version:FAQ_VERSION,publishedAt:FAQ_PUBLISHED_AT,categories:[...new Set(items.map(item=>item.category))],items:[...items]},input);}

/** Upgrade earlier publications while preserving later editorial changes and custom questions. */
export function mergePublishedFaq(row:{version:string;items:FaqItem[];createdAt:Date|string}):FaqSnapshot{
 const base=getFaq(),changed=new Set(['baan-tablet','hulp-gastprofiel','sport-bust','hulp-correctie','baan-offline','oche-inactiviteit']);
 const older=new Date(row.createdAt).getTime()<Date.parse(base.publishedAt),ids=new Set(row.items.map(item=>item.id));
 const merged=row.items.map(item=>older&&changed.has(item.id)?base.items.find(value=>value.id===item.id)??item:item);
 merged.push(...base.items.filter(item=>!ids.has(item.id)));
 const augmented=merged.length!==row.items.length||older&&row.items.some(item=>changed.has(item.id));
 return {version:augmented?`${row.version}+${base.version}`:row.version,publishedAt:augmented&&older?base.publishedAt:new Date(row.createdAt).toISOString(),categories:[...new Set(merged.map(item=>item.category))],items:merged};
}
