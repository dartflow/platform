// Transactional mail design and browser-only outbox. No provider or send operation.
const APP='https://puinruimers-darts-demo.dgwebserv.chatgpt.site';
const logoAsset = new URL('./assets/dartflow-logo.png', import.meta.url);
const MAIL_LOGO_URL = ['http:', 'https:'].includes(logoAsset.protocol)
  ? logoAsset.href
  : new URL('/assets/dartflow-logo.png', APP).href;
const EXAMPLE={name:'Rick van Dijk',actorName:'Mike de Bruin',clubName:'De Puinruimers',eventName:'Puinruimers Open',opponentName:'Mike de Bruin',date:'Vrijdag 13 november',time:'20:00',location:'Clubhuis De Puinruimers · Den Haag',boardName:'Baan 2',score:'3 – 2',reason:'De wedstrijdleiding heeft de uitslag beoordeeld.',role:'Aanvoerder',actionUrl:APP+'/#mymatches',roomName:'Het clubhuis',startScore:'501',bestOf:'5 legs',status:'Goedgekeurd',otp:'482196'};
const spec=(id,name,category,subject,preheader,title,body,cta,trigger,recipient,timing,source,status,details=[],extra={})=>({id,name,category,subject,preheader,title,body,cta,trigger,recipient,timing,source,status,details,...extra});
const definitions=[
  spec('auth-otp','Inlogcode','Account','{{otp}} is je DartFlow-inlogcode','Jouw persoonlijke toegang tot de oche.','Terug aan de oche.','Hoi {{name}},\nGebruik deze eenmalige code om veilig in te loggen bij DartFlow. Heb je deze code niet aangevraagd? Dan kun je deze mail negeren.','Open DartFlow','Een speler vraagt een e-mailcode aan.','De speler die wil inloggen','Op aanvraag','Supabase Auth · signInWithOtp','provider',[],{locked:true,code:true}),
  spec('welcome','Welkom bij DartFlow','Account','Welkom bij DartFlow, {{name}}','Jouw club, jouw tegenstanders, jouw volgende partij.','Jouw volgende partij begint hier.','Hoi {{name}},\nMooi dat je erbij bent. Sluit je aan bij een vereniging, daag een dartmaatje uit of scan de QR-code op een baan. Je wedstrijden en statistieken komen samen op één plek.','Ontdek DartFlow','Een nieuw account is succesvol aangemaakt.','De nieuwe speler','Na accountregistratie','Auth account-created · staging','planned',[['Speler','{{name}}'],['Start','Club zoeken · oefenen · uitdagen']]),
  spec('club-request','Nieuwe clublid-aanvraag','Vereniging','{{actorName}} wil lid worden van {{clubName}}','Er staat een nieuwe aanvraag klaar voor je club.','Een nieuwe speler voor je club.','Hoi {{name}},\n{{actorName}} heeft gevraagd om lid te worden van {{clubName}}. Bekijk het profiel en beoordeel de aanvraag in de clubomgeving.','Bekijk aanvraag','Een speler vraagt lidmaatschap aan.','Clubbeheerder of eigenaar','Direct','clubs-join · aanvraag','wired',[['Aanvrager','{{actorName}}'],['Vereniging','{{clubName}}']]),
  spec('club-decision','Besluit clublidmaatschap','Vereniging','Je aanvraag bij {{clubName}}: {{status}}','Er is nieuws over je lidmaatschap.','Nieuws van je vereniging.','Hoi {{name}},\nJe aanvraag om lid te worden van {{clubName}} is beoordeeld. Hieronder vind je het besluit. Bekijk je clubomgeving voor de mogelijkheden.','Bekijk je vereniging','Een beheerder beoordeelt een aanvraag of de speler treedt direct toe.','De aanvragende speler','Direct','clubs-approve / clubs-reject / clubs-join open','wired',[['Vereniging','{{clubName}}'],['Besluit','{{status}}']]),
  spec('club-role','Clubrol gewijzigd','Vereniging','Je rol bij {{clubName}} is gewijzigd','Je nieuwe rol staat klaar in de clubomgeving.','Samen dragen we de club.','Hoi {{name}},\nJe rol binnen {{clubName}} is aangepast. In de clubomgeving zie je welke mogelijkheden bij je nieuwe rol horen.','Open clubomgeving','Een beheerder wijzigt daadwerkelijk een clubrol.','De betrokken speler','Direct','clubs-role','wired',[['Vereniging','{{clubName}}'],['Nieuwe rol','{{role}}']]),
  spec('friend-request','Vriendschapsverzoek','Sociaal','{{actorName}} wil je toevoegen als dartmaatje','Een nieuwe verbinding, een volgende partij.','Een dartmaatje erbij?','Hoi {{name}},\n{{actorName}} wil je toevoegen als vriend op DartFlow. Bekijk het verzoek en spreek samen jullie volgende partij af.','Bekijk vriendschapsverzoek','Een speler verstuurt een vriendschapsverzoek.','De uitgenodigde speler','Direct','portal-friend','wired',[['Van','{{actorName}}'],['Voor','{{name}}']]),
  spec('friend-accepted','Dartmaatje toegevoegd','Sociaal','Je bent nu bevriend met {{actorName}}','Daag elkaar uit of ontmoet elkaar in de chat.','Jullie volgende partij wacht.','Hoi {{name}},\n{{actorName}} heeft je vriendschapsverzoek geaccepteerd. Jullie kunnen elkaar nu eenvoudig terugvinden en uitdagen.','Naar je dartmaatjes','Een vriendschapsverzoek is geaccepteerd.','De oorspronkelijke aanvrager','Direct','portal-accept-friend / portal-simulate-friend','wired',[['Dartmaatje','{{actorName}}']]),
  spec('challenge-invite','Uitdaging ontvangen','Wedstrijden','{{actorName}} daagt je uit voor een partij','De oche is vrij. Accepteer jij de uitdaging?','Laat je pijlen spreken.','Hoi {{name}},\n{{actorName}} daagt je uit voor een wedstrijd op DartFlow. Bekijk de spelinstellingen en accepteer als je klaar bent voor de eerste leg.','Bekijk uitdaging','Een gerichte uitdaging wordt verstuurd.','De uitgedaagde speler','Direct','rooms createGame / community-challenge','wired',[['Tegenstander','{{actorName}}'],['Spel','{{startScore}} · best of {{bestOf}}']]),
  spec('challenge-accepted','Uitdaging geaccepteerd','Wedstrijden','{{actorName}} heeft je uitdaging geaccepteerd','Jullie partij staat klaar.','Het is tijd voor jullie partij.','Hoi {{name}},\n{{actorName}} heeft je uitdaging geaccepteerd. Open de wedstrijd om samen te starten en controleer de afgesproken spelinstellingen.','Open wedstrijd','De tegenstander accepteert de uitdaging.','De uitdager','Direct','room-opponent-ready / community-accept','wired',[['Tegenstander','{{actorName}}'],['Spel','{{startScore}} · best of {{bestOf}}']]),
  spec('challenge-cancelled','Uitdaging ingetrokken','Wedstrijden','De uitdaging met {{opponentName}} is vervallen','Deze partij gaat niet door. Plan gerust een nieuwe.','Een andere keer aan de oche.','Hoi {{name}},\nDe openstaande uitdaging met {{opponentName}} is ingetrokken of afgewezen. Je vindt de actuele status in je wedstrijdoverzicht.','Naar je wedstrijden','Een openstaande gerichte uitdaging wordt ingetrokken of afgewezen.','De andere speler','Direct','community-cancel / community-decline','wired',[['Tegenstander','{{opponentName}}'],['Status','{{status}}']]),
  spec('fixture-scheduled','Speelmoment bevestigd','Competitie','Jullie wedstrijd op {{date}} is bevestigd','Het speelmoment staat vast in jullie programma.','Afgesproken. Tijd om te spelen.','Hoi {{name}},\nHet voorstel voor je wedstrijd tegen {{opponentName}} is geaccepteerd. Zet het speelmoment in je agenda en open de wedstrijd wanneer jullie klaar zijn.','Bekijk wedstrijd','Beide spelers hebben het voorgestelde moment bevestigd.','Beide wedstrijdspelers','Direct','comp-accept-time','wired',[['Competitie','{{eventName}}'],['Tegenstander','{{opponentName}}'],['Wanneer','{{date}} · {{time}}']]),
  spec('fixture-changed','Nieuw voorstel speelmoment','Competitie','Nieuw tijdvoorstel voor je partij met {{opponentName}}','Bekijk het voorstel en geef aan of je kunt spelen.','Past dit speelmoment?','Hoi {{name}},\n{{actorName}} heeft een nieuw speelmoment voorgesteld voor jullie wedstrijd. Het moment staat pas vast nadat het voorstel is geaccepteerd.','Beoordeel voorstel','Een speler stelt een nieuw wedstrijdmoment voor.','De andere wedstrijdspeler','Direct','comp-plan','wired',[['Competitie','{{eventName}}'],['Tegenstander','{{opponentName}}'],['Voorstel','{{date}} · {{time}}']]),
  spec('fixture-reminder','Wedstrijdherinnering','Competitie','Je speelt op {{date}} tegen {{opponentName}}','Je volgende competitiewedstrijd komt eraan.','Bijna tijd voor de eerste leg.','Hoi {{name}},\nJe wedstrijd tegen {{opponentName}} staat binnenkort op het programma. Controleer het afgesproken moment en zorg dat je klaar bent om te starten.','Open je programma','Een bevestigde wedstrijd bereikt het herinneringsmoment.','Beide wedstrijdspelers','Gepland · vóór de wedstrijd','Serverplanner · staging','planned',[['Competitie','{{eventName}}'],['Tegenstander','{{opponentName}}'],['Wanneer','{{date}} · {{time}}']]),
  spec('competition-entry','Competitiedeelname bevestigd','Competitie','Je doet mee aan {{eventName}}','Je competitieprogramma staat voor je klaar.','Een seizoen vol mooie partijen.','Hoi {{name}},\nJe deelname aan {{eventName}} is verwerkt. In je competitieprogramma vind je je tegenstanders en kun je samen speelmomenten afspreken.','Bekijk competitie','Een speler wordt succesvol aan de competitie toegevoegd.','De toegevoegde speler','Direct','comp-join','wired',[['Competitie','{{eventName}}'],['Vereniging','{{clubName}}'],['Startdatum','{{date}}']]),
  spec('tournament-entry','Toernooiaanmelding ontvangen','Toernooien','Je aanmelding voor {{eventName}} is ontvangen','Je vindt de status in je evenementenoverzicht.','Je staat op de lijst.','Hoi {{name}},\nWe hebben je aanmelding voor {{eventName}} ontvangen. De actuele inschrijfstatus staat hieronder. Je hoort het wanneer er iets verandert.','Bekijk inschrijving','Een speler schrijft zich succesvol in voor een toernooi.','De deelnemer','Direct','venue register / comp join tournament / join-tour','wired',[['Toernooi','{{eventName}}'],['Vereniging','{{clubName}}'],['Status','{{status}}']]),
  spec('tournament-approved','Toernooideelname bevestigd','Toernooien','Je doet mee aan {{eventName}}','Je plek is bevestigd. Bekijk de toernooi-informatie.','Jouw plek is binnen.','Hoi {{name}},\nJe deelname aan {{eventName}} is bevestigd. Bekijk de praktische informatie en de incheckmogelijkheden in de toernooikamer.','Open toernooi','De organisatie bevestigt een deelnemersplaats.','De bevestigde deelnemer','Direct','approve-request · entry / venue registration accepted','wired',[['Toernooi','{{eventName}}'],['Vereniging','{{clubName}}'],['Status','Bevestigd']]),
  spec('tournament-rejected','Toernooiaanmelding afgewezen','Toernooien','Je aanmelding voor {{eventName}} is beoordeeld','Er is een besluit genomen over je toernooiaanmelding.','Bericht van de organisatie.','Hoi {{name}},\nDe organisatie heeft je aanmelding voor {{eventName}} afgewezen. Je actuele inschrijfstatus staat bij het toernooi. Neem bij vragen contact op met de organisatie.','Bekijk aanmelding','De organisatie wijst een toernooiaanmelding af.','De betrokken aanvrager','Direct','reject-request · entry','wired',[['Toernooi','{{eventName}}'],['Vereniging','{{clubName}}'],['Besluit','Afgewezen']]),
  spec('tournament-changed','Toernooi-informatie gewijzigd','Toernooien','De gegevens van {{eventName}} zijn gewijzigd','Bekijk de bijgewerkte datum en locatie.','Nieuwe informatie voor je toernooi.','Hoi {{name}},\nDe organisatie heeft de datum of locatie van {{eventName}} aangepast. Hieronder vind je de bijgewerkte informatie. Controleer het toernooi voor de laatste details.','Bekijk wijzigingen','Een organisatie wijzigt de datum of locatie van een toernooi met inschrijvingen.','Ingeschreven deelnemers','Direct','tournament form · date / location wijziging','wired',[['Toernooi','{{eventName}}'],['Datum','{{date}}'],['Locatie','{{location}}']]),
  spec('tournament-waitlist','Plaats op de wachtlijst','Toernooien','Je staat op de wachtlijst voor {{eventName}}','Zodra er een plek vrijkomt, krijg je bericht.','Nog even in de wacht.','Hoi {{name}},\nHet deelnemersveld van {{eventName}} is op dit moment vol. Je aanmelding staat op de wachtlijst. Zodra je doorschuift, krijg je een nieuwe bevestiging.','Bekijk wachtlijst','Een inschrijving belandt op de wachtlijst.','De wachtende speler','Direct','venue register · waitlisted','wired',[['Toernooi','{{eventName}}'],['Vereniging','{{clubName}}'],['Status','Wachtlijst']]),
  spec('tournament-promoted','Doorgeschoven van wachtlijst','Toernooien','Er is een plek voor je bij {{eventName}}','Je bent doorgeschoven. Bekijk je deelname.','De oche is voor jou.','Hoi {{name}},\nGoed nieuws: er is een plaats vrijgekomen bij {{eventName}} en je bent doorgeschoven van de wachtlijst naar het deelnemersveld. Bekijk je inschrijving en de praktische informatie.','Bekijk je deelname','Een wachtende speler krijgt een vrije deelnemersplaats.','De doorgeschoven speler','Direct','venue withdraw / promote waitlist','wired',[['Toernooi','{{eventName}}'],['Vereniging','{{clubName}}'],['Status','Deelname bevestigd']]),
  spec('tournament-withdrawn','Afmelding bevestigd','Toernooien','Je bent afgemeld voor {{eventName}}','Je afmelding is verwerkt in het deelnemersoverzicht.','Je afmelding is verwerkt.','Hoi {{name}},\nJe deelname aan {{eventName}} is ingetrokken. De deelnemerslijst is bijgewerkt. Hopelijk zien we je bij een volgende editie weer aan de oche.','Bekijk evenementen','Een ingeschreven speler meldt zich af.','De afgemelde deelnemer','Direct','venue withdraw / comp leave tournament','wired',[['Toernooi','{{eventName}}'],['Status','Afgemeld']]),
  spec('tournament-reminder','Toernooi- en incheckherinnering','Toernooien','Ben je klaar voor {{eventName}}?','Bekijk het incheckmoment en de laatste toernooi-informatie.','Morgen gaat het los.','Hoi {{name}},\n{{eventName}} komt eraan. Bekijk de actuele tijden en check op tijd in, zodat de organisatie de borden direct kan vullen.','Bekijk incheckinformatie','Een toernooi bereikt het ingestelde herinneringsmoment.','Bevestigde deelnemers','Gepland · vóór de start','Serverplanner · staging','planned',[['Toernooi','{{eventName}}'],['Wanneer','{{date}} · {{time}}'],['Vereniging','{{clubName}}']]),
  spec('board-call','Oproep naar de baan','Toernooien','{{boardName}} wacht op jou, {{name}}','Je volgende toernooiwedstrijd kan beginnen.','Jouw baan staat klaar.','Hoi {{name}},\nJe bent ingedeeld voor de volgende partij. Meld je bij de aangegeven baan en controleer de wedstrijd op je telefoon. Het live baanscherm toont altijd de actuele stand.','Open je wedstrijd','Een partij krijgt een baan toegewezen.','Beide ingedeelde spelers','Optioneel · direct','venue board assign · optionele mail','wired',[['Toernooi','{{eventName}}'],['Baan','{{boardName}}'],['Tegenstander','{{opponentName}}']],{enabled:false}),
  spec('result-confirm','Uitslag ter bevestiging','Wedstrijden','Bevestig de uitslag tegen {{opponentName}}','Controleer de stand voordat deze definitief wordt.','Klopt de uitslag?','Hoi {{name}},\nEr is een uitslag ingevoerd voor je wedstrijd tegen {{opponentName}}. Controleer de stand en bevestig de uitslag, of geef aan wanneer er iets niet klopt.','Controleer uitslag','Een uitslag wacht op bevestiging door de andere speler.','De andere wedstrijdspeler','Direct','rooms applyTurn · laatste leg / venue pending','wired',[['Wedstrijd','{{name}} · {{opponentName}}'],['Uitslag','{{score}}'],['Status','Wacht op bevestiging']]),
  spec('result-confirmed','Uitslag definitief','Wedstrijden','Uitslag bevestigd: {{score}} tegen {{opponentName}}','De uitslag staat in je wedstrijdhistorie.','Deze partij staat genoteerd.','Hoi {{name}},\nDe uitslag van je wedstrijd tegen {{opponentName}} is bevestigd. Je vindt de partij terug in je wedstrijdhistorie.','Bekijk je wedstrijd','De uitslag is definitief bevestigd.','Beide wedstrijdspelers','Direct','room-confirm-result / room-confirm-opponent / venue confirmed','wired',[['Tegenstander','{{opponentName}}'],['Uitslag','{{score}}'],['Status','Definitief']]),
  spec('result-disputed','Uitslag wordt beoordeeld','Wedstrijden','Een wedstrijduitslag wordt beoordeeld','De wedstrijdleiding kijkt naar de gemelde afwijking.','Samen naar de juiste uitslag.','Hoi {{name}},\nDe uitslag van {{actorName}} is betwist. De wedstrijdleiding kan de melding bekijken en een besluit vastleggen. Je ziet de voortgang bij de wedstrijd.','Bekijk de melding','Een speler betwist een ingevoerde uitslag.','Beide spelers en bevoegde wedstrijdleiding','Direct','room-dispute / venue dispute','wired',[['Wedstrijd','{{actorName}}'],['Gemelde uitslag','{{score}}'],['Toelichting','{{reason}}']]),
  spec('result-resolved','Besluit over uitslag','Wedstrijden','Besluit over je wedstrijd tegen {{opponentName}}','De wedstrijdleiding heeft de melding afgehandeld.','De uitslag is beoordeeld.','Hoi {{name}},\nDe wedstrijdleiding heeft de melding over je wedstrijd tegen {{opponentName}} afgehandeld. Hieronder lees je het besluit.','Bekijk het besluit','De wedstrijdleiding handelt een betwiste uitslag af.','Beide wedstrijdspelers','Direct','portal-resolve-dispute / venue resolve / forfeit','wired',[['Tegenstander','{{opponentName}}'],['Vastgelegde uitslag','{{score}}'],['Besluit','{{reason}}']]),
  spec('room-invite','Uitnodiging voor een kamer','Sociaal','{{actorName}} nodigt je uit voor {{roomName}}','Een plek om af te spreken, te praten en uit te dagen.','Schuif aan in de kamer.','Hoi {{name}},\n{{actorName}} heeft je uitgenodigd voor {{roomName}}. Open de kamer om je dartmaatjes te ontmoeten en samen een partij af te spreken.','Open de kamer','Een nieuwe privékamer wordt met een geselecteerde vriend aangemaakt.','De geselecteerde vriend','Direct','community-create · gekozen vriend','wired',[['Kamer','{{roomName}}'],['Uitgenodigd door','{{actorName}}']]),
  spec('moderation-notice','Moderatiebesluit','Sociaal','Bericht van de moderatie van {{roomName}}','Er is een moderatiebesluit vastgelegd.','Bericht van de moderatie.','Hoi {{name}},\nDe moderatie heeft een besluit vastgelegd binnen {{roomName}}. Lees hieronder de toelichting. Je vindt de actuele status in je eigen omgeving.','Bekijk de kamer','Een moderator neemt een maatregel tegen een kamerlid.','De betrokken speler','Direct','community mute / kick / ban','wired',[['Kamer','{{roomName}}'],['Maatregel','{{status}}'],['Toelichting','{{reason}}']]),
  spec('moderation-report','Nieuwe moderatiemelding','Sociaal','Nieuwe melding in {{roomName}}','Er staat een melding klaar om te beoordelen.','Een melding vraagt aandacht.','Hoi {{name}},\n{{actorName}} heeft een melding gedaan over {{roomName}}. Bekijk de context en leg een passende afhandeling vast in het meldingenoverzicht.','Bekijk melding','Een speler meldt gedrag of een bericht.','Bevoegde moderators of platformbeheer','Direct','portal-report','wired',[['Kamer','{{roomName}}'],['Melder','{{actorName}}'],['Toelichting','{{reason}}']]),
  spec('registration-received','Spelersaanmelding ontvangen','Account','Je spelersaanmelding is ontvangen, {{name}}','De beheerder beoordeelt je aanmelding.','Bedankt voor je aanmelding.','Hoi {{name}},\nWe hebben je spelersaanmelding ontvangen. De beheerder beoordeelt deze en je ontvangt bericht zodra er een besluit is.','Naar DartFlow','Een bezoeker meldt zich als speler aan in het prototype.','De aangemelde speler','Direct','player form · pending','wired',[['Speler','{{name}}'],['Status','Wacht op beoordeling']]),
  spec('registration-decision','Besluit spelersaanmelding','Account','Je spelersaanmelding: {{status}}','Er is een besluit genomen over je aanmelding.','Nieuws over je aanmelding.','Hoi {{name}},\nDe beheerder heeft je spelersaanmelding beoordeeld. Hieronder vind je het besluit.','Open DartFlow','Een beheerder keurt een spelersaanmelding goed of af.','De aangemelde speler','Direct','approve-request / reject-request · player','wired',[['Speler','{{name}}'],['Besluit','{{status}}']])
];

