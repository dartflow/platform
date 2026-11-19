# Firebase voor Androidmeldingen configureren

Firebase wordt momenteel via de beschermde serverconfiguratie ingericht. **DartFlow-beheer → Integraties** (`/app/platform/integraties`) heeft hiervoor geen invoervelden. **Android → Meer → Meldingen** biedt toestemming, categorievoorkeuren, toestelregistratie en een testmelding; dat scherm configureert geen Firebaseproject.

## Publieke Androidconfiguratie

Open [Firebase Console](https://console.firebase.google.com/) → project **dartflow** → **Projectinstellingen → Algemeen → Jouw apps**. Selecteer de bestaande Androidregistratie en download `google-services.json`. Controleer de exacte package:

| Omgeving | Androidpackage |
| --- | --- |
| Productie | `nl.dartflow.app` |
| Staging | `nl.dartflow.app.staging` |
| Lokale ontwikkeling | `nl.dartflow.app.dev` |

De publieke SDK-opties zijn `projectId`, `applicationId` (Firebase Android-app-ID), `senderId` (projectnummer), `apiKey` en `packageName`. `google-services.json` bevat deze clientconfiguratie en geen serverprivate key. Een bestaand downloadbestand kan als configuratiebijlage worden overgedragen. [Firebaseconfiguratie en identifiers](https://firebase.google.com/docs/projects/learn-more#config-files-objects).

De app ontvangt de passende opties via de geauthenticeerde push-API en initialiseert `FirebaseOptions` na toestemming. De kandidaat heeft geen nieuwe APK nodig om de ontbrekende runtimeopties te ontvangen. De bestaande read-only controle `android/player/ci/firebase_config.py` kan met reeds bevoegde toegang opties ophalen; de laatst vastgelegde HTTP 403 bewijst geen ontbrekende appregistratie.

## Beschermde serverconfiguratie

Een bevoegde VPS-beheerder maakt per omgeving een **nieuwe** configuratiebundel onder `/etc/dg-sites/dartflow-staging/configs/<nieuw-id>/` of `/etc/dg-sites/dartflow-production/configs/<nieuw-id>/`. De directory is root-owned met modus `0700`, `runtime.env` met `0600`. Bestaande gebruikte bundels blijven behouden. Zie [de bestaande configuratiereleaseprocedure](../deployment.md#build-en-immutable-configuratie).

De optionele runtimevelden zijn:

- `DARTFLOW_FIREBASE_ANDROID_CONFIG`: een JSON-array met precies één object met de vijf publieke SDK-velden, project `dartflow` en de exacte package van die serveromgeving. Staging- en productieconfiguraties worden afzonderlijk gecontroleerd.
- `DARTFLOW_FCM_SERVICE_ACCOUNT_JSON`: de bestaande bevoegde Google-serviceaccountcredential voor project `dartflow`, uitsluitend via het beschermde VPS-beheerpad. Vereist `type`, `project_id`, `client_email`, `private_key`; bekende standaard Google-metadata is toegestaan. De bestaande omgevingssleutel `DARTFLOW_INTEGRATIONS_ENCRYPTION_KEY` blijft nodig. Deze servercredential wordt niet als chatbijlage, clientconfiguratie, GitHub-variable, bronbestand of Androidbestand overgedragen.

Beide waarden staan op één fysieke regel, met de volledige JSON tussen enkele quotes. Spaties binnen JSON blijven behouden. PEM-regelovergangen staan als JSON-escape `\n` binnen de credential; er staan geen letterlijke regeleinden in de variabele. Bijvoorbeeld, uitsluitend als **niet-bruikbaar vormvoorbeeld** voor staging:

```text
DARTFLOW_FIREBASE_ANDROID_CONFIG='[{"projectId":"dartflow","applicationId":"<Firebase Android-app-ID>","senderId":"<projectnummer>","apiKey":"<publieke SDK-key>","packageName":"nl.dartflow.app.staging"}]'
```

De broker weigert onbekende velden, dubbele JSON-sleutels, andere projecten/packages, onbegrensde invoer, afwijkende Google-endpoints en ambigue omgevingsquoting. Deze grenscontrole bevestigt vorm en omgeving; werkelijke Google-autorisatie en credentialgeldigheid volgen uit de afzonderlijke transporttest. [FCM-serverautorisatie](https://firebase.google.com/docs/cloud-messaging/send/v1-api).

Vóór activatie moet de beoordeelde helper met deze allowlist op de host staan. Beide gerenderde brokerkopieën, hun entrypoint-digest en sudoers-digest moeten overeenkomen. Alleen een bronwijziging of een extra regel in `runtime.env` installeert die hostgrens niet. Daarna volgt een normale configuratierelease met nieuw toegelaten configuratie-ID; de bestaande bron-, readiness-, staging- en promotiecontroles blijven gelden. Er worden hiervoor geen nieuwe Google-apps, IAM-rechten of sleutels automatisch aangemaakt.

Na activatie: controleer de SDK-configuratie en `transportConfigured` via de eigen geauthenticeerde push-API. Open op het eigen Androidtoestel **Meer → Meldingen**, verleen toestemming en kies **Stuur testmelding naar dit toestel**. FCM-acceptatie, ontvangst door de app en openen blijven afzonderlijke uitkomsten. Zie [het meldingenrunbook](achtergrondmeldingen.md) voor de nog vereiste echte toestelproeven.
