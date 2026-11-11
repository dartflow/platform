import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {MAIL_TEMPLATES,renderMail} from '../public/mail-engine.js';
const folder=resolve(process.argv[2]||'mail-examples');
mkdirSync(folder,{recursive:true});
const csv=value=>'"'+String(value??'').replaceAll('"','""')+'"';
const catalog=[];
for(const template of MAIL_TEMPLATES){
  const output=renderMail(template,template.example);
  if(output.missing.length)throw new Error(template.id+': '+output.missing.join(', '));
  writeFileSync(join(folder,template.id+'.html'),output.html);
  writeFileSync(join(folder,template.id+'.txt'),output.subject+'\n\n'+output.text+'\n');
  catalog.push({...template,example:{...template.example},html:template.id+'.html',text:template.id+'.txt'});
}
writeFileSync(join(folder,'catalog.json'),JSON.stringify(catalog,null,2)+'\n');
writeFileSync(join(folder,'triggers.csv'),[['id','Naam','Categorie','Trigger','Ontvanger','Timing','Bron','Prototype-status','Standaard actief'],...catalog.map(t=>[t.id,t.name,t.category,t.trigger,t.recipient,t.timing,t.source,t.status,t.enabled!==false])].map(row=>row.map(csv).join(',')).join('\n')+'\n');
const events=catalog.filter(t=>!t.locked).map(t=>({templateId:t.id,eventId:'fixture-'+t.id+'-001',scopeId:t.category==='Account'||t.category==='Sociaal'?null:701,recipient:{name:'Rick van Dijk',email:'rick@voorbeeld.test'},variables:t.example,kind:'example'}));
writeFileSync(join(folder,'voorbeeld-events.json'),JSON.stringify(events,null,2)+'\n');
const auth=MAIL_TEMPLATES.find(t=>t.id==='auth-otp');
const provider=renderMail(auth,{...auth.example,name:'darter',otp:'{{ .Token }}',actionUrl:'https://dartflow.example/'}).html.replaceAll('https://puinruimers-darts-demo.dgwebserv.chatgpt.site','{{ .SiteURL }}').replaceAll('https://dartflow.example/','{{ .SiteURL }}');
mkdirSync(join(folder,'auth'),{recursive:true});
writeFileSync(join(folder,'auth','supabase-otp.html'),provider);
writeFileSync(join(folder,'auth','LEES-MIJ.txt'),'Supabase Auth-template voor de OTP-stroom. Configureer dit in de juiste omgeving. {{ .Token }} blijft een echte providerplaceholder, {{ .SiteURL }} komt uit de omgeving. Bewaar codes nooit in de applicatie-outbox. Controleer huidige providerdocumentatie, OTP-lengte, geldigheid en SMTP-configuratie. Deze export verzendt niets.\n');
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
writeFileSync(join(folder,'index.html'),'<!doctype html><html lang="nl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DartFlow mailvoorbeelden</title><style>body{background:#edf1ec;color:#181d1a;font:16px Arial;margin:0;padding:clamp(16px,4vw,50px)}h1{color:#365710}p{line-height:1.6;color:#414944}.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:24px}article{background:#fff;min-width:0;border:1px solid #dbe5d7;padding:16px;border-radius:16px}h2{font-size:20px}iframe{width:100%;height:760px;border:0;background:#eee}a{color:#365710}small{color:#535e54;line-height:1.6}header{max-width:850px;margin-bottom:32px}</style><header><h1>DartFlow · Mailvoorbeelden</h1><p>'+catalog.length+' Nederlandse servicemails in de DartFlow-stijl. Dit zijn fictieve voorbeelden. De triggerstatus en echte stagingaansluitingen staan in het overdrachtspakket.</p></header><main class="gallery">'+catalog.map(t=>'<article><h2>'+escape(t.name)+'</h2><p><small>'+escape(t.category+' · '+t.timing)+'</small></p><iframe sandbox="" loading="lazy" title="'+escape(t.name)+'" src="'+t.id+'.html"></iframe><p><a href="'+t.id+'.html">Open HTML</a> · <a href="'+t.id+'.txt">Tekstversie</a></p></article>').join('')+'</main></html>');
console.log(JSON.stringify({folder,templates:catalog.length,events:events.length,authTemplate:true}));
