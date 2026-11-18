# Native spelersapp · Play-gereedheid 0.1.1 (2)

De native spelersapp blijft `nl.dartflow.app`, gericht op telefoons en tablets. Oche Live heeft een eigen pakket. In deze versie zijn geen betalingen, advertenties, pushdienst of achtergrondvideo toegevoegd. Het contactadres is **info@dartflow.nl**. Dit document bevat geen inloggegevens of geheime configuratiewaarden.

## Melden en blokkeren

- **Community → post/reactie → Bericht melden / Reactie melden**: kies een categorie, geef een korte toelichting en verstuur. De inhoud blijft bij DartFlow; de melding wordt niet als offline opdracht op de telefoon opgeslagen.
- **Chat → bericht → Bericht melden**: dezelfde bediening voor wedstrijd-, community- en spelerskamerchat. De server controleert of de melder deze context mag openen.
- **Speler melden / Speler blokkeren**: bereikbaar bij de inhoud, in spelerszoekresultaten, bij vrienden en via de wedstrijdopties. Een blokkade vraagt expliciete bevestiging. Officiële uitslagen worden hierdoor niet verwijderd.
- **Vrienden → Geblokkeerd → Blokkade opheffen**: vraagt opnieuw bevestiging. De server bepaalt de actuele blokkade en toegang; de client verzint geen rechten.
- Meldingen zijn bedoeld voor intimidatie, haat, seksuele inhoud, kindveiligheid, bedreiging, fraude, privacyschending en overige misstanden. Deel geen wachtwoord, pincode of onnodige persoonsgegevens. Bij direct gevaar: bel 112. Overige hulp: info@dartflow.nl.

Voor een nieuwe communitybijdrage moet de gebruiker de actuele serverversie van de regels accepteren én bevestigen 13 jaar of ouder te zijn. De client houdt invoer tegen zolang acceptatie onbekend of vereist is; de backend handhaaft dezelfde regel. Melden, blokkeren en score-invoer blijven beschikbaar zonder UGC-acceptatie. De links zijn `/communityregels` en `/voorwaarden` op de eigen omgeving.

## Account en gegevens verwijderen

**Meer → Profiel & instellingen → Account en gegevens verwijderen → Account verwijderen aanvragen.** Lees de uitleg, open de bevestiging en typ exact `VERWIJDEREN`. Voor acceptatie controleert de server een recente eigen aanmelding. Bij de melding dat nieuwe verificatie nodig is: opnieuw aanmelden met de eigen e-mailcode of Google, terug naar profiel en de aanvraag herhalen.

De app meldt alleen ontvangst nadat de server `ok:true` en een geaccepteerde status heeft teruggegeven. Vervolgens worden tokens, profiel, tijdelijke opdrachten en terugkeerroute lokaal verwijderd; de mediawidget verdwijnt en stopt haar verbinding. Een afgewezen aanvraag meldt de fout en doet geen toezegging dat verwijdering gelukt is.

De onafhankelijke webroute is `/account-verwijderen`; deze is ook vanaf het aanmeldscherm bereikbaar. De pagina en het privacybeleid beschrijven welke gegevens worden gewist, geanonimiseerd of noodzakelijk bewaard. Er wordt geen niet-aangetoonde algemene verwijdertermijn beloofd.

## Toegang voor appbeoordeling

Op het aanmeldscherm staat **Toegang voor appbeoordeling**. Alleen het door platformbeheer afzonderlijk ingerichte beoordelingsaccount kan met het verstrekte e-mailadres en wachtwoord via `/api/player/v1/auth/review` aanmelden. Gewone spelers blijven e-mail-OTP of Google gebruiken. Dit is geen lokale fixture, algemene wachtwoordlogin of vaste toegangscode.

Het wachtwoord staat uitsluitend tijdelijk in het formulier, wordt gemaskeerd en na verzenden, verlaten of achtergrondgang gewist. De gewone versleutelde sessieopslag verwerkt daarna de serverbevestigde sessie. Reviewcredentials worden uitsluitend in de daarvoor bedoelde beveiligde velden van Play Console ingevuld.

Engels instructievoorstel, pas indienen nadat de echte voorziening is getest:

> Open "Toegang voor appbeoordeling" on the sign-in screen. Enter the reusable review credentials supplied in the dedicated Play Console fields. This account uses synthetic review data and does not require a one-time email code. Open "Spelen" to start a solo training session, or use the supplied permanent review-board URL to inspect a board lobby. Open "Meer" for community, statistics and profile settings. In community or chat, use "Bericht melden", "Speler melden" or "Speler blokkeren" to inspect safety controls. Do not delete the shared review account; account-deletion behavior is available under profile settings for inspection.

## Lokale QR-scanner en gegevensverklaring

