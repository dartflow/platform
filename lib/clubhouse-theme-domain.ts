import {DomainError} from './domain';
import type {BrandingDesign,ThemePreference,ThemeTokens,ThemeView} from './clubhouse-types';
export type ThemeCandidate = {clubId:string;name:string;brandingRevision:number;design:BrandingDesign;endsAt:string};
export const DEFAULT_THEME_PREFERENCE:ThemePreference={mode:'auto',clubId:null,colorMode:'system',revision:0};
export function safeThemeColor(value:unknown):string {
 if(typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value))throw new DomainError('invalid_color','Kies een kleur met zes hexadecimale cijfers.');
 return value.toUpperCase();
}
function rgb(color:string){return [1,3,5].map(index=>parseInt(color.slice(index,index+2),16));}
function luminance(color:string){const values=rgb(color).map(n=>{const x=n/255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;});return .2126*values[0]+.7152*values[1]+.0722*values[2];}
export function contrastRatio(a:string,b:string){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
function mix(a:string,b:string,amount:number){const x=rgb(a),y=rgb(b);return '#'+x.map((n,i)=>Math.round(n+(y[i]-n)*amount).toString(16).padStart(2,'0')).join('').toUpperCase();}
function readable(accent:string,background:string){let result=accent;for(let i=0;contrastRatio(result,background)<4.5&&i<20;i++)result=mix(result,luminance(background)<.5?'#FFFFFF':'#000000',.14);return result;}
export function deriveThemeTokens(design:Pick<BrandingDesign,'primary'|'secondary'>,dark:boolean):ThemeTokens {
 const background=dark?'#111615':'#F4F7F3',surface=dark?'#1A201E':'#FFFFFF',primary=readable(safeThemeColor(design.primary),surface);
 return {background,surface,surfaceRaised:dark?'#202724':'#E8EEE8',border:dark?'#65736B':'#6A786F',text:dark?'#F3F6F1':'#17231B',muted:dark?'#A6B3AA':'#526257',primary,onPrimary:contrastRatio(primary,'#111615')>=contrastRatio(primary,'#FFFFFF')?'#111615':'#FFFFFF',secondary:readable(safeThemeColor(design.secondary),surface),focus:primary,success:dark?'#8CE3A3':'#176635',warning:dark?'#FFD47A':'#775200',error:dark?'#FFADAD':'#A3192B'};
}
export function resolveClubhouseTheme(preference:ThemePreference,candidates:ThemeCandidate[],explicitClubId?:string,now=Date.now()):ThemeView {
 const eligible=candidates.filter(c=>Date.parse(c.endsAt)>now),stored=eligible.find(c=>c.clubId===preference.clubId);
 let selected:ThemeCandidate|undefined,needsChoice=false;
 if(explicitClubId)selected=eligible.find(c=>c.clubId===explicitClubId);
 else if(preference.mode!=='dartflow'){
  if(preference.clubId){selected=stored;needsChoice=!stored;}
  else if(preference.mode==='club')needsChoice=true;
  else if(eligible.length===1)selected=eligible[0];
  else needsChoice=eligible.length>1;
 }
 const design=selected?.design??{primary:'#C7F36A',secondary:'#8EA7EC',logoData:null,name:'DartFlow'};
 return {preference,effective:{clubId:selected?.clubId??null,name:selected?.name??'DartFlow',brandingRevision:selected?.brandingRevision??0,validUntil:new Date(Math.min(now+5*60*1000,selected?Date.parse(selected.endsAt):Infinity)).toISOString(),logoData:selected?.design.logoData??null,tokens:{light:deriveThemeTokens(design,false),dark:deriveThemeTokens(design,true)}},options:eligible.map(c=>({clubId:c.clubId,name:c.name,brandingRevision:c.brandingRevision,logoData:null})),needsChoice};
}
