import content from './content/manual.nl.json';
export type ManualArticle={id:string;title:string;category:string;href:string;intro:string;steps:string[];examples:string[];notes:string[];keywords:string[]};
export const MANUAL_VERSION='2026.11.19-play.1';
export const manualArticles:readonly ManualArticle[]=content;
const normalize=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('nl-NL');
export function getManual(input:{q?:string|null;id?:string|null;category?:string|null}={}){
 const terms=normalize((input.q??'').trim().slice(0,200)).split(/\s+/).filter(Boolean);
 return {version:MANUAL_VERSION,categories:[...new Set(manualArticles.map(a=>a.category))],articles:manualArticles.filter(a=>(!input.id||a.id===input.id)&&(!input.category||a.category===input.category)&&terms.every(t=>normalize([a.title,a.intro,...a.steps,...a.examples,...a.notes,...a.keywords].join(' ')).includes(t)))};
}