const PLACEHOLDER=/{{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*}}/g;
export const escapeMail=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const keysFrom=values=>[...new Set(values.flatMap(value=>[...String(value??'').matchAll(PLACEHOLDER)].map(m=>m[1])))];
export const MAIL_TEMPLATES=definitions.map(template=>{
  const variables=keysFrom([template.subject,template.preheader,template.title,template.body,template.cta,...template.details.flat(),template.code?'{{otp}}':'','{{actionUrl}}']);
  const routes={Account:'/#home',Vereniging:'/#clubs/701',Sociaal:'/#friends',Competitie:'/#leagues/501',Toernooien:'/#hall'};
  return Object.freeze({...template,variables,example:Object.freeze({...EXAMPLE,actionUrl:APP+(routes[template.category]||'/#mymatches')})});
});
export const MAIL_TEMPLATE_IDS=MAIL_TEMPLATES.map(template=>template.id);
const BASE_BY_ID=new Map(MAIL_TEMPLATES.map(template=>[template.id,template]));
const EDITABLE=['subject','preheader','title','body','cta'];
const scopeKey=scopeId=>String(scopeId??'global');
function editable(values){return Object.fromEntries(EDITABLE.filter(key=>typeof values?.[key]==='string').map(key=>[key,values[key].slice(0,key==='body'?8000:500)]));}
export function initializeMail(db){
  db.mail??={};
  if(!db.mail.templates||Array.isArray(db.mail.templates)||typeof db.mail.templates!=='object')db.mail.templates={};
  if(!Array.isArray(db.mail.outbox))db.mail.outbox=[];
  if(!db.mail.settings||typeof db.mail.settings!=='object')db.mail.settings={};
  if(!Array.isArray(db.mail.events))db.mail.events=[];
  return db.mail;
}
export function resolveTemplate(db,id,scopeId=null){
  const base=BASE_BY_ID.get(id);if(!base)return null;
  const mail=initializeMail(db),global=mail.templates.global?.[id]||{};
  const own=base.locked||scopeId==null?{}:mail.templates[scopeKey(scopeId)]?.[id]||{};
  const override={...global,...own};
  const published={...editable(global.published),...editable(own.published)};
  const merged={...base,...published,version:Math.max(1,Number(own.published?own.version:global.version)||1),enabled:base.locked?true:(override.enabled??base.enabled)!==false,inherited:scopeId!=null&&!own.published,customized:Boolean(own.published||scopeId==null&&global.published)};
  // Mandatory production payload remains required even if an edited paragraph omits it.
  merged.variables=[...new Set([...base.variables,...keysFrom([merged.subject,merged.preheader,merged.title,merged.body,merged.cta])])];
  return merged;
}
export function safeMailUrl(value){
  try{const raw=String(value??'').trim();if(raw.length>2048)return '';const url=new URL(raw);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:'';}catch{return '';}
}
const fill=(value,variables,html=false)=>String(value??'').replace(PLACEHOLDER,(_,key)=>{const replacement=variables?.[key];return html?escapeMail(replacement==null||String(replacement).trim()===''?'—':replacement):String(replacement==null||String(replacement).trim()===''?'—':replacement);});

