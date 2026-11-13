import type {Metadata} from 'next';
import {appConfig} from '@/lib/config';

export const dynamic='force-dynamic';
export function generateMetadata():Metadata{return {title:'Privacy van Oche Live · DartFlow',alternates:{canonical:`${appConfig().origin}/privacy`}};}
export default function Privacy(){return <main style={{maxWidth:'72ch',margin:'0 auto',padding:'max(24px, env(safe-area-inset-top)) 24px 64px',lineHeight:1.7}}>
  <a href="/"><img src="/assets/dartflow-logo.svg" width="160" height="48" alt="DartFlow"/></a>
  <h1>Privacy van Oche Live</h1><p>Bijgewerkt op 13 november 2026. Oche Live is de zelfstandige schermweergave van DartFlow, beheerd door DG Webservices. Vragen over deze weergave en je gegevens kun je stellen via <a href="mailto:info@dgwebservices.nl">info@dgwebservices.nl</a>.</p>
  <h2>Een gekoppeld scherm</h2><p>Een scherm krijgt een eigen installatie-ID en beperkte toegang tot de toegewezen schermweergave. DartFlow bewaart de schermnaam, het apparaattype, de eigenaar of locatie, de gekozen baan, het koppel- en intrekkingsmoment en het moment waarop het scherm voor het laatst verbinding maakte. Dit maakt koppelen, beheren en intrekken mogelijk.</p>
  <p>Een scherm kan de toegestane spelersnamen, wedstrijdstand, scorekaart en bijbehorende wedstrijdinformatie tonen. Het scherm kan geen scores invoeren of accountinstellingen wijzigen. Kies voor een thuisscherm alleen een eigen sessie die je op dat apparaat wilt tonen. Iedereen die naar het scherm kijkt, kan de getoonde informatie zien.</p>
  <h2>Codes en toegang</h2><p>Een koppelcode is tien minuten geldig. De QR bevat uitsluitend die tijdelijke code. Het installatiegeheim staat niet in de QR. Browsertoegang gebruikt afgeschermde cookies; de Android-app bewaart toegangsinformatie versleuteld met Android Keystore. De server bewaart controlewaarden van geheimen en versleutelde, tijdelijke herstelgegevens voor veilig herhalen van aanvragen.</p>
  <p>Koppelcodes, tijdelijke goedkeuringen en herstelgegevens verlopen automatisch. Een offline scherm blijft gekoppeld totdat de eigenaar of bevoegde beheerder het ontkoppelt of vervangt. Beveiligings- en beheermetadata worden vastgelegd om fouten, misbruik en wijzigingen te kunnen onderzoeken.</p>
  <h2>Netwerk en analyse</h2><p>DartFlow verwerkt netwerk- en aanvraaggegevens om de dienst te leveren en koppelpogingen te begrenzen. De native Oche Live-app bevat geen advertentie- of analytics-SDK. De browserroutes voor Oche Live en schermkoppeling laden geen SocialHero-meetpixel. Andere delen van de website kunnen na afzonderlijke toestemming analytics gebruiken.</p>
  <h2>Beheer en vragen</h2><p>Via Schermen in je DartFlow-account kun je je eigen schermen beheren en toegang intrekken. Een bevoegde locatiebeheerder beheert de schermen van die locatie. Ontkoppelen trekt de schermtoegang in en verwijdert geen gespeelde wedstrijden. Neem voor vragen over inzage, correctie of verwijdering van persoonsgegevens contact op met DG Webservices; vermeld geen wachtwoorden, pincodes of schermtokens.</p>
  <p><a href="/oche-live">Oche Live openen</a> · <a href="/app/schermen">Mijn schermen</a></p>
</main>;}
