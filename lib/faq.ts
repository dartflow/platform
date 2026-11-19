import content from './content/faq.nl.json';

export type FaqItem={id:string;category:string;question:string;answer:string;keywords:string[];audience?:'all'|'player'|'captain'|'organizer'|'club'|'platform'};
export type FaqSnapshot={version:string;publishedAt:string;categories:string[];items:FaqItem[]};
export const FAQ_VERSION='2026.11.19';
export const FAQ_PUBLISHED_AT='2026-11-19';
const items:readonly FaqItem[]=content;
const normalized=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('nl-NL');

/** The same versioned source serves the public help, contextual links and native app. */
export function filterFaq(snapshot:FaqSnapshot,input:{q?:string|null;category?:string|null;id?:string|null}={}):FaqSnapshot{
 const terms=normalized((input.q??'').trim().slice(0,200)).split(/\s+/).filter(Boolean);
 return {...snapshot,items:snapshot.items.filter(item=>(!input.id||item.id===input.id)&&(!input.category||item.category===input.category)&&terms.every(term=>normalized([item.question,item.answer,...item.keywords].join(' ')).includes(term)))};
}
export function getFaq(input:{q?:string|null;category?:string|null;id?:string|null}={}):FaqSnapshot{return filterFaq({version:FAQ_VERSION,publishedAt:FAQ_PUBLISHED_AT,categories:[...new Set(items.map(item=>item.category))],items:[...items]},input);}