export function renderMail(template,variables=template?.example||{}){
  if(!template)throw new TypeError('Onbekend mailtemplate.');
  const required=[...new Set([...(template.variables||[]),...keysFrom([template.subject,template.preheader,template.title,template.body,template.cta,...(template.details||[]).flat()])])];
  const missing=required.filter(key=>variables?.[key]==null||String(variables[key]).trim()==='');
  const actionUrl=safeMailUrl(variables.actionUrl);if(!actionUrl&&!missing.includes('actionUrl'))missing.push('actionUrl');
  const subject=fill(template.subject,variables).replace(/[\r\n]+/g,' ').slice(0,500);
  const preheader=fill(template.preheader,variables),title=fill(template.title,variables),body=fill(template.body,variables);
  const details=(template.details||[]).map(([label,value])=>[fill(label,variables),fill(value,variables)]);
  const paragraphs=body.split(/\n\s*\n|\n/).filter(Boolean).map((line,i)=>
    `<p style="margin:${i===0?'0':'16px'} 0 0;font-size:16px;line-height:1.7;color:#414944;overflow-wrap:anywhere;word-break:break-word;">${escapeMail(line)}</p>`
  ).join('');
  const code=template.code?`
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:28px;">
      <tr><td align="center" bgcolor="#181d1a" style="border:1px solid #48573e;border-radius:12px;padding:24px 12px;">
        <span style="color:#e6eee7;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Jouw eenmalige inlogcode</span>
        <div style="font-family:Consolas,Menlo,monospace;color:#B7F62B;font-size:38px;font-weight:700;letter-spacing:7px;line-height:1.7;">${escapeMail(variables.otp||'—')}</div>
        <span style="color:#bdc9be;font-size:12px;line-height:1.5;">Deel deze code met niemand.</span>
      </td></tr>
    </table>`:'';
  const detailsHtml=details.length?`
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:28px;background:#f2f6ef;border:1px solid #dbe5d7;border-radius:12px;table-layout:fixed;">
      <tr><td style="padding:6px 20px;">
        ${details.map(([label,value],i)=>`
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="table-layout:fixed;${i?'border-top:1px solid #dbe5d7;':''}">
            <tr>
              <td width="36%" valign="top" style="padding:13px 12px 13px 0;font-size:12px;line-height:1.6;color:#535e54;overflow-wrap:anywhere;">${escapeMail(label)}</td>
              <td valign="top" style="padding:13px 0;font-size:14px;line-height:1.5;color:#252c27;font-weight:700;overflow-wrap:anywhere;word-break:break-word;">${escapeMail(value)}</td>
            </tr>
          </table>`).join('')}
      </td></tr>
    </table>`:'';
  const cta=fill(template.cta,variables);
  const button=actionUrl?`
    <table role="presentation" cellspacing="0" cellpadding="0" style="margin-top:28px;">
      <tr><td bgcolor="#B7F62B" style="border:1px solid #96cd1a;border-radius:8px;text-align:center;">
        <a href="${escapeMail(actionUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:16px 24px;color:#192012;font-size:14px;font-weight:800;text-decoration:none;line-height:1.4;">${escapeMail(cta)} &nbsp;→</a>
      </td></tr>
    </table>`:'';
  const actionFallback=actionUrl?`
    <p style="margin:18px 0 0;font-size:11px;line-height:1.7;color:#535e54;overflow-wrap:anywhere;word-break:break-word;">Werkt de knop niet? Open dan deze link:<br>
      <a href="${escapeMail(actionUrl)}" style="color:#365710;text-decoration:underline;overflow-wrap:anywhere;word-break:break-word;">${escapeMail(actionUrl)}</a>
    </p>`:'';
  const html=`<!doctype html><html lang="nl">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <meta name="color-scheme" content="light">
      <title>${escapeMail(subject)}</title>
      <style>
        @media(max-width:620px){.mail-shell{width:100%!important;border-radius:0!important}.mail-pad{padding-left:24px!important;padding-right:24px!important}.mail-title{font-size:30px!important}.mail-outer{padding:16px 8px!important}}
        @media(max-width:420px){.mail-category{display:none!important}}
        body{margin:0;padding:0}a{word-break:break-word}
      </style>
    </head>
    <body style="margin:0;padding:0;background:#edf1ec;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
      <div style="display:none;font-size:1px;line-height:1px;color:#edf1ec;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeMail(preheader)}</div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#edf1ec">
        <tr><td class="mail-outer" align="center" style="padding:36px 16px;">
          <table role="presentation" class="mail-shell" width="600" cellspacing="0" cellpadding="0" bgcolor="#ffffff" style="width:100%;max-width:600px;border:1px solid #dbe5d7;border-radius:18px;overflow:hidden;table-layout:fixed;">
            <tr><td class="mail-pad" bgcolor="#181d1a" style="padding:24px 40px;border-top:4px solid #B7F62B;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td><a href="${APP}" style="display:inline-block;color:#B7F62B;font-size:23px;font-weight:800;text-decoration:none;">
                    <img src="${escapeMail(MAIL_LOGO_URL)}" alt="DartFlow" width="196" height="51" style="display:block;width:196px;max-width:100%;height:auto;border:0;color:#B7F62B;">
                  </a></td>
                  <td class="mail-category" align="right" style="font-size:10px;font-weight:700;letter-spacing:1.3px;color:#dce7db;">${escapeMail(template.category).toUpperCase()}</td>
                </tr>
              </table>
            </td></tr>
            <tr><td class="mail-pad" style="padding:36px 40px 32px;">
              <div style="font-size:10px;line-height:1.5;letter-spacing:2px;font-weight:700;color:#365710;text-transform:uppercase;margin-bottom:12px;">${escapeMail(template.name)}</div>
              <h1 class="mail-title" style="margin:0 0 22px;font-family:Arial,Helvetica,sans-serif;font-size:36px;line-height:1.12;letter-spacing:-1.2px;font-weight:900;color:#181d1a;overflow-wrap:anywhere;">${escapeMail(title)}</h1>
              ${paragraphs}${code}${detailsHtml}${button}${actionFallback}
            </td></tr>
            <tr><td class="mail-pad" bgcolor="#f2f6ef" style="padding:22px 40px;border-top:1px solid #dbe5d7;">
              <p style="margin:0;font-size:11px;line-height:1.7;color:#535e54;">Je ontvangt deze servicemail naar aanleiding van een activiteit op DartFlow. Controleer je actuele gegevens in je eigen omgeving.</p>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </body>
  </html>`;
  const text=[`DARTFLOW · ${template.category}`,preheader,'',title,'',body,'',template.code?`Eenmalige inlogcode: ${variables.otp||'—'}`:'',...details.map(([label,value])=>`${label}: ${value}`),'',actionUrl?`${cta}: ${actionUrl}`:'','Je ontvangt deze servicemail naar aanleiding van een activiteit op DartFlow.'].filter(value=>value!=='').join('\n');
  return {html,text,subject,missing};
}

