# Pushbackend en verificatie — 19 november 2026

Deze kandidaat gebruikt Firebaseproject **`dartflow`**. De productiepackage is **`nl.dartflow.app`**, staging **`nl.dartflow.app.staging`**, ontwikkeling **`nl.dartflow.app.dev`**. Een Firebase Android-app-ID (`1:…:android:…`) is een ander gegeven dan de package. De werkelijke Android-app-ID's en sender-ID zijn nog niet verkregen: de bestaande read-only configuratiecontrole gaf HTTP 403. Ze worden hier niet verzonnen. Ook de serververzendconfiguratie ontbreekt; er is geen live FCM-bezorgbewijs.

## Bestaande configuratie controleren

1. Laat een reeds bevoegde beheerder in project `dartflow` onder Projectinstellingen de bestaande Androidregistraties controleren voor elk van de drie exacte packages. Gebruik de bestaande read-only `check-firebase-config`-actie; wijzig geen package of bestaande app om een check groen te maken. HTTP 403 vraagt controle van de identiteit, het project en diens bestaande leesrechten; een 403 bewijst niet dat de Androidregistratie ontbreekt.
2. Lees de echte SDK-opties van de bijbehorende registratie. `DARTFLOW_FIREBASE_ANDROID_CONFIG` bevat alleen een array met `projectId`, `applicationId`, `senderId`, `apiKey`, `packageName`. De backend accepteert uitsluitend `projectId: "dartflow"`, een overeenkomende numerieke sender-ID en de package van de eigen omgeving. Deze clientopties zijn geen serverprivate key. [Officiële GET-config](https://firebase.google.com/docs/reference/firebase-management/rest/v1beta1/projects.androidApps/getConfig).
3. Controleer met de bestaande bevoegde serveridentiteit of de FCM HTTP-v1-API voor `dartflow` beschikbaar is en die identiteit berichten mag verzenden. Deze backend verwacht `DARTFLOW_FCM_SERVICE_ACCOUNT_JSON` uitsluitend in de beschermde serverruntime, plus de bestaande 32-byte `DARTFLOW_INTEGRATIONS_ENCRYPTION_KEY`. Maak geen key aan, verruim geen IAM-recht en kopieer geen secret naar Android of de repository om deze controle te omzeilen. Ontbrekende externe configuratie blijft zichtbaar als `configUnavailable`. [Serverautorisatie](https://firebase.google.com/docs/cloud-messaging/send/v1-api).
4. Na deployment van exact de geteste kandidaat: controleer geauthenticeerd `GET /api/player/v1/push`. `sdk` moet voor de eigen package bestaan en `transportConfigured` moet waar zijn. Dit bewijst configuratievalidatie, geen daadwerkelijke FCM-autorisatie of toestelontvangst.
5. Gebruik uitsluitend op een bewust aangemeld eigen toestel de actie `device.test`. Leg vervolgens de afzonderlijke provideracceptatie, clientontvangst en openen vast. Bewaar package, omgeving, bron-SHA, tijden en uitkomsten; nooit FID/token, OAuth-token, serviceaccountkey of privé-inhoud.

## Stabiel protocol

De Androidkandidaat gebruikt stable Firebase Messaging **26.0.2** met `register`/`onRegistered` en een expliciete Firebase Installation ID. De server stuurt **`message.fid`**; de oude `token`-registratie blijft voor oudere clients ondersteund. `fid` en `token` zijn wederzijds uitsluitend. Geen EAP, `AndroidConfigV2` of EAP-callback is nodig voor deze implementatie. [Androidregistratie](https://firebase.google.com/docs/cloud-messaging/android/get-started), [REST Message](https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages).

Nieuw registreren via `POST /api/player/v1/push/actions`:

```json
{"requestId":"<UUID>","action":{"type":"device.register","installationId":"<DartFlow-installatie-UUID>","packageName":"nl.dartflow.app.staging","firebaseInstallationId":"<SDK-FID>","sdkVersion":"26.0.2"}}
```

Alleen de ingelogde eigenaar van de actuele, ingeschakelde en niet verlopen toestelbinding kan testen:

```json
{"requestId":"<UUID>","action":{"type":"device.test","installationId":"<DartFlow-installatie-UUID>","deviceId":"<eigen-binding-UUID>"}}
```

Dezelfde request-ID maakt geen tweede inbox of fan-out. Er zijn maximaal drie nieuwe tests per tien minuten per account en omgeving; één test adresseert uitsluitend de geselecteerde binding. Voorkeuren blijven gelden. De test beantwoordt `queued`, `suppressed` of `configUnavailable`; geen daarvan betekent afgeleverd.

`GET /push` geeft eigen `devices`, `diagnostics`, `enqueueDiagnostics` en `items`. Een diagnose bevat `providerAccepted`, `receivedAt` en `openedAt` afzonderlijk. Ontvangst en openen zijn geauthenticeerde clientmeldingen; een client kan daarmee niet zelfstandig provideracceptatie fabriceren. De server accepteert die acknowledgements pas na een opgeslagen provideracceptatie. De transportbody bevat alleen inbox-ID, binding-ID en categorie. De geauthenticeerde inbox kan na een nieuwe broncontrole de openbare actor tonen; het vergrendelscherm blijft algemeen.

Alleen HTTP 404 **met** het gestructureerde FCM-detail `UNREGISTERED` schakelt een doel uit. Een gewone 404, een fout project, een payloadfout of HTTP 403 is geen bewijs dat het toestel ongeldig is. [Officiële foutcodes](https://firebase.google.com/docs/cloud-messaging/error-codes).

Een SQL-fout bij push-enqueue wordt via een savepoint afgezonderd van de echte sociale/sportactie. De mailbron en een privé herstelmarker blijven behouden. De timer herstelt exact die bron maximaal drie keer, steeds met dezelfde event-ID en inboxdeduplicatie. Na aanhoudende fout stijgt `enqueueDiagnostics.failed`; dat is geen bezorgclaim en geen eindeloze retry. Er is geen netwerkverzoek in de primaire actie.

## Bewijsgrens

De lokale suite gebruikt echte PostgreSQL-transacties en een gesimuleerde HTTP-v1-provider. Zij bewijst encryptie, FID-/legacycompatibiliteit, actuele account-/package-/installatiebinding, replay, voorkeuren, broncontrole, foutclassificatie, begrensde dispatcher, statusscheiding en herstel na een echte SQL-fout. Zij bewijst geen ontvangst op een fysiek toestel, geen FCM-productieautorisatie en geen Play-installatie. Daarvoor blijven de gecontroleerde toestelproeven in het meldingenrunbook vereist.
