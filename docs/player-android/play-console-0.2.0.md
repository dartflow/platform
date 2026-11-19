# Play Console-gegevenscontrole · Player 0.2.0 (5)

Dit is de onderbouwing voor kandidaat `nl.dartflow.app` 0.2.0, versiecode 5, gecontroleerd op 19 november 2026. De huidige Data safety-antwoorden in Play Console zijn **niet ingezien of bevestigd**. Er is geen formulier gewijzigd of publicatie uitgevoerd. De eerdere 0.1.x-verklaringen over afwezige Firebase/GMS/datatransport gelden niet voor deze kandidaat.

## Werkelijke SDK-graaf

De lokaal opgeloste `productionReleaseRuntimeClasspath` bevat Firebase Messaging **25.0.1**, Installations **18.0.0**, firebase-datatransport **18.2.0**, transport-runtime/backend-cct **3.1.9** en Google Play services base/basement/tasks. `firebase-measurement-connector:19.0.0` is transitief aanwezig; de Firebase Analytics-SDK en GMS measurement-SDK ontbreken. Ook Ads, Billing, Crashlytics en MLKit ontbreken. De bestaande WebRTC- en ZXing-afhankelijkheden blijven aanwezig. Graafhash, zes Gradle-invoerhashes en bronhashes staan in het [lokale controlebewijs](../evidence/full-release-player-messaging-disclosure-local-2026-11-19.json).

Firebase beschrijft voor Messaging appversie en technische SDK-/apparaatmetadata, en voor Installations een installatie-ID. De FID identificeert een appinstallatie en wordt door FCM gebruikt om berichten te bezorgen. Neem deze transitieve verwerking mee bij de formuliercontrole. De officiële SDK-verklaring beschrijft de nieuwste SDK's; toets die aan de hierboven vastgestelde versies en de gebruikte configuratie. [Firebase SDK-gegevensverklaring](https://firebase.google.com/docs/android/play-data-disclosure#cloud-messaging), [Firebase Installations](https://firebase.google.com/docs/projects/manage-installations).

## Toestemming en meldingsverwerking

De app bevat `POST_NOTIFICATIONS`, een niet-geëxporteerde `PlayerMessagingService` en `PlayerApplication`. Messaging-auto-init en Analytics-collectie staan in het manifest standaard uit; er is geen `google-services.json` gebundeld. Publieke SDK-opties komen via de geauthenticeerde DartFlow-API. Pas na een bewuste keuze voor systeemmeldingen en beschikbare configuratie initialiseert de app Firebase en registreert zij een token. Een koude herstart hergebruikt uitsluitend de ingeschakelde binding voor de actuele login en appomgeving. De Android 13+-toestemmingsvraag volgt die eigen keuze. Weigeren blokkeert spelen of de gewone inbox niet. [FCM-auto-init](https://firebase.google.com/docs/cloud-messaging/android/get-started#prevent_auto_initialization), [Android-meldingsrechten](https://developer.android.com/develop/ui/compose/notifications/notification-permission).

| Gegevensstroom | Huidige implementatie en doel |
| --- | --- |
| Firebase-installatie/registratie | Google verwerkt installatie-/registratie-identificatoren en technische app-/apparaatgegevens voor de optionele berichtendienst. DartFlow-login, spelers-PIN en servercredential worden niet aan de SDK verstrekt. |
| DartFlow-toestelbinding | Token versleuteld op de server, gebonden aan account, omgeving, package en installatie. Nodig om de gekozen meldingen naar het juiste toestel te sturen. |
| Pushinhoud | Alleen ondoorzichtige inbox-ID, toestelbinding-ID en categorie. Algemene vergrendelschermtekst zonder spelersnamen, scores, chatinhoud of privéroute. |
| Inbox en ontvangst | Bron, categorie, vervaltijd en status `accepted`, `received` of `opened`. Provideracceptatie bewijst geen toestelontvangst. Geen Analytics-SDK of BigQuery-bezorgexport toegevoegd. |
| Openen | De actuele login vraagt de doelroute op. Server controleert accountstatus, categorievoorkeur, toegang en actuele bron opnieuw. Tikken voert geen score, acceptatie of inschrijving uit. |

Categorievoorkeuren zijn gedeeld met de bestaande mailvoorkeuren. Uitschakelen/uitloggen wist lokale meldingen en schakelt de binding uit; accountwissel accepteert geen push voor het vorige account. De app schakelt Messaging-auto-init uit en vraagt tokenverwijdering bij uitschakelen. Camera/microfoon blijven afzonderlijke, zichtbare WebRTC-functies; deze wijziging voegt geen achtergrondopname toe.

## Retentie en verwijdering

DartFlow-toestelregistraties verlopen na **90 dagen zonder vernieuwing**. Inboxgegevens worden **30 dagen na hun vervaltijd** opgeruimd; gekoppelde bezorgingen verdwijnen mee. Deze opruiming draait ook zonder FCM-verzendconfiguratie. Een accountverwijderverzoek wist tokenenveloppen, inbox en uitstaande/geleasede bezorgingen direct in dezelfde databasetransactie. De lokale echte DB-suite bewijst dit en de opruiming zonder FCM: **18/18 tests**, nul overgeslagen. Dit bewijst geen onmiddellijke verwijdering van Google-eigen installatiegegevens; daarvoor gelden de providerprocessen en moet de Console-verklaring de werkelijke verwerking volgen.

Een CSV-voorbeeld bij deelnemersimport is **30 minuten** geldig; de periodieke opruiming verwijdert daarna de verlopen CSV en namen. Na bevestigen gelden de bestaande deelnemers- en wedstrijdhistorieprocessen. Het [privacybeleid](https://dartflow.nl/privacy) moet deze kandidaatverwerking dekken; een bijgewerkte bronpagina is nog geen bewijs van een uitgevoerde productie-uitrol.

## Openstaande publicatiecontrole

De bevoegde Consolebeheerder moet de bestaande Data safety-antwoorden vergelijken met deze SDK-graaf, optionele verwerking, doeleinden, ontvangers, beveiliging en verwijderprocessen. Google legt de verantwoordelijkheid voor de juiste appverklaring bij de ontwikkelaar; de SDK-informatie vult het apponderzoek aan. Dit document vult geen onbevestigde formulierantwoorden in. [Officiële toelichting](https://firebase.google.com/docs/android/play-data-disclosure).

Firebase-projectconfiguratie en daadwerkelijke verzendrechten konden met de bestaande identiteit nog niet worden bevestigd. Publieke SDK-opties zijn geen servercredential. Er is nog geen bewezen achtergrond-/koude-startbezorging op een echt toestel. Bewijs daarvoor vereist de ingerichte provider, toestemming verlenen/weigeren, accountwissel/uitloggen, tokenrotatie, verlopen/ingetrokken meldingen en afzonderlijke ontvangst-/openstatus. Zie [achtergrondmeldingen](achtergrondmeldingen.md).

De releasecontrole vereist daarnaast de exacte volledig groene **main**-workflow met **99 JVM-tests per variant en 61 uitgevoerde UI-tests zonder skip**, geverifieerde GitHub-artifactdigests en ongewijzigde CI-bundelinhoud vóór ondertekening. Lokaal gecompileerde UI-tests en eerdere PR-proeven vervangen dat bewijs niet. Signing, GitHublevering, Play-upload en Google-goedkeuring blijven afzonderlijke aantoonbare stappen.
