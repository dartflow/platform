# Play Console-gegevenscontrole · Player 0.3.0 (6)

Deze broncontrole betreft kandidaat `nl.dartflow.app` 0.3.0, versiecode 6, op 19 november 2026. De huidige Data safety-antwoorden in Play Console zijn niet ingezien of bevestigd. Dit document wijzigt geen formulier en bewijst geen publicatie of echte FCM-bezorging. De historische [0.2.0-controle](play-console-0.2.0.md) beschrijft de oude SDK/tokenroute en geldt niet als actuele onderbouwing voor deze kandidaat.

## Werkelijke runtimegraaf en API

De lokaal opgeloste `productionReleaseRuntimeClasspath` bevat Firebase Messaging **26.0.2**, Installations **20.0.0**, Installations interop **18.0.0**, firebase-datatransport **21.0.0**, transport-runtime/backend-cct **5.0.0**, Google Play services base/basement **18.9.0** en tasks **18.4.0**. `firebase-measurement-connector:19.0.0` is transitief aanwezig; Firebase Analytics en GMS measurement ontbreken. Ook Ads, Billing, Crashlytics en MLKit ontbreken. WebRTC en ZXing blijven aanwezig. Exacte invoer-, runtimegraaf-, bron- en artefacthashes staan in het [lokale bewijs](../evidence/identity-qr-push-native-local-2026-11-19.json).

Messaging 26.0.2 gebruikt `register()`, `unregister()` en `onRegistered(fid)`. De app schakelt FID-registratie expliciet in. De server verstuurt nieuwe bindingen via HTTP-v1 `message.fid`; oudere 0.2.0-tokenbindingen blijven ondersteund. De apart gedocumenteerde V2-callbacks vereisen een EAP-SDK en zijn niet in deze stabiele AAR aanwezig of toegepast. [Android-referentie](https://firebase.google.com/docs/reference/android/com/google/firebase/messaging/FirebaseMessaging#register()), [HTTP-v1-schema](https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages#Message), [V2/EAP](https://firebase.google.com/docs/cloud-messaging/send/v2-api).

## Gegevens en toestemming

| Stroom | Verwerking in deze kandidaat |
| --- | --- |
| Identiteit | Privé-volledige naam alleen in eigen profiel/accountprocessen; openbare displaynaam en vaste gebruikersnaam in sociale/competitieprojecties. Volledige naam en e-mail worden niet voor vriendenzaken doorzocht. |
| Firebase | Optionele FCM-/Installations-verwerking van installatie-ID, appversie en technische app-/apparaatmetadata. DartFlow-login, spelers-PIN en servercredential worden niet aan de SDK verstrekt. |
| Toestelbinding | FID versleuteld op de server, gebonden aan account, package, omgeving en afzonderlijke DartFlow-installatie-UUID. Geen FID, token of serverenvelop in diagnostiek. |
| Push | Alleen ondoorzichtige inbox-ID, toestel-ID en categorie op de draad. Algemene tekst op het vergrendelscherm, zonder namen, scores of chatinhoud. |
| Openen/inbox | Actuele account- en bronrechten opnieuw controleren; openbare actor/displaynaam pas in de geauthenticeerde inbox. `providerAccepted`, `received` en `opened` zijn verschillende bewijzen; geen gemeten `displayed`-status. |

`POST_NOTIFICATIONS`, de niet-geëxporteerde service en vier Android-kanalen zijn aanwezig. Messaging-auto-init en Analytics-collectie staan standaard uit. Er is geen gebundeld `google-services.json`. Alleen een bewuste opt-in plus passende publieke runtime-SDK-configuratie activeert registratie; op Android 13+ volgt de systeemtoestemming. Weigeren of een kanaal uitzetten laat de inbox bruikbaar. De instellingenknop opent de echte Android-meldingsinstellingen. De testknop vereist een eigen actuele actieve registratie en gebruikt dezelfde outboxroute; een configuratiefout is geen succesvolle aflevering. [Android-toestemming](https://developer.android.com/develop/ui/compose/notifications/notification-permission), [FCM-auto-init](https://firebase.google.com/docs/cloud-messaging/android/get-started#prevent_auto_initialization).

Uitschakelen/uitloggen wist lokale meldingen en binding, schakelt auto-init uit en vraagt `unregister()`. Een ontvangen callback controleert de huidige login en omgeving vóór het tonen van een algemene melding. Accountwissel activeert de oude binding niet opnieuw. Dit is geen bewijs dat Google alle eigen installatiegegevens onmiddellijk wist. De app voegt geen Analytics, BigQuery-bezorgexport of achtergrondcamera/microfoon toe. [Firebase-gegevensverklaring](https://firebase.google.com/docs/android/play-data-disclosure#cloud-messaging), [Installations-gegevensbeheer](https://firebase.google.com/docs/projects/manage-installations).

## Retentie en publicatiegrens

DartFlow-toestelregistraties verlopen na 90 dagen zonder vernieuwing. Inboxgegevens worden 30 dagen na hun vervaltijd opgeruimd, ook zonder FCM-configuratie; accountverwijdering wist de bindingen/enveloppen en uitstaande bezorgingen direct in dezelfde transactie. CSV-importvoorbeelden zijn 30 minuten geldig. De server-DB-proeven voor deze processen staan in de afzonderlijke [backendverificatie](push-backend-verificatie-2026-11-19.md); zij gebruiken een gesimuleerde provider en bewijzen geen Google-bezorging.

De bestaande Google-identiteit kon de werkelijke Android-appconfiguratie en verzendrechten nog niet aantonen (laatst bekende alleen-lezen controle: HTTP 403). Er zijn geen appregistraties, IAM-bindingen, sleutels of Console-antwoorden gewijzigd. Publieke SDK-opties zijn geen servercredential. Echte toestellevering met foreground/achtergrond/koude start, geweigerde toestemming, gewijzigd kanaal, herregistratie, accountwissel, ingetrokken bron en openen na sessieverloop blijft een aparte ingerichte-providerproef.

De bevoegde Consolebeheerder moet de werkelijke appverklaring toetsen aan deze SDK-graaf, doeleinden, optionele verwerking, ontvangers en verwijderprocessen. Privacybeleid, exacte groene main-CI met alle nieuwe UI-proeven zonder skip, signing, GitHub-levering, Play-upload en Google-goedkeuring zijn afzonderlijke stappen. Lokale UI-compilatie is geen toestelproef. [Officiële SDK-gegevensverklaring](https://firebase.google.com/docs/android/play-data-disclosure).
