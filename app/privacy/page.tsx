import type {Metadata} from 'next';
import {appConfig} from '@/lib/config';
import styles from './privacy.module.css';

export const dynamic = 'force-dynamic';
const canonical = 'https://dartflow.nl/privacy';
const contact = 'info@dartflow.nl';
const sections = [
  ['aanbieder', 'Wie zijn wij?'], ['gegevens', 'Gegevens en doeleinden'],
  ['zichtbaarheid', 'Profielen en scoreborden'], ['camera', 'Camera en microfoon'],
  ['oche-live', 'Oche Live en schermkoppelingen'], ['cookies', 'Cookies en analytics'],
  ['ontvangers', 'Leveranciers en delen'], ['internationaal', 'Internationale verwerking'],
  ['bewaren', 'Bewaren en beveiligen'], ['gegevens-verwijderen', 'Jouw rechten en verwijdering'],
  ['wijzigingen', 'Wijzigingen en contact'],
] as const;

export function generateMetadata(): Metadata {
  const production = appConfig().origin === 'https://dartflow.nl';
  return {
    title: 'Privacybeleid · DartFlow',
    description: 'Hoe DG Webservices persoonsgegevens verwerkt voor de DartFlow-website, het spelersplatform en DartFlow Oche Live. Lees ook hoe je jouw privacyvoorkeuren en rechten gebruikt.',
    alternates: {canonical}, robots: {index: production, follow: production},
    openGraph: {title: 'Privacybeleid · DartFlow', description: 'Jouw gegevens, privacykeuzes en rechten bij DartFlow en Oche Live.', type: 'website', locale: 'nl_NL', siteName: 'DartFlow', url: canonical},
  };
}