De Google Play services-code-scanner, ML Kit-manifestmetadata en de ongebruikte meldingspermissie zijn verwijderd. De scanner gebruikt de bestaande CAMERA-permissie met Camera2 en een ingebouwde ZXing-decoder. Hij verwerkt uitsluitend frames in geheugen, leest geen galerij en verstuurt geen beelden aan een externe scannerprovider. Er worden geen scanbeelden, volledige QR-inhoud of decoderfouten gelogd. Alleen een herkende eigen DartFlow-route wordt door de bestaande deep-linkvalidatie geopend.

Bij geweigerde cameratoegang en bij een camerafout blijven annuleren en handmatige baanlink-/code-invoer beschikbaar. De camera sluit bij het verlaten van de scanner of achtergrondgang. Decoderproeven dekken vier rotaties, geïnverteerde QR's, padded/interleaved luminantie en corrupte invoer. Dat bewijst nog niet autofocus, lichtgevoeligheid of alle Camera2-drivercombinaties op echte telefoons.

De definitieve gegevensverklaring moet worden gebaseerd op de nieuw gebouwde release en resolved dependencyboom. Het weghalen van de scannerservice beëindigt niet de bestaande account-, sociale, wedstrijd-, WebRTC- en serverlogstromen. De volledige privacy-/transportcontrole daarvan blijft afzonderlijk nodig.

## Controleplan

Nieuwe JVM-regressies: gesloten communitytoegang bij ontbrekende acceptatiestatus; doelbinding van rapportage; geen duurzame opslag van meldtekst, verwijderopdracht of reviewwachtwoord; QR-luminantie/rotatie/decoderen en ongeldige frames.

Nieuwe Compose-regressies: expliciete regels- én leeftijdsbevestiging; blokkeerbevestiging; melding met verplichte toelichting; exacte verwijderbevestiging; handmatige invoer na geweigerde cameratoegang.

De root-releaseprocedure legt de hash van de definitieve ondertekende AAB vast. Op echte apparaten blijven QR-camera/achtergrondherstel, OTP/Google, App Links, twee-deelnemervideo en gebruikersveiligheidsflows te controleren.

### Uitgevoerd op 18 november 2026

De gecontroleerde bron is in een afzonderlijke remote bouwmap `/srv/dartflow-player-safety-dev/workspace` gebouwd met JDK 17.0.21, Android SDK 36 en de vastgelegde Gradle-wrapper. De bestaande ontwikkelmap en signingbestanden zijn niet aangepast.

| Controle | Resultaat |
| --- | --- |
| Development JVM | 34 tests, 0 fouten, 0 overgeslagen |
| Staging JVM | 34 tests, 0 fouten, 0 overgeslagen |
| Production JVM | 34 tests, 0 fouten, 0 overgeslagen |
| Lint drie debugflavors | Geslaagd; per flavor 0 fatal/errors en 27 niet-blokkerende dependency-, icoon- en stijlwaarschuwingen |
| Development APK en AndroidTest APK | Gebouwd; 14 Composeproeven gecompileerd |
| Production release/R8/AAB | Gebouwd; definitieve controle na scanner-autofocusaanpassing geslaagd in 2m13s |
| Werkelijk gemergd manifest | INTERNET, ACCESS_NETWORK_STATE, CAMERA, RECORD_AUDIO, MODIFY_AUDIO_SETTINGS en AndroidX signature-only receiverrecht; geen AD_ID, POST_NOTIFICATIONS of ML Kit-metadata |
| Production runtime dependencyboom | Geen GMS, ML Kit, Firebase, datatransport, Ads, Billing of Crashlytics; lokale ZXing 3.5.3 en WebRTC 144.7559.15 aanwezig |
| Composeproeven uitvoeren | Niet uitgevoerd op deze VPS: emulator, system images en `/dev/kvm` ontbreken |

Het voorlopige **ongetekende** artifact meet 26.297.053 bytes; SHA-256 `a19f13c17c8b05a56fcff36434bb6c4ef018f80ec0c0895c81e45668682464b1`. Dit is bouwbewijs en geen Play-uploadbestand. Dit eerdere artifact is door de aanvullende media-intrekkingsfix vervangen. Gebruik uitsluitend de definitieve ondertekende release uit het opleverdocument.

### Media-intrekking vóór de definitieve release

Een definitieve weigering van signaaltoegang (401/403/404/410) sluit nu een reeds bestaande peerverbinding, camera en microfoon. Tijdelijke server-/netwerkfouten blijven herstelbaar. Generatiecontroles voorkomen dat een laat antwoord een nieuwe verbinding beïnvloedt. Drie gerichte JVM-proeven oefenen de werkelijke stoproute; een extra Composeproef controleert het verdwijnen van de camerabediening. De nieuwe JVM-telling is 34 per flavor, 102 totaal.
