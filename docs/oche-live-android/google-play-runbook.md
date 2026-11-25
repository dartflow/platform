# Oche Live · signing en Google Play

> Status op 18 november 2026: de ondertekende **1.0.1 (1014)** is lokaal gebouwd vanaf `main`-SHA `092c8c1e1cca403fbc29ab0679f7efcfc7bb915a` en staat in de [Android-release](https://github.com/dartflow/platform/releases/tag/android-2026-11-18). Release-lint, **12/12 productie-unit-tests** en **17/17 onafhankelijke controles** zijn geslaagd. De bronboom is identiek aan de groen geteste PR-commit; het [buildbewijs](builds/1.0.1-1014.json) bevat de lokale herkomst en checksums.
>
> De aangeleverde Play Console-beelden tonen **1.0.0 (1009)** onder Productie. Het [eerste buildbewijs van 14 november](builds/1.0.0-1009.json) blijft historisch bewaard. Voor de nieuwe update zijn op verzoek van de eigenaar geen Play-upload, Play-publicatie of Publisher-accountinstellingen uitgevoerd.
>
> De GitHub-omgevingen `play-internal` (branch `main`) en `play-production` (branch `main`, tags `oche-v*`) bestaan. Repositoryvariabelen: `OCHE_JAVA_VERSION=17`, `OCHE_VERSION_CODE_BASE=1000`, `PLAY_PACKAGE_NAME=nl.dartflow.ochelive`, `OCHE_SIGNING_ENABLED=true`, `OCHE_PLAY_ENABLED=false`. De vier `ANDROID_UPLOAD_*`-secrets staan uitsluitend in `play-internal`. Google-authenticatie, track-ID’s en het echte Play-appsigningcertificaat zijn nog niet in GitHub geconfigureerd.
>
> De huidige oplevering omvat lokale signing en distributie via de private GitHub-release. Het bestaande abonnement blijft behouden. De optionele Publisher API-/tagroute vereist aanvullende inrichting en tagbescherming. Staging gebruikt `nl.dartflow.ochelive.staging`.

Dit draaiboek geldt voor de eerste Android-app, **DartFlow Oche Live**. Het bestaande DartFlow-account en de webversie behouden hun eigen deployment. De Android-pipeline maakt één ondertekende Android App Bundle (AAB) voor de gekozen Android-doelapparaten.

## Actuele publicatieroute (25 november 2026)

Een read-only Publisher-controle [45654655146](https://github.com/dartflow/platform/actions/runs/45654655146) bevestigde **1.4.0 (1063)** als `completed` op `internal` en `production`, met het bestaande Oche-appsigningcertificaat `D1:1D:97:4C:3B:F6:B0:1A:97:92:90:D9:C7:F5:D4:63:D7:DB:50:93:78:7C:F2:E6:8B:E5:1E:74:B1:6D:CB:62`. De oudere statusnotities hieronder blijven historische context.

De bestaande Publisher-identiteit is beperkt tot `player-play-release.yml` op `main` in `player-play-production`. De afzonderlijke Oche-environments vallen buiten die trust. De nieuwe expliciete acties `oche-check-access`, `oche-upload-internal` en `oche-promote-production` in die vertrouwde workflow gebruiken uitsluitend `nl.dartflow.ochelive`; het bestaande Player-pad behoudt zijn eigen package, certificaat en controles. Er worden geen Cloudrechten verruimd en geen sleutels toegevoegd. `OCHE_PLAY_ENABLED=false` blijft automatische publicatie blokkeren.

1. Rol eerst de database en webbackend uit. Leg de exacte gezonde productiebron vast als `web_sha`.
2. Start **Oche Live Android CI** op de exacte `main`-bron met `signed_bundle=true`. De lint/build-, **44 JVM-tests per variant** en **24 instrumentatietests per telefoon/TV-target**, zonder skips, moeten slagen vóór signing. De code blijft `1000 + run_number`; 1.5.0 is de nieuwe featureversie. De signingjob bewaart `oche-signed-aab` en `oche-signing-receipt` zonder Play-upload.
3. Maak vanaf die SHA een beschermde, onverplaatsbare `oche-v1.5.0`-tag en een GitHub-release met exact de twee bestanden `app-production-release.aab` en `oche-signing-receipt.json` uit die signingrun. Bescherming tegen tagupdates en verwijderen moet actief blijven. De huidige immutable-ruleset heeft volgens de beheercontrole geen bypass; GitHub redigeert bypassinformatie voor readonly workflowtokens.
4. Start **DartFlow Speler Google Play** op `main` met `action=oche-upload-internal`, de volledige `source_sha`, expliciete `web_sha`, `release_tag`, AAB-`bundle_sha256`, `version_code` en `oche_ci_run_id`. De workflow verifieert dezelfde bron, nieuwste groene CI, alle vier Oche-jobs, de exacte artifact-ID's en ZIP-inhoud, beide releaseassets, de eigen Oche-uploadhandtekening en de beschermde tag. De gezonde web-SHA moet een ancestor van de Androidbron zijn; de productiebackend moet die exacte SHA, layouts v1, werkende database/auth en Oche App Links bevestigen.
5. Gebruik voor productie **dezelfde inputs** met `action=oche-promote-production`. Alleen dezelfde hash en volledig bevestigde interne versie worden naar `production` gepromoveerd. Het bestaande Play-helpergedrag bewaart idempotentie en blokkeert gelijktijdige reviewconflicten. Elke geslaagde actie bewaart een afzonderlijk `oche-publication-receipt`.
6. Controleer de teruggelezen Play-tracks en voer installatie-, pairing-, D-pad- en QR-rooktests uit. Een API-status `completed` is geen bewijs van feitelijke beschikbaarheid op ieder toestel of van fysieke 55-inch-TV-validatie.

## Releaseproces

| Moment | GitHub en Google Play |
|---|---|
| Pull request | Bouw, lint en test op een GitHub-hosted runner. |
| Lokale release na geslaagde CI | Controleer de volledige bronboom tegen de geteste commit, signeer met de bestaande uploadsleutel en verifieer de AAB. Versie 1.0.1 (1014) is zo opgeleverd via GitHub. |
| Handmatige workflow op `main`, `signed_bundle=true` | Bouw, test en signeer; download `oche-signed-aab` en upload handmatig in Play Console. Deze actie gebruikt geen Google-authenticatie en publiceert niets. |
| Geslaagde push op `main`, alleen met `OCHE_PLAY_ENABLED=true` | Optionele automatische upload naar ingestelde interne tracks. Dit staat momenteel uit. |
| Eerste publieke release | Kies de intern geteste AAB in Play Console en rond productiepublicatie af. Google behandelt review en eventuele productievereisten. |
| Beschermde tag `oche-vX.Y.Z` | Promoveer exact de intern geteste `versionCode` naar productie. Een update rolt na de Google-controles standaard uit naar 100%. De runner hergebruikt de bestaande AAB in Play. |
| Optionele gespreide uitrol | Zet `PLAY_ROLLOUT_FRACTION=0.1` voor 10%. Start via **Run workflow** de actie **complete** om uit te rollen naar 100%, of **halt** om de actieve uitrol te stoppen. |

Een geslaagde API-submit betekent dat Google de wijziging heeft ontvangen. Google bepaalt de review en beschikbaarheid. Op een apparaat regelt de Play Store-instelling of de update automatisch wordt geïnstalleerd. [Publicatie beheren](https://support.google.com/googleplay/android-developer/answer/9859654) · [Updates voor gebruikers](https://support.google.com/googleplay/android-developer/answer/9859350)

## 1. Play Console eenmalig voorbereiden

De app en versie 1009 bestaan al in Play Console. Dit onderdeel blijft een naslag voor de eenmalige inrichting; deze oplevering voert geen Console- of Publisher-inrichting uit.

1. Ga naar [Google Play Console](https://play.google.com/console/) en selecteer het geverifieerde account van de uitgever. Als je een organisatieaccount voor DG Webservices gebruikt, vraagt Google doorgaans om een D-U-N-S-nummer en organisatieverificatie.
2. Kies **Alle apps → App maken**. Gebruik **DartFlow Oche Live**, standaardtaal **Nederlands (Nederland)** en **App**. Kies het publicatie- en distributiemodel in de Console. Stel in Gradle de definitieve `applicationId` vast vóór de eerste upload. Bijvoorbeeld `nl.dartflow.ochelive`, mits dit de gekozen en beschikbare pakketnaam is. De latere DartFlow-hoofdapp krijgt een eigen ID en listing.
3. Werk het **Dashboard** af. Vul onder **Winkelvermelding** beschrijving, supportadres, app-icoon, feature graphic en telefoon-/tabletbeelden in. Vul onder **Controleren en verbeteren → Beleid en programma’s → App-content** de gevraagde verklaringen in, waaronder privacybeleid, App-toegang, contentclassificatie en Data safety. Verwijs ook in de app naar de privacyverklaring. Kies landen/regio’s voor distributie.
4. Vul **App-toegang** aan met een herbruikbare demo voor Google-review. Geef een geïsoleerd demoaccount en duidelijke stappen om de schermcode via de webomgeving te koppelen. Zorg dat de reviewer zelfstandig door de flow kan zonder toegang tot de echte mailbox of actieve locaties van de uitgever.
5. Publiceer je ook naar Android TV/Google TV, open dan **Setup → Advanced settings → Form factors → Add release type → Android TV** zodra er een geschikte AAB beschikbaar is. Voeg minimaal één actuele TV-screenshot toe, gebruik de TV-banner en noem Android TV in de winkelbeschrijving. Leg vast of Play de TV-release aan de hoofdtracks koppelt of afzonderlijke tracks gebruikt. Controleer de exacte track-ID’s later met de API.

Per november 2026 geldt voor nieuwe en bijgewerkte telefoon/tablet-apps **target API 36 of hoger**. Voor Android TV geldt **API 34** als ondergrens, dus gebruik voor één gedeelde build **targetSdk 36** en `compileSdk` minimaal 36. Voor TV gelden onder meer `minSdk` maximaal 31, een Leanback-launcher, een 320 × 180-banner, landscape, D-pad-navigatie en ondersteuning voor 32-bit/64-bit en 16 KB-paginagrootte. Controleer ook eventuele native bibliotheken uit dependencies. [Target API](https://support.google.com/googleplay/android-developer/answer/11926878) · [Distributie naar TV](https://developer.android.com/training/tv/publishing/distribute) · [TV-kwaliteit](https://developer.android.com/develop/adaptive-apps/quality-guidelines/tv-app-quality)

Bij persoonlijke ontwikkelaarsaccounts aangemaakt na **13 november 2023** moet de app eerst een gesloten test doorlopen met minimaal **12 testers die 14 dagen onafgebroken zijn aangemeld**. Vraag daarna via het app-dashboard productietoegang aan. Een interne test vervult die voorwaarde niet. Rond ook de verificatie van een fysiek Android-apparaat af als de Play Console die taak toont. [Apparaatverificatie](https://support.google.com/googleplay/android-developer/answer/14316361) · [Identiteitsverificatie](https://support.google.com/googleplay/android-developer/answer/10841920) · [Testvereisten](https://support.google.com/googleplay/android-developer/answer/14151465) · [App voorbereiden op review](https://support.google.com/googleplay/android-developer/answer/9859455) · [Toegang voor reviewers](https://support.google.com/googleplay/android-developer/answer/15748846)

## 2. Uploadsleutel en eerste AAB

Voor DartFlow bestaat sinds 14 november 2026 een uploadkeystore. Gebruik deze voor volgende builds. De sleutel is PKCS12 met RSA-3072 en 10.000 dagen geldigheid. Het publieke **uploadcertificaat** heeft SHA-256 `91:55:1C:31:71:01:D4:D2:57:56:41:8C:FA:AC:93:50:0D:29:9F:66:61:D2:93:B3:6E:B4:A8:7F:67:0F:ED:9B`; dit is nog niet het Play-appsigningcertificaat voor App Links.

Het primaire sleutelbestand staat buiten de checkout in `/home/codex/.local/share/dartflow-signing/oche-upload/oche-upload.p12`. Het wachtwoord staat apart in `/home/codex/.config/dg-webservices/dartflow-oche-signing/upload-store-password`. Beide hebben uitsluitend eigenaarstoegang. De herstelkopie op `dg-nxttrack-01` is alleen toegankelijk voor root: de versleutelde keystore staat in `/var/backups/dg-webservices/dartflow/android-signing/oche-upload-2026-11-14.p12`, het wachtwoord apart in `/etc/dg-webservices/secrets/dartflow-oche-signing/upload-store-password`. De kopie is via SSH overgebracht, op checksum gecontroleerd en met JDK 17 geopend; het geëxporteerde certificaat komt overeen. Sleutels en wachtwoorden worden niet in Git, buildartefacten, logs of chat opgenomen. De eigenaar kan deze via de bestaande beheerverbinding in de eigen wachtwoordmanager en reservekopie opnemen.

Voor een project dat nog geen uploadkeystore heeft, kan op een vertrouwde beheermachine buiten de Git-map het volgende voorbeeld worden gebruikt. `keytool` vraagt om de wachtwoorden.

```bash
umask 077
mkdir -p "$HOME/dartflow-signing"
keytool -genkeypair -v \
  -keystore "$HOME/dartflow-signing/oche-upload.p12" \
  -storetype PKCS12 -alias oche-upload -keyalg RSA -keysize 2048 -validity 10000
```

Gebruik bij PKCS12 hetzelfde wachtwoord voor keystore en private key. Maak een versleutelde reservekopie van de keystore en bewaar de wachtwoorden in de wachtwoordmanager. Gebruik `PKCS12` als store type in Gradle. De release-signingconfig leest het pad uit `ANDROID_UPLOAD_KEYSTORE_PATH` en het alias en de wachtwoorden uit de variabelen uit stap 4. Voer de wachtwoorden lokaal zonder schermweergave in. Bouw vanuit de Android-projectmap met de definitieve versie voor de eerste upload:

```bash
(
  set -euo pipefail
  cd android/oche-live
  export ANDROID_UPLOAD_KEYSTORE_PATH="$HOME/dartflow-signing/oche-upload.p12"
  export ANDROID_UPLOAD_KEY_ALIAS=oche-upload
  read -r -s -p 'Keystorewachtwoord: ' ANDROID_UPLOAD_STORE_PASSWORD
  printf '\n'
  export ANDROID_UPLOAD_STORE_PASSWORD
  export ANDROID_UPLOAD_KEY_PASSWORD="$ANDROID_UPLOAD_STORE_PASSWORD"
  trap 'unset ANDROID_UPLOAD_KEYSTORE_PATH ANDROID_UPLOAD_KEY_ALIAS ANDROID_UPLOAD_STORE_PASSWORD ANDROID_UPLOAD_KEY_PASSWORD' EXIT
  ./gradlew :app:lintProductionRelease :app:testProductionReleaseUnitTest :app:bundleProductionRelease -PocheRequireSigning=true \
    -PocheVersionCode=1 -PocheVersionName=1.0.0
  jarsigner -verify app/build/outputs/bundle/productionRelease/app-production-release.aab
)
```

Configureer de signingvariabelen voor deze eerste lokale build of haal de getekende AAB uit een signing-only GitHub-job die nog niet naar de API pusht. Ga in Play Console naar **Testen en releasen → Testen → Intern testen → Nieuwe release maken**. Activeer **Play App Signing**, laat Google de app-signing key beheren en upload de ondertekende AAB. Voeg testers toe, zet de release door en test via de testerlink. Gebruik bij een gesloten test dezelfde AAB of een hogere versie. Kies bij de eerste publieke release vanuit **Productie → Nieuwe release maken** dezelfde geteste AAB via de appbundlebibliotheek en rond de controle en uitrol af. De eerste release heeft geen percentage-uitrol. [Android-app-signing](https://developer.android.com/studio/publish/app-signing) · [Release voorbereiden](https://support.google.com/googleplay/android-developer/answer/9859348) · [Gespreide updates](https://support.google.com/googleplay/android-developer/answer/6346149)

Noteer na configuratie in **Setup → App integrity → App signing** de SHA-256 van het **App signing key certificate**. Gebruik deze waarde in `https://dartflow.nl/.well-known/assetlinks.json`, met de definitieve `applicationId`. Serveer de JSON via HTTPS zonder redirect. Voeg de verklaring toe aan eventuele bestaande verklaringen voor dezelfde host:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "nl.dartflow.ochelive",
      "sha256_cert_fingerprints": ["VUL-DE-PLAY-APP-SIGNING-SHA256-IN"]
    }
  }
]
```

Beperk de intentfilter in het Android-manifest tot het gekozen schermpad en laat de bevestigingsroute in DartFlow openen. Test daarna op een via Play geïnstalleerde build:

```bash
adb shell pm verify-app-links --re-verify nl.dartflow.ochelive
adb shell pm get-app-links nl.dartflow.ochelive
adb shell am start -a android.intent.action.VIEW \
  -c android.intent.category.BROWSABLE -d 'https://dartflow.nl/oche-live'
```

Vervang pakketnaam en URL door de vastgelegde waarden als die afwijken. Controleer ook op een apparaat zonder de app dat dezelfde link het webscherm opent. [App Links verifiëren](https://developer.android.com/training/app-links/verify-applinks) · [App-signingcertificaat voor App Links](https://developer.android.com/training/app-links/faq)

## 3. Optioneel later: Google Cloud en automatische Play-rechten

De huidige handmatige Console-route slaat dit onderdeel over. Deze instructies zijn uitsluitend een referentie voor een afzonderlijk gekozen uitbreiding met Publisher API-upload.

Gebruik Google Cloud Workload Identity Federation met GitHub OIDC. Zo krijgt elke releasejob tijdelijk een OAuth-token met scope `https://www.googleapis.com/auth/androidpublisher`. De GitHub-runner hoeft dan geen permanente Google-sleutel te bewaren.

Voer onderstaande blokken op een beheerwerkstation uit met `gcloud` en `gh`. Log in met `gcloud auth login` en `gh auth login`. Vervang de project-ID en repo door de echte waarden. Activeer billing indien de Google Cloud-setup daarom vraagt.

```bash
set -euo pipefail
PLAY_GCP_PROJECT='VUL-GCP-PROJECT-ID-IN'
PLAY_GITHUB_REPO='dartflow/platform'
PLAY_GCP_NUMBER="$(gcloud projects describe "$PLAY_GCP_PROJECT" --format='value(projectNumber)')"
PLAY_GITHUB_REPO_ID="$(gh api "repos/$PLAY_GITHUB_REPO" --jq '.id')"
PLAY_GITHUB_OWNER_ID="$(gh api "repos/$PLAY_GITHUB_REPO" --jq '.owner.id')"

gcloud services enable \
  androidpublisher.googleapis.com iam.googleapis.com iamcredentials.googleapis.com \
  sts.googleapis.com cloudresourcemanager.googleapis.com \
  --project="$PLAY_GCP_PROJECT"

for play_stage in internal production; do
  play_sa="oche-play-$play_stage"
  play_pool="oche-play-$play_stage"
  play_env="play-$play_stage"
  if [ "$play_stage" = internal ]; then
    play_workflow='oche-android-ci.yml'
    play_ref="assertion.ref == 'refs/heads/main' && assertion.event_name == 'push'"
  else
    play_workflow='oche-play-production.yml'
    play_ref="((assertion.ref.startsWith('refs/tags/oche-v') && assertion.event_name == 'push') || (assertion.ref == 'refs/heads/main' && assertion.event_name == 'workflow_dispatch'))"
  fi

  gcloud iam service-accounts create "$play_sa" \
    --project="$PLAY_GCP_PROJECT" --display-name="Oche Live Play $play_stage"

  gcloud iam workload-identity-pools create "$play_pool" \
    --project="$PLAY_GCP_PROJECT" --location=global --display-name="Oche Live $play_stage"

  gcloud iam workload-identity-pools providers create-oidc github \
    --project="$PLAY_GCP_PROJECT" --location=global --workload-identity-pool="$play_pool" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.repository_owner_id=assertion.repository_owner_id,attribute.ref=assertion.ref,attribute.event_name=assertion.event_name,attribute.workflow_ref=assertion.workflow_ref" \
    --attribute-condition="assertion.repository_id == '$PLAY_GITHUB_REPO_ID' && assertion.repository_owner_id == '$PLAY_GITHUB_OWNER_ID' && assertion.sub.endsWith(':environment:$play_env') && assertion.workflow_ref == ('$PLAY_GITHUB_REPO/.github/workflows/$play_workflow@' + assertion.ref) && $play_ref"

  play_email="$play_sa@$PLAY_GCP_PROJECT.iam.gserviceaccount.com"
  gcloud iam service-accounts add-iam-policy-binding "$play_email" \
    --project="$PLAY_GCP_PROJECT" --role="roles/iam.workloadIdentityUser" \
    --member="principalSet://iam.googleapis.com/projects/$PLAY_GCP_NUMBER/locations/global/workloadIdentityPools/$play_pool/attribute.repository_id/$PLAY_GITHUB_REPO_ID"

  printf '%s\n' "$play_env" "$play_email" \
    "projects/$PLAY_GCP_NUMBER/locations/global/workloadIdentityPools/$play_pool/providers/github"
done
```

Dit gebruikt twee pools zodat de productie-identiteit niet via de interne pool kan worden aangenomen. De policy gaat uit van de standaard GitHub OIDC-subjectopbouw. Bij een aangepaste OIDC-template moet de voorwaarde overeenkomen met de werkelijk uitgegeven claims. De productiejob mag vanaf een beschermde release-tag of vanaf `main` voor een expliciete rolloutactie werken.

1. In **Play Console → Gebruikers en rechten → Nieuwe gebruikers uitnodigen**, voer het interne serviceaccountadres in. Kies **App-rechten → App toevoegen → DartFlow Oche Live** en geef **Release apps to testing tracks** en **View app information (read-only)**.
2. Herhaal voor het productieaccount. Geef **View app information (read-only)** en **Release to production, exclude devices, and use Play App Signing**. Beperk beide accounts tot Oche Live. Het productieaccount gebruikt alleen leestoegang op de interne track voor validatie van de promotie.
3. Controleer de toegang eerst via de lijst met tracks. Bij fout 401 controleer je authenticatie, scope en tokenverval. Bij 403 controleer je de geactiveerde API en de app-rechten. Bij 404 controleer je ook of de eerste handmatige AAB-upload het pakket heeft geregistreerd.

[Play Developer API instellen](https://developers.google.com/android-publisher/getting_started) · [Play Console-rechten](https://support.google.com/googleplay/android-developer/answer/9844686) · [Google Cloud-federatie voor deploymentpipelines](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines)

### Alternatief met Google JSON-sleutel

Als het Google Cloud-beleid of de GitHub-inrichting WIF onmogelijk maakt en serviceaccountsleutels wel zijn toegestaan, maak dan per omgeving onder **IAM & Admin → Service Accounts → [account] → Keys → Add key → Create new key → JSON** een sleutel. Sla deze alleen op als GitHub-secret `PLAY_SERVICE_ACCOUNT_JSON` in de corresponderende omgeving. Gebruik bij de auth-actie `credentials_json` in plaats van `workload_identity_provider`. De auth-actie vraagt bij het minten van een OAuth-access-token uit een JSON-sleutel om `roles/iam.serviceAccountTokenCreator` voor dat serviceaccount op zichzelf. Gebruik deze extra rol alleen voor de JSON-variant. Verwijder de lokale export na registratie en trek oude sleutels in bij rotatie. [Google GitHub Actions-authenticatie](https://github.com/google-github-actions/auth)

## 4. GitHub Actions inrichten

De workflows zijn aangesloten op de Android-module en GitHub-hosted runners. De Play-app, uploadsleutel en signingsecrets zijn ingericht. Signing kan lokaal na geslaagde CI of via de signing-only workflow. Google-authenticatie en API-tracks zijn alleen nodig voor optionele latere automatisering; daarvoor gelden de bestandsnamen uit deze tabel ook in de Workload Identity-voorwaarden.

| Bestand uit de overdracht | Pad in de repo |
|---|---|
| `voorbeeld/oche-android-ci.yml` | `.github/workflows/oche-android-ci.yml` |
| `voorbeeld/oche-play-production.yml` | `.github/workflows/oche-play-production.yml` |
| `voorbeeld/play_release.py` | `android/oche-live/ci/play_release.py` |

1. De bestaande environments `play-internal` en `play-production` zijn ingericht. `play-internal` accepteert `main`; `play-production` heeft de voorbereide branch/tagselectie voor een eventuele latere API-route. De huidige signing-only route werkt met het bestaande abonnement.
2. Alleen voor optionele automatische productiepromotie: configureer de vereiste branch- en tagbescherming voor `oche-v*`, inclusief beperkt aanmaken en geblokkeerd verplaatsen/verwijderen. Zolang die bescherming niet beschikbaar is, blijft die workflow geblokkeerd. Voor handmatige Console-publicatie wordt deze stap overgeslagen.
3. De actuele signingvariabelen en vier secrets zijn hieronder vastgelegd. Google-authvariabelen, track-ID's en rolloutinstellingen zijn uitsluitend voor de optionele API-route.

| Naam | Opslag | Waarde |
|---|---|---|
| `OCHE_JAVA_VERSION` | Optionele repository variable | JDK voor de gekozen AGP en Gradle. Het voorbeeld gebruikt standaard `17`. |
| `OCHE_VERSION_CODE_BASE` | Repository variable | Positieve offset, bijvoorbeeld `1000` als de eerste handmatige `versionCode` gelijk is aan `1` |
| `PLAY_PACKAGE_NAME` | Repository variable | De definitieve `applicationId` |
| `OCHE_SIGNING_ENABLED` | Repository variable | `true`; de vier signingsecrets zijn ingericht. Handmatig `signed_bundle=true` bouwt zonder Play-upload. |
| `OCHE_PLAY_ENABLED` | Repository variable | `false` voor de huidige handmatige route. Alleen activeren bij afzonderlijk gekozen automatisering met geverifieerde toegang en App Links. |
| `PLAY_APP_SIGNING_SHA256` | Repository variable | Echte publieke SHA-256 uit Play App Signing; moet ook in `config/android-app-links.json` voor productie staan. |
| `PLAY_INTERNAL_TRACKS` | Repository variable | Kommalijst met de geverifieerde interne IDs, bijvoorbeeld `qa` of `qa,tv:qa` |
| `PLAY_PRODUCTION_TRACKS` | Repository variable | Bijvoorbeeld `production` of `production,tv:production` |
| `PLAY_ROLLOUT_FRACTION` | Optionele repository variable | Standaard leeg of `1.0` voor 100% na review. Zet `0.1` voor 10% gespreide uitrol. |
| `PLAY_WIF_PROVIDER` | Environment variable | Providerresource uit stap 3, per omgeving |
| `PLAY_SERVICE_ACCOUNT` | Environment variable | Serviceaccountadres uit stap 3, per omgeving |
| `ANDROID_UPLOAD_KEYSTORE_BASE64` | Secret in `play-internal` | Base64 van `oche-upload.p12` |
| `ANDROID_UPLOAD_STORE_PASSWORD` | Secret in `play-internal` | Keystorewachtwoord |
| `ANDROID_UPLOAD_KEY_ALIAS` | Secret in `play-internal` | `oche-upload` uit het voorbeeld |
| `ANDROID_UPLOAD_KEY_PASSWORD` | Secret in `play-internal` | Wachtwoord van de key |
| `PLAY_SERVICE_ACCOUNT_JSON` | Optioneel environment secret | Alleen bij de JSON-variant uit stap 3 |

Op het beheerwerkstation kun je de keystore direct aan het GitHub-secret doorgeven zonder hem naar het scherm te printen:

```bash
base64 < "$HOME/dartflow-signing/oche-upload.p12" | tr -d '\n' | \
  gh secret set ANDROID_UPLOAD_KEYSTORE_BASE64 --repo "$PLAY_GITHUB_REPO" --env play-internal
```

Decodeer in de signingjob naar een tijdelijk bestand onder `RUNNER_TEMP`, met `umask 077` en een cleanuptrap of een afzonderlijke stap met `if: always()`. Laat Gradle het tijdelijke pad lezen uit `ANDROID_UPLOAD_KEYSTORE_PATH`. De AAB en releasegegevens mogen als buildartefact worden bewaard. Houd sleutels en tijdelijke credentialbestanden buiten artefacten, caches en logs.

### Runner

Gebruik standaard `runs-on: ubuntu-24.04`. GitHub start dan per job een beheerde runner. Pin acties op geverifieerde commit-SHA’s, gebruik de Gradle Wrapper en zet versies voor JDK, Android SDK en Gradle vast volgens de repository. Houd de PR-job zonder releasecredentials. Alleen de interne upload en productiepromotie krijgen `id-token: write`.

Wil je dit via een eigen Linux-VPS draaien, gebruik dan een toegewezen machine of geïsoleerde VM voor releasejobs. Open **Settings → Actions → Runners → New self-hosted runner → Linux → x64**. Voer de download- en `./config.sh`-commando’s van GitHub uit onder een eigen Linux-gebruiker zonder sudo-rechten en voeg `--labels dartflow-android-release` toe aan `./config.sh`. Configureer het systemd-proces als beheerder:

```bash
sudo ./svc.sh install dartflow-runner
sudo ./svc.sh start
sudo ./svc.sh status
```

Gebruik `runs-on: [self-hosted, linux, x64, dartflow-android-release]` voor de vertrouwde releasejobs. De GitHub-hosted PR-job blijft afzonderlijk. De VPS-runner heeft uitgaand HTTPS nodig naar GitHub, dependencyrepositories en de Google OAuth/Play-API’s. Een eigen Android-runner is los van de web-VPS-deploy met systemd en Caddy. [GitHub Environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments) · [Runner toevoegen](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners) · [Runner als service](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/configure-the-application) · [GitHub Actions beveiligen](https://docs.github.com/en/actions/reference/security/secure-use)

### OAuth-stap en tracks verifiëren

Onderstaand fragment toont de jobstappen. Vervang de major-tag door de geverifieerde volledige commit-SHA wanneer Codex de workflow in de repository zet. Doe authenticatie na build en tests en direct voor de Play-aanroep.

```yaml
permissions:
  contents: read
  id-token: write

steps:
  # Eerst checkout, build/test of verificatie van de promotiekandidaat.
  - name: Authenticate to Google Play
    id: play-auth
    uses: google-github-actions/auth@v3
    with:
      workload_identity_provider: ${{ vars.PLAY_WIF_PROVIDER }}
      service_account: ${{ vars.PLAY_SERVICE_ACCOUNT }}
      token_format: access_token
      access_token_scopes: https://www.googleapis.com/auth/androidpublisher
      create_credentials_file: false

  - name: Discover configured Play tracks
    env:
      PLAY_ACCESS_TOKEN: ${{ steps.play-auth.outputs.access_token }}
      PLAY_PACKAGE_NAME: ${{ vars.PLAY_PACKAGE_NAME }}
    run: python3 android/oche-live/ci/play_release.py list-tracks --package "$PLAY_PACKAGE_NAME"
```

Gebruik voor deze eerste controle een tijdelijke diagnostische stap in een vertrouwde job op `main`. De aanroep gebruikt het repositorypad uit de tabel in stap 4. De Publisher API retourneert de exacte ID’s. De officiële namen voor aparte TV-tracks zijn `tv:qa` voor intern en `tv:production` voor productie. Configureer alleen de tracks die je in Play Console hebt ingericht en die het script teruggeeft. Als TV dezelfde tracks gebruikt als mobiel, zet ze één keer in de variabelen. [Google auth-actie](https://github.com/google-github-actions/auth) · [Track-ID’s](https://developers.google.com/android-publisher/tracks) · [Tracks opvragen](https://developers.google.com/android-publisher/api-ref/rest/v3/edits.tracks/list)

## 5. Optioneel later: automatische releases bedienen

Dit onderdeel beschrijft de niet-geactiveerde API-/tagroute. Signing kan lokaal of met `signed_bundle=true`; eventuele Play-upload, testrelease en promotie gebeuren handmatig in Play Console. De oplevering van 18 november stopt bij de geverifieerde GitHub-release.

### Dagelijks ontwikkelen

1. Merge een Android-wijziging naar `main` via de normale pull request. De voorbeeldworkflow test de exacte SHA en bouwt en uploadt na iedere geslaagde push naar `main`. Als deze monorepo vaker web-only commits krijgt, laat Codex de releasejob afbakenen op Android en werkelijk gedeelde buildinputs. Laat de PR-controles doorlopen voor de branchbeveiliging. Plaats de productietag op de SHA die intern is uitgebracht.
2. Zorg voor een unieke, oplopende numerieke `versionCode` over de eerste handmatige upload en alle tracks heen. De voorbeeldworkflow gebruikt `OCHE_VERSION_CODE_BASE + github.run_number` in één vaste interne workflow. Kies de offset boven reeds gebruikte codes en geef de uitkomst door als `-PocheVersionCode`. Leg de versie van de Android-app vast in `android/oche-live/version.properties` als `versionName=X.Y.Z`. Gradle ontvangt die als `-PocheVersionName`. Behoud de code bij een rerun van dezelfde build. Voer bij verhuizing of vervanging van het workflownummer de nieuwe offset gecontroleerd door.
3. Bewaar in de interne run een releasebewijs met commit-SHA, package, `versionCode`, `versionName`, SHA-256 van de AAB, de tracks en het GitHub-run-ID. De voorbeeldworkflow bewaart het bewijs 90 dagen. Laat de workflow bij een rerun met een eerder geslaagde upload de bestaande uitkomst verifiëren. Een versionCode mag nooit aan andere AAB-bytes worden gekoppeld.
4. Open de interne testerlink. Test installatie, app-/webkoppeling en scorebord. Kijk bij de Play-release en controleer de betreffende `versionCode`. Een succesvolle upload zegt nog niets over beschikbaarheid.

De via Play intern geteste release-AAB gebruikt de productie-endpoints, zodat exact dezelfde AAB naar productie kan. Gebruik een aangewezen testaccount en testlocatie voor die rooktest. Gebruik voor staging-integratietests een aparte stagingbuild met een eigen `applicationIdSuffix`, staging-URL en gescheiden gegevens en credentials. Die build volgt de stagingdeploy van DartFlow. Alleen de AAB met de definitieve productiepackage-ID gaat naar het Oche Live Play-kanaal voor promotie.

### Een update naar productie

1. Selecteer de SHA van de kandidaat die intern is getest. Controleer dat de kandidaat nog op de afgesproken interne tracks staat en dat het releasebewijs van de succesvolle interne run beschikbaar is. Een nieuwere build kan de vorige kandidaat op de interne track vervangen.
2. Maak de tag vanuit die commit. Gebruik dezelfde versie als `versionName` in het `version.properties`-bestand van de geteste commit. Vervang de voorbeeldwaarden door de echte versie en de geteste volledige SHA:

```bash
PLAY_TESTED_SHA='VUL-GETESTE-COMMIT-SHA-IN'
git fetch origin main --tags &&
  git merge-base --is-ancestor "$PLAY_TESTED_SHA" origin/main &&
  git tag -a oche-v1.2.3 "$PLAY_TESTED_SHA" -m 'Oche Live 1.2.3' &&
  git push origin refs/tags/oche-v1.2.3
```

3. De tagworkflow zoekt de geslaagde pushrun op `main`, controleert commit, versie, track en de AAB-hash, en promoveert dezelfde Play-`versionCode` naar de gekozen productietracks. Na review gaat de update standaard naar 100%. Met `PLAY_ROLLOUT_FRACTION=0.1` gaat hij naar 10%.
4. Controleer in **Actions** de exacte versie en de status die de API retourneert. Volg in **Play Console → Publishing overview** eventuele review en controleer of de update beschikbaar is. Houd **Managed publishing** uit als goedgekeurde wijzigingen automatisch beschikbaar moeten worden. Nieuwe beleidsvereisten, afwijzingen en handmatige publicatiebesluiten blijven zichtbaar in de Console.
5. Controleer Android Vitals en voer een rooktest op telefoon en TV uit. Bij een gespreide uitrol kies je **Actions → [productieworkflow] → Run workflow → main**. Geef de `versionCode` op en kies **complete** voor 100% of **halt** om de actieve uitrol te stoppen. Reeds bijgewerkte installaties blijven op hun versie. Repareer een probleem met een nieuwe AAB en een hoger versienummer. Controleer bij een probleem na een volledige uitrol de beschikbare herstelacties in Play Console.

### Technische werking van de upload

- Laat alle Play-schrijfjobs in dezelfde concurrencygroep `oche-play-release` werken. Gebruik `queue: max` en laat actieve upload- of promotiejobs uitlopen.
- Upload met een verse Play Edit. Bevestig de `versionCode` uit de geüploade bundle, wijzig alleen de bedoelde tracks en commit de edit. Gebruik bij productiepromotie de bestaande bundle in Play.
- Commit met `changesInReviewBehavior=ERROR_IF_IN_REVIEW`, zodat een lopende review doorloopt. Geef `CHANGES_ALREADY_IN_REVIEW` expliciet terug en herhaal na review; verwacht geen automatische publicatie bij `changesNotSentForReview=true`.
- Controleer na een onbekende commit-uitkomst eerst de track en versie in Play. Herhaal de operatie alleen als de huidige toestand daar aanleiding toe geeft.
- Houd een intern bevestigde build, een API-submit, een reviewstatus en feitelijke beschikbaarheid als verschillende statussen bij. De Publisher API geeft review- en beschikbaarheidsstatus terug via `applications.tracks.releases.list`.

[GitHub concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency) · [Play Edits](https://developers.google.com/android-publisher/edits/) · [Edits committen](https://developers.google.com/android-publisher/api-ref/rest/v3/edits/commit) · [Releasestatus opvragen](https://developers.google.com/android-publisher/api-ref/rest/v3/applications.tracks.releases/list)

## Ondertekende AAB bouwen zonder Play-upload

De vier Android-signingsecrets staan in `play-internal`; `OCHE_SIGNING_ENABLED=true` en `OCHE_PLAY_ENABLED=false`. Gebruik de lokale signingroute uit stap 2 na geslaagde CI, of start **Oche Live Android CI** op `main` met `signed_bundle=true`. De workflow test, signeert en bewaart `oche-signed-aab` zonder Play-upload. Versie 1.0.1 (1014) is lokaal gebouwd op exact de geteste bronboom en onafhankelijk geverifieerd; de versiecode komt van main-run 14 (`1000 + 14`).

Neem vervolgens de echte SHA-256 van **Play App Signing** over in `config/android-app-links.json` onder `production` en in de repositoryvariabele `PLAY_APP_SIGNING_SHA256`. Gebruik voor staging uitsluitend het certificaat waarmee de staging-app werkelijk is gesigneerd. De publieke endpoint `/.well-known/assetlinks.json` geeft tot deze configuratie bewust `[]`; er staat geen verzonnen certificaat in. Deploy de certificaatconfiguratie via de bestaande webreleaseflow en controleer de App Links op een via Play geïnstalleerde build.

Behoud `OCHE_PLAY_ENABLED=false`. Play-upload en -publicatie van 1.0.1 (1014) vallen op verzoek van de eigenaar buiten deze oplevering. Alleen bij een latere uitbreiding worden `PLAY_INTERNAL_TRACKS`, `PLAY_PRODUCTION_TRACKS`, `PLAY_WIF_PROVIDER` en `PLAY_SERVICE_ACCOUNT` ingericht. De optionele API-route controleert de publieke v1-backend en de matching package/certificaataankondiging; productiepromotie vereist tagbescherming en hergebruikt de intern geteste AAB.

De CI maakt voor PR's zonder secrets een staging-debug-APK en een **ongesigneerde** production-AAB. Die laatste is alleen een bouwcontrole en kan niet als Play-release worden gebruikt. De debug-APK gebruikt een debugcertificaat, de stagingidentiteit en de stagingbackend.
