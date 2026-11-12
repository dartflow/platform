import {DomainError} from './domain';
import {CLUB_PERMISSIONS,type IntakeQuestion,type IntakeAnswer,type ClubPermission} from './club-types';
export function clubText(value:unknown,max:number,required=false):string{
 if(typeof value!=='string'||value.trim().length>max||(required&&!value.trim())||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))throw new DomainError('club_text',`Vul geldige tekst in van maximaal ${max} tekens.`);return value.trim();
}
export function intakeQuestions(value:unknown):IntakeQuestion[]{
 if(!Array.isArray(value)||value.length>12)throw new DomainError('intake_questions','Gebruik maximaal twaalf intakevragen.');
 const seen=new Set<string>();return value.map(item=>{if(!item||typeof item!=='object'||Array.isArray(item))throw new DomainError('intake_question','Controleer de intakevraag.');const q=item as Record<string,unknown>;
 if(typeof q.id!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(q.id)||seen.has(q.id)||!['text','textarea','select'].includes(String(q.type))||typeof q.required!=='boolean')throw new DomainError('intake_question','Controleer vraag-ID, type en verplicht veld.');seen.add(q.id);
 const type=q.type as IntakeQuestion['type'],options=type==='select'&&Array.isArray(q.options)?q.options.map(v=>clubText(v,100,true)):[];
 if(type==='select'&&(options.length<2||options.length>12||new Set(options).size!==options.length))throw new DomainError('intake_options','Geef twee tot twaalf verschillende keuzes op.');
 return {id:q.id,label:clubText(q.label,120,true),type,required:q.required,options};});
}
export function intakeAnswers(questions:IntakeQuestion[],input:unknown):IntakeAnswer[]{
 if(!input||typeof input!=='object'||Array.isArray(input))throw new DomainError('intake_answers','Controleer de intakeantwoorden.');
 const values=input as Record<string,unknown>;if(Object.keys(values).some(key=>!questions.some(q=>q.id===key)))throw new DomainError('intake_answers','Het formulier bevat een onbekend antwoord.');
 return questions.map(({id,label,type,required,options})=>{const value=clubText(values[id]??'',type==='textarea'?800:type==='text'?160:100,required);if(type==='select'&&value&&!options.includes(value))throw new DomainError('intake_answer','Kies een aangeboden antwoord.');return {id,label,type,required,value};});
}
export function clubGrants(value:unknown):ClubPermission[]{if(!Array.isArray(value)||value.length>CLUB_PERMISSIONS.length||value.some(p=>!CLUB_PERMISSIONS.includes(p))||new Set(value).size!==value.length)throw new DomainError('club_permissions','Kies geldige verenigingsrechten.');return [...value].sort();}
export function clubColor(value:unknown):string{if(typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value))throw new DomainError('club_color','Kies een kleur met zes hextekens.');return value.toLowerCase();}
export function clubInk(value:string):'#000000'|'#ffffff'{const rgb=[1,3,5].map(i=>parseInt(value.slice(i,i+2),16)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);const light=rgb.reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);return (light+.05)/.05>=1.05/(light+.05)?'#000000':'#ffffff';}
