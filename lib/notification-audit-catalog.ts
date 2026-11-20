import type {MailTemplate} from './integrations-catalog';
const definitions=[
 ['account-profile-changed','Accountprofiel gewijzigd','Beveiliging','Een bestaand profiel krijgt een gewijzigde publieke of privé-identiteit.'],
 ['account-email-changed','Accountadres gewijzigd','Beveiliging','Een geverifieerd Auth-account heeft een gewijzigd e-mailadres.'],
 ['player-pin-changed','Spelerspincode gewijzigd','Beveiliging','Een bestaande spelerspincode wordt gewijzigd of veilig opnieuw ingesteld.'],
 ['match-ready','Tegenstander gereed','Wedstrijden','Een tegenstander bevestigt de actuele wedstrijdoproep.'],
 ['match-started','Wedstrijd gestart','Wedstrijden','Een gezamenlijk geaccepteerde partij begint.'],
 ['reservation-requested','Nieuwe reserveringsaanvraag','Reserveringen','Een organisator vraagt fysieke banen aan bij locatiebeheer.'],
 ['reservation-updated','Reservering bijgewerkt','Reserveringen','Locatiebeheer besluit of een bevoegde actor annuleert de reservering.'],
 ['season-check-in','Deelnemer ingecheckt','Competitie','Een aangewezen speler checkt voor zijn ontmoeting in.'],
 ['season-result-review','Uitslag vraagt opvolging','Competitie','Een ontmoeting vraagt captainbevestiging of krijgt een geschil of leidingbesluit.'],
 ['season-entry','Seizoensdeelname bijgewerkt','Competitie','Een echte inschrijving of deelnamestatus in een beheerd seizoen verandert.'],
 ['chat-message','Nieuw privébericht','Chat','Een bericht in een afgeschermde wedstrijdchat of tweepersoonskamer is opgeslagen.'],
 ['club-activity-promoted','Plaats vrijgekomen','Vereniging','Een wachtende deelnemer krijgt daadwerkelijk een vrijgekomen activiteitplaats.'],
 ['club-ownership-offer','Overdracht vereniging aangeboden','Vereniging','De huidige eigenaar biedt een actief lid het eigenaarschap aan.'],
 ['club-membership-changed','Verenigingstoegang gewijzigd','Vereniging','Bevoegd verenigingsbeheer schorst, verwijdert of herstelt het lidmaatschap.'],
 ['location-role-changed','Locatiebeheer gewijzigd','Vereniging','Een locatie-eigenaar geeft of trekt gedeeld fysiek beheer in.'],
]as const;
export const AUDIT_NOTIFICATION_TEMPLATES:MailTemplate[]=definitions.map(([id,label,category,trigger])=>({id,label,category,trigger,enabled:true,readOnly:false,variables:['status'],details:[],fields:{subject:label,preheader:'Open DartFlow voor de actuele informatie.',title:label,body:'Er is een update die bij jouw account of deelname hoort. Open DartFlow voor de actuele gegevens. {{status}}',cta:'Bekijk in DartFlow'}}));