export default function Privacy() {
  const analyticsAvailable = appConfig().mode === 'supabase';
  return <div className={styles.page}>
    <a className={styles.skip} href="#privacy-inhoud">Direct naar het privacybeleid</a>
    <header className={styles.header}>
      <a href="/" aria-label="DartFlow homepage"><img src="/assets/dartflow-logo.svg" width="164" height="44" alt="DartFlow" /></a>
      <nav aria-label="Hoofdnavigatie"><a href="/blog">Blog</a><a className={styles.open} href="/app">Open DartFlow <span aria-hidden="true">↗</span></a></nav>
    </header>
    <main id="privacy-inhoud" className={styles.main}>
      <header className={styles.intro}>
        <p className={styles.eyebrow}>DartFlow · DG Webservices</p>
        <h1>Privacybeleid<span>.</span></h1>
        <p className={styles.lead}>Jouw gegevens, jouw keuzes. Dit beleid geldt voor de DartFlow-website, het spelers- en beheerdersplatform, de webapps, de native DartFlow-spelersapp en de Android-app DartFlow Oche Live.</p>
        <p className={styles.updated}>Laatst bijgewerkt: <time dateTime="2026-11-18">18 november 2026</time></p>
      </header>
      <aside className={styles.summary} aria-labelledby="privacy-samenvatting">
        <h2 id="privacy-samenvatting">Goed om te weten</h2>
        <ul><li>Voor spelen, inloggen en schermkoppelingen verwerken we de gegevens die daarvoor nodig zijn.</li><li>Analytics op de website starten pas na jouw toestemming. De native Oche Live-app gebruikt geen analytics- of advertentie-SDK.</li><li>Je kunt je voorkeuren aanpassen en inzage, correctie of verwijdering aanvragen.</li></ul>
      </aside>
      <div className={styles.layout}>
        <nav className={styles.contents} aria-label="Inhoud privacybeleid"><h2>Op deze pagina</h2><ol>{sections.map(([id, title]) => <li key={id}><a href={`#${id}`}>{title}</a></li>)}</ol></nav>
        <div className={styles.prose}>
          <section id="aanbieder">
            <h2>1. Wie zijn wij?</h2>
            <p>DartFlow is een dienst van <strong>DG Webservices</strong>. DG Webservices is verantwoordelijk voor de verwerking van persoonsgegevens voor het aanbieden en beveiligen van de eigen website, accounts en dienstverlening. Voor privacyvragen kun je mailen naar <a href={`mailto:${contact}`}>{contact}</a>.</p>
            <p>Een vereniging, locatie of organisator kan daarnaast zelf verantwoordelijk zijn voor de inschrijvingen, deelnemersgegevens en uitslagen die zij via DartFlow beheert. Neem voor die verwerking ook contact op met de betreffende organisatie. Wij helpen waar een verzoek betrekking heeft op onze dienstverlening.</p>
          </section>
          <section id="gegevens">
            <h2>2. Welke gegevens verwerken we en waarom?</h2>
            <p>Dit hangt af van de functies die je gebruikt. Gegevens komen van jou, van je gekozen inlogprovider of van een organisator of medespeler die je bij een activiteit betrekt.</p>
            <ul>
              <li><strong>Account en profiel.</strong> E-mailadres, account-ID, gebruikersnaam, weergavenaam, een eventuele profielfoto en je instellingen. Bij Google-login ontvangen we de gegevens die Google voor die aanmelding verstrekt, zoals je naam, e-mailadres en profielfoto. We gebruiken deze om je te herkennen, toegang te geven en je profiel te tonen.</li>
              <li><strong>Spelen en organiseren.</strong> Deelnemers, inschrijvingen, clubs en rollen, locaties, banen, reserveringen, worpen, uitslagen, trainingen en statistieken. Deze zijn nodig voor het uitvoeren van wedstrijden, baanbeheer, toernooien, competitie en jouw gespeelde historie.</li>
              <li><strong>Contact en community.</strong> Berichten, vriendschapsverzoeken, reacties, gedeelde resultaten, blokkades, geaccepteerde regelversies en eventuele meldingen die je indient. We gebruiken die voor de gekozen communicatie en voor moderatie en ondersteuning.</li>
              <li><strong>E-mail.</strong> Je e-mailadres, de inhoud van een verzonden bericht en aflever- of foutmeldingen. Dit maakt inloggen met een e-mailcode, uitnodigingen, serviceberichten en gekozen meldingen mogelijk.</li>
              <li><strong>Apparaten en beveiliging.</strong> Installatie- en sessiegegevens, netwerkgegevens zoals je IP-adres, aanvraagmomenten en gegevens over fouten, koppelingen en beheeracties. Hiermee leveren en beveiligen we de dienst en begrenzen we misbruik.</li>
              <li><strong>Websiteanalyse.</strong> Alleen na toestemming kunnen bezochte pagina’s, klikken, herkomst en technische browser- of apparaatgegevens via SocialHero worden gemeten. Zie ook onderdeel 6.</li>
            </ul>
            <h3>Op welke grond doen we dit?</h3>
            <p>Voor de aangevraagde account-, spel- en beheerfuncties verwerken we gegevens om onze overeenkomst met jou uit te voeren. Voor beveiliging, het voorkomen van misbruik, ondersteuning en de betrouwbaarheid van wedstrijden hebben we een gerechtvaardigd belang, waarbij we rekening houden met jouw privacy. Waar een wettelijke verplichting geldt, verwerken we de daarvoor benodigde gegevens. Voor optionele analytics vragen we vooraf toestemming; je kunt die altijd intrekken.</p>
            <p>Accountgegevens die nodig zijn voor aanmelding en deelname zijn verplicht voor die functies. Zonder die gegevens kun je de openbare website wel bezoeken, maar niet alle spelers- of beheerfuncties gebruiken.</p>
          </section>
          <section id="zichtbaarheid">
            <h2>3. Wat kunnen anderen zien?</h2>
            <p>Je gebruikersnaam, weergavenaam, eventuele avatar en relevante wedstrijdgegevens kunnen zichtbaar zijn voor medespelers en bevoegde organisatoren. Op een openbaar baanscherm kunnen aanwezigen en bezoekers van de openbare schermlink de toegestane spelersnamen, live stand, scorekaart en live wedstrijdcijfers zien. Deel daarom alleen informatie die bij die zichtbaarheid past.</p>
            <p>DartFlow is bedoeld voor spelers vanaf 13 jaar. Voor communityberichten bevestig je dat je minimaal 13 jaar bent en akkoord gaat met de <a href="/communityregels">communityregels</a> en <a href="/voorwaarden">voorwaarden</a>. Hiervoor slaan we de regelversie en het acceptatiemoment op, geen geboortedatum. Meldingen en blokkades zijn veiligheidsfuncties; de identiteit van een melder wordt niet automatisch aan de gemelde speler verstrekt.</p>
            <p>De zichtbaarheid van historische profielcijfers op openbare Oche Live-schermen is een afzonderlijke profielvoorkeur en staat standaard uit. Andere zichtbaarheids- en berichtvoorkeuren beheer je bij je profielinstellingen. Wat je zelf in een openbare community of via een openbare resultaatlink deelt, is zichtbaar voor het daarbij aangegeven publiek.</p>
            <p>Wedstrijdgemiddelden, statistieken en ranglijsten worden uit geregistreerde scores en uitslagen berekend. We gebruiken deze berekeningen niet om uitsluitend geautomatiseerde besluiten met juridische of vergelijkbaar ingrijpende gevolgen over jou te nemen.</p>
          </section>
          <section id="camera">
            <h2>4. Camera en microfoon bij online spelen</h2>
            <p>Als je een videogesprek gebruikt, vraagt de browser of de native spelersapp toegang tot camera en microfoon. Je bepaalt zelf of je deze inschakelt en kunt ze weer uitschakelen. Beeld en geluid gaan via de verbinding met je tegenstander; waar nodig helpt een relayserver de verbinding tot stand te brengen. Daarbij worden ook technische verbindingsgegevens verwerkt.</p>
            <p>De native spelersapp kan een vaste baan-QR scannen. Camerabeelden en het herkennen van de QR-code worden op het apparaat verwerkt met Camera2 en ZXing. De app verstuurt de herkende baanlink wanneer je die opent; de camerabeelden worden niet voor de scan naar DartFlow verstuurd. De scanner gebruikt geen Google ML Kit- of analytics-SDK. De app leest niet je adresboek, fotobibliotheek of GPS-locatie. Een door jou bevestigde check-in koppelt je deelname wel aan een fysieke baan en het betreffende moment.</p>
            <p>DartFlow biedt in deze functie geen opname van beeld of geluid. Technische signaleringsgegevens kunnen wel worden opgeslagen om de verbinding te laten werken. De afzonderlijke Oche Live-schermapp vraagt geen toegang tot je camera, microfoon, contacten of GPS-locatie.</p>
          </section>
          <section id="oche-live">
            <h2>5. Oche Live en gekoppelde schermen</h2>
            <p>DartFlow Oche Live is de zelfstandige, alleen-lezen schermweergave voor browser, Android-telefoon, tablet en TV. Bij een koppeling bewaren we een installatie-ID, schermnaam, apparaattype, eigenaar of locatie, eventuele baan, beheer- en intrekkingsmomenten en het moment waarop het scherm voor het laatst verbinding maakte.</p>
            <p>Een koppelcode is tien minuten geldig. De koppel-QR bevat de tijdelijke code, niet het installatiegeheim. Een scherm krijgt alleen toegang tot de toegewezen weergave en kan daarmee geen scores invoeren of accountinstellingen wijzigen. De browser gebruikt afgeschermde cookies; de Android-app bewaart toegangsinformatie versleuteld met Android Keystore.</p>
            <p>Via <a href="/app/schermen">Schermen</a> kun je een eigen scherm ontkoppelen of vervangen. Een bevoegde locatiebeheerder kan dat voor locatieschermen doen. Offline zijn ontkoppelt een scherm niet vanzelf. Ontkoppelen beëindigt de schermtoegang, maar verwijdert geen gespeelde wedstrijden.</p>
          </section>
          <section id="cookies">
            <h2>6. Cookies, lokale opslag en analytics</h2>
            <p>We gebruiken functionele cookies en lokale opslag voor onder meer inloggen, beveiligde schermtoegang en het onthouden van instellingen. Een geïnstalleerde webapp kan geschikte appbestanden bewaren om de app te laden. Live scores, scoremutaties en accountsessies horen niet in die appbestandencache.</p>
            <p>Met jouw afzonderlijke toestemming gebruikt de website SocialHero voor bezoek- en klikmeting. Je keuze wordt in deze browser maximaal <strong>180 dagen</strong> onthouden. Via <strong>Privacyvoorkeuren</strong> in de footer kun je toestemming geven, weigeren of intrekken. Weigeren laat spelen en inloggen beschikbaar. Intrekken stopt verdere meting; verwerking die al met geldige toestemming plaatsvond wordt daardoor niet met terugwerkende kracht ongedaan gemaakt.</p>
            <p>De browserweergaven voor Oche Live, schermkoppeling en de uitgesloten score- en trainingsroutes laden de SocialHero-meetpixel niet. De native Oche Live-app bevat geen analytics- of advertentie-SDK. Als de browser Do Not Track of Global Privacy Control doorgeeft, blijven deze analytics uit.</p>
          </section>
          <section id="ontvangers">
            <h2>7. Met wie delen we gegevens?</h2>
            <p>Gegevens worden toegankelijk voor de personen en dienstverleners die nodig zijn voor de gekozen functie:</p>
            <ul>
              <li><strong>DG Webservices en hostingdienstverleners:</strong> het uitvoeren, onderhouden, ondersteunen en beveiligen van DartFlow.</li>
              <li><strong>Supabase:</strong> accountaanmelding, database en de bijbehorende backenddiensten.</li>
              <li><strong>Resend:</strong> verzending en afleververwerking van aanmeld- en applicatiemails.</li>
              <li><strong>Google:</strong> als je kiest voor Google-login. Bij installatie via Google Play verwerkt Google daarnaast gegevens volgens zijn eigen voorwaarden en privacybeleid.</li>
              <li><strong>SocialHero van DG Webservices:</strong> websiteanalyse na toestemming en het publiceren van redactionele blogcontent via een beveiligde koppeling. Die publicatiekoppeling geeft geen algemene toegang tot spelersaccounts of privéwedstrijden.</li>
              <li><strong>Medespelers, organisatoren en schermpubliek:</strong> uitsluitend de informatie die bij deelname, rechten en de gekozen zichtbaarheid hoort.</li>
            </ul>
            <p>We verkopen je persoonsgegevens niet. Verstrekking aan andere partijen kan daarnaast nodig zijn als de wet ons daartoe verplicht of voor de afhandeling van een juridisch geschil.</p>
          </section>
          <section id="internationaal">
            <h2>8. Verwerking buiten de Europese Economische Ruimte</h2>
            <p>Leveranciers zoals Google, Supabase en Resend werken internationaal. Gegevens kunnen daardoor buiten de Europese Economische Ruimte worden verwerkt. Supabase en Resend beschrijven hun verwerkingsafspraken en waarborgen voor internationale doorgifte, waaronder Europese modelcontractbepalingen, in hun <a href="https://supabase.com/legal/customer-resources/data-processing-addendum" rel="noopener noreferrer">Supabase-verwerkersvoorwaarden</a> en <a href="https://resend.com/legal/dpa" rel="noopener noreferrer">Resend-verwerkersvoorwaarden</a>.</p>
            <p>Je kunt via <a href={`mailto:${contact}`}>{contact}</a> informatie opvragen over de voor jouw gegevens gebruikte leveranciers en doorgiftewaarborgen. Voor de eigen verwerking door Google geldt ook het <a href="https://policies.google.com/privacy?hl=nl" rel="noopener noreferrer">privacybeleid van Google</a>.</p>
          </section>
          <section id="bewaren">
            <h2>9. Hoe lang bewaren en hoe beveiligen we gegevens?</h2>
            <ul>
              <li><strong>Account en profiel:</strong> zolang je account wordt aangehouden en de gegevens nodig zijn voor de dienst. Je kunt een verwijderingsverzoek indienen.</li>
              <li><strong>Wedstrijden, trainingen en organisatiegegevens:</strong> zolang ze nodig zijn voor historie, statistieken, competitie- en toernooibeheer of een gerechtvaardigde afhandeling van geschillen. Bij een verzoek beoordelen we ook de gegevens en belangen van andere deelnemers en mogelijkheden om gegevens te anonimiseren.</li>
              <li><strong>Schermkoppelingen:</strong> zolang de koppeling bestaat. Tijdelijke codes, goedkeuringen en herstelgegevens hebben een beperkte geldigheid. Het verlopen daarvan betekent niet dat alle beveiligings- of beheerregistraties meteen zijn gewist.</li>
              <li><strong>Ondersteuning, mail- en beveiligingsregistraties:</strong> voor zover nodig voor de afhandeling van je vraag, betrouwbare aflevering, storingsonderzoek, misbruikpreventie en eventuele wettelijke verplichtingen.</li>
              <li><strong>Back-ups:</strong> gegevens kunnen in beveiligde back-ups blijven staan totdat die worden vervangen of verwijderd. Bij een verwijderingsverzoek nemen we dit mee in de afhandeling en informeren we je over eventuele beperkingen.</li>
            </ul>
            <p>Er is geen algemene automatische wisdatum voor alle account-, wedstrijd- en loggegevens. De bewaartermijn hangt af van de hierboven genoemde doelen, lopende activiteiten, wettelijke verplichtingen en eventuele geschillen. Vraag ons om informatie over jouw concrete gegevens.</p>
            <p>We gebruiken onder meer versleutelde verbindingen, toegangscontrole, beperkte schermrechten en afgeschermde opslag van geheimen. De spelerspincode wordt als beveiligde controlewaarde opgeslagen en verschijnt niet op je openbare profiel. Geef geen pincode, inlogcode of schermtoken door aan iemand die je niet vertrouwt.</p>
          </section>
          <section id="gegevens-verwijderen">
            <h2>10. Jouw rechten en gegevens laten verwijderen</h2>
            <p>Je kunt vragen om inzage, correctie, verwijdering, beperking of overdracht van jouw persoonsgegevens, voor zover de AVG dat recht in jouw situatie geeft. Je kunt bezwaar maken tegen verwerking op basis van een gerechtvaardigd belang en toestemming voor optionele verwerking intrekken.</p>
            <p>Via <a href="/account-verwijderen">Account verwijderen</a> kun je de stappen voor een account- of gegevensverwijderingsverzoek vinden. De native spelersapp biedt deze route ook vanuit je profiel. Uitloggen of een scherm ontkoppelen is geen accountverwijdering.</p>
            <p>Stuur je verzoek naar <a href={`mailto:${contact}?subject=Privacyverzoek%20DartFlow`}>{contact}</a>, bij voorkeur vanaf het e-mailadres van je account. Vermeld dat het om DartFlow gaat en of je inzage, correctie of verwijdering van je account en gegevens wilt. We kunnen aanvullende informatie vragen om je identiteit veilig te controleren. Stuur geen wachtwoord, pincode, aanmeldcode of kopie van je identiteitsbewijs mee zonder dat daar een passende reden en veilige werkwijze voor is afgesproken.</p>
            <p>We reageren in beginsel binnen één maand. Als een verzoek complex is of er meerdere verzoeken zijn, kan de wettelijke termijn worden verlengd; daarover informeren we je binnen de eerste maand. Gegevens die we vanwege een wettelijke verplichting of een andere geldige uitzondering moeten behouden, worden niet zonder meer gewist. We leggen dan uit wat blijft en waarom.</p>
            <p>Profielgegevens en zichtbaarheid kun je waar beschikbaar zelf aanpassen via <a href="/app/profiel">je profiel</a>. Analytics wijzig je via Privacyvoorkeuren. Heb je een klacht over de verwerking van jouw persoonsgegevens, dan kun je contact met ons opnemen en een klacht indienen bij de <a href="https://www.autoriteitpersoonsgegevens.nl/" rel="noopener noreferrer">Autoriteit Persoonsgegevens</a>.</p>
          </section>
          <section id="wijzigingen">
            <h2>11. Wijzigingen en contact</h2>
            <p>Als de dienstverlening of gegevensverwerking verandert, werken we deze pagina bij. De datum bovenaan geeft aan wanneer deze versie is aangepast. Waar een wijziging nieuwe toestemming vereist, vragen we die afzonderlijk.</p>
            <p>Vragen over dit beleid of jouw gegevens? Mail <a href={`mailto:${contact}`}>{contact}</a> en vermeld <strong>DartFlow</strong> of <strong>DartFlow Oche Live</strong>.</p>
          </section>
        </div>
      </div>
    </main>
    <footer className={styles.footer}>
      <span>DartFlow · DG Webservices</span>
      <nav aria-label="Footernavigatie"><a href="/">Homepage</a><a href="/oche-live">Oche Live</a><a href="/privacy" aria-current="page">Privacybeleid</a><a href="/communityregels">Communityregels</a><a href="/voorwaarden">Voorwaarden</a><a href="/account-verwijderen">Account verwijderen</a>{analyticsAvailable && <button type="button" className="dartflow-privacy-link" data-open-dartflow-privacy>Privacyvoorkeuren</button>}</nav>
    </footer>
  </div>;
}
