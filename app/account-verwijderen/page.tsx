import type {Metadata} from 'next';
import AccountDeletionForm from './request-form';
import styles from '../privacy/privacy.module.css';

export const metadata:Metadata={title:'Account verwijderen · DartFlow',description:'Verwijder je DartFlow-account en bijbehorende persoonsgegevens, of dien onafhankelijk van de app een privacyverzoek in.',alternates:{canonical:'https://dartflow.nl/account-verwijderen'}};

export default function AccountRemovalPage(){
 return <div className={styles.page}>
  <header className={styles.header}><a href="/" aria-label="DartFlow homepage"><img src="/assets/dartflow-logo.svg" width="164" height="44" alt="DartFlow"/></a><nav><a href="/privacy">Privacybeleid</a><a href="/app">Open DartFlow</a></nav></header>
  <main className={styles.main}>
   <header className={styles.intro}><p className={styles.eyebrow}>DartFlow · DG Webservices</p><h1>Account verwijderen<span>.</span></h1><p className={styles.lead}>Hier kun je je account voor DartFlow en de spelersapp verwijderen. Je hoeft de app daarvoor niet geïnstalleerd te hebben.</p></header>
   <div className={styles.prose}>
    <section><h2>Wat gebeurt er?</h2><p>Na jouw bevestiging blokkeren we de toegang tot je account onmiddellijk. Een beveiligde achtergrondtaak verwijdert je aanmelding, contactgegevens, spelerspincode, sociale relaties en persoonlijke instellingen. Eigen berichten en communitybijdragen worden verwijderd of leeggemaakt. Je eigen gekoppelde schermtoegang en persoonlijke deelkoppelingen worden ingetrokken.</p><p>Actieve vrije baansessies stoppen. Officiële wedstrijden worden onderbroken; de wedstrijdleiding handelt de uitslag volgens het bestaande toernooipad af. Bewaarde wedstrijduitslagen en toernooischema’s krijgen het label ‘Verwijderde speler’. Een technisch accountrecord zonder naam of e-mailadres blijft staan om bestaande uitslagen en verwijzingen niet te beschadigen.</p><p>De verwerking start automatisch. Bij een tijdelijke storing wordt opnieuw geprobeerd; je account blijft geblokkeerd. Voor back-ups, bestaande gegevens bij ontvangers en een wettelijke bewaarplicht gelden de uitzonderingen in het <a href="/privacy#bewaren">privacybeleid</a>. Een verwijderverzoek is niet terug te draaien.</p></section>
    <section><h2>Verwijderen met je eigen account</h2><p>Meld je aan en verifieer je eigen account opnieuw via Google of een e-mailcode. Bevestig daarna hieronder dat je definitief wilt verwijderen.</p><AccountDeletionForm/></section>
    <section><h2>Zonder aanmelding een verzoek indienen</h2><p>Kun je niet meer inloggen? Mail vanaf het bij DartFlow gebruikte e-mailadres naar <a href="mailto:info@dartflow.nl?subject=DartFlow%20account%20verwijderen">info@dartflow.nl</a> met het onderwerp ‘DartFlow account verwijderen’. Geef aan dat je jouw account en bijbehorende persoonsgegevens wilt laten verwijderen. Noem eventueel je gebruikersnaam zodat we het juiste account kunnen vinden.</p><p>Stuur geen wachtwoord, spelerspincode, toegangscode of identiteitsbewijs mee. We controleren het eigendom van het account via een passende verificatie voordat we gegevens verwijderen. Je krijgt in beginsel binnen één maand een reactie op je verzoek; als een wettelijke uitzondering geldt, lichten we die toe.</p></section>
   </div>
  </main>
  <footer className={styles.footer}><span>DartFlow · DG Webservices</span><nav><a href="/privacy">Privacybeleid</a><a href="mailto:info@dartflow.nl">info@dartflow.nl</a></nav></footer>
 </div>;
}