const validEmail=email=>/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(String(email||''))&&!/[\r\n]/.test(String(email||''));
export function createMailItem(db,{templateId,eventId,scopeId=null,recipient={},variables={},kind='event'}={}){
  const mail=initializeMail(db),template=resolveTemplate(db,templateId,scopeId);if(!template)return null;
  const eventKey=String(eventId||'');if(!eventKey)throw new TypeError('Een stabiel eventId is verplicht.');
  const email=String(recipient.email||'').trim().toLowerCase();
  const key=[scopeKey(scopeId),templateId,eventKey,email].join('|');
  const duplicate=mail.outbox.find(item=>item.dedupKey===key);if(duplicate)return duplicate;
  if(!template.enabled)return null;
  if(kind==='event'&&!template.locked&&mail.settings[scopeKey(scopeId)]?.enabled===false)return null;
  const safeVariables={...variables,name:variables.name||recipient.name||''};
  // Auth providers own live codes. Never persist an OTP in the demo audit trail.
  if(template.id==='auth-otp')safeVariables.otp='••••••';
  const result=renderMail(template,safeVariables),missing=[...result.missing];
  if(!validEmail(email))missing.push('recipient.email');
  const createdAt=new Date().toISOString();
  const snapshot={...template,details:template.details.map(row=>[...row]),variables:[...template.variables],example:undefined};
  const item={id:`mail-${Date.now()}-${mail.outbox.length+1}`,templateId,eventId:eventKey,scopeId:scopeId??null,recipient:{name:String(recipient.name||safeVariables.name||''),email},variables:safeVariables,kind,status:missing.length?'failed':'simulated',createdAt,version:template.version||1,template:snapshot,subject:result.subject,html:result.html,text:result.text,missing,dedupKey:key,attempts:1};
  mail.outbox.unshift(item);
  mail.events.unshift({id:item.id,templateId,eventId:eventKey,scopeId:scopeId??null,status:item.status,at:createdAt});
  mail.events=mail.events.slice(0,300);
  return item;
}
