# DartFlow Speler naar Google Play via GitHub

Deze procedure hoort uitsluitend bij **DartFlow Speler**, pakket
`nl.dartflow.app`. Oche Live heeft een eigen app, uploadcertificaat en releaseflow.
De werkende GitHub Actions-inrichting vraagt geen wijziging van het GitHub-abonnement.
Google-controle, accountverificatie en verplichte Play-formulieren blijven eigenaarstaken.

## Eenmalig in Google Cloud en Play Console

De eigenaar heeft het project via een Console-screenshot bevestigd:

| Publieke projectidentiteit | Bevestigde waarde |
| --- | --- |
| Projectnaam | **DartFlow** |
| Project-ID | **`dartflow`** |
| Projectnummer | **`955883910359`** |

De eigenaar heeft de Cloud-bootstrap uitgevoerd en de twee publieke outputs
bevestigd. Serviceaccount, pool en provider bestaan; de GitHub-variabelen zijn
ingesteld. De eigenaar bevestigt de appgebonden Play-rechten, het geslaagde
subjectherstel en de eerste AAB-upload. De echte WIF-/Play-toegangsproef is
geslaagd en `PLAYER_PLAY_ENABLED=true`. De eerdere API-controle bevestigde versiecode **2** als
`completed` op de interne én productietrack. De eigenaar heeft die eerste
productierelease ter beoordeling ingediend; goedkeuring en openbare beschikbaarheid
zijn niet bevestigd. De nieuwe **0.1.2 (3)**-release is ondertekend beschikbaar op
GitHub en beide backends zijn uitgerold; de afzonderlijke Play-uitkomst staat hieronder.

1. Projectkeuze en inschakelen van **Google Play Android Developer API** zijn door de eigenaar bevestigd.
2. Maak een afzonderlijk serviceaccount voor de spelersapp. Maak geen downloadbare JSON-sleutel.
3. Richt Workload Identity Federation voor GitHub Actions in. Beperk de trust tot
   repository-ID `1453713803`, eigenaar-ID `355255545`, ref `refs/heads/main`,
   workflowref `dartflow/platform/.github/workflows/player-play-release.yml@refs/heads/main`
   en het GitHub environment `player-play-production`, zodat een naamhergebruik
   geen toegang geeft.
   Alleen deze gefedereerde identiteit krijgt impersonatierecht op dit serviceaccount.
4. Voeg het serviceaccount in Play Console bij **Gebruikers en rechten** toe.
   Geef uitsluitend toegang tot `nl.dartflow.app` en de benodigde lees-, testrelease-
   en productiereleaserechten. Geef geen facturatie-, abonnementen- of Oche Live-rechten.
5. Configureer deze GitHub environment-variabelen voor `player-play-production`.
   Deze workflow hergebruikt een reeds ondertekend releasebestand; hij vraagt
   geen keystoresecrets of JSON-serviceaccountsleutel.

| Variabele | Instelling |
| --- | --- |
| `PLAYER_PLAY_ENABLED` | Actueel **`true`**: Cloud, Play-rechten, eerste handmatige upload en echte API-toegangsproef zijn afgerond. Voor een nieuwe inrichting eerst `false`. |
| `PLAY_WIF_PROVIDER` | Door de eigenaar bevestigd en ingesteld: `projects/955883910359/locations/global/workloadIdentityPools/dartflow-player-play/providers/github-main`. Het subjectherstel hieronder is door de eigenaar als geslaagd bevestigd. |
| `PLAY_SERVICE_ACCOUNT` | Door de eigenaar bevestigd en ingesteld: `dartflow-player-play@dartflow.iam.gserviceaccount.com`. |
| `PLAY_APP_SIGNING_SHA256` | Het vastgelegde publieke Play App Signing-certificaat voor `nl.dartflow.app`: `DE:54:EB:62:ED:D3:10:AA:F9:39:0F:47:6D:AF:73:E2:94:13:75:CE:EE:BE:DC:0B:89:D8:8D:E2:D4:EC:3E:F1`. |

De eigenaar bevestigt de uitvoering van de bootstrap. De latere [echte toegangsproef](https://github.com/dartflow/platform/actions/runs/44326068767) bevestigt de WIF-uitwisseling en Android Publisher API-toegang. De [idempotente interne controle](https://github.com/dartflow/platform/actions/runs/44326658372) bevestigt bovendien dat Google exact de ondertekende AAB-hash bezit, zonder nieuwe upload of trackwijziging.
Controleer vóór herhaling **project-ID dartflow**, **projectnummer 955883910359**
en de trustregels. Het script blijft algemeen bruikbaar met expliciet `--project`;
deze documentatie legt de door de eigenaar bevestigde projectidentiteit vast.
Een Google Cloud-project hoeft volgens Google niet meer apart aan het Play-
ontwikkelaarsaccount gekoppeld te worden om de Developer API te gebruiken.

### Cloud Shell-bootstrap — eerst alleen controleren

Gebruik de gereviewde repositoryversie en selecteer in de eigen Cloud Shell
bewust hetzelfde project als de expliciete `--project`-waarde. Zonder `--apply`
toont het script uitsluitend een lokaal plan en benadert het Google niet:

```sh
bash ops/player-play-cloud-setup.sh --project dartflow
```

Pas na controle van dat plan dezelfde opdracht met `--apply` uitvoeren.
De eigenaar moet hiervoor al de toepasselijke API-, serviceaccount-, pool- en
serviceaccount-IAM-beheerrechten hebben. Het script kent deze niet toe en wijzigt
geen facturatie. Als Google een ontbrekende voorwaarde of organisatiebeperking
meldt, stopt het; de eigenaar beoordeelt die afzonderlijk.

De bootstrap activeert alleen Android Publisher, IAM, IAM Credentials, STS en
Resource Manager en maakt de afzonderlijke resources `dartflow-player-play`
(serviceaccount en pool) en `github-main` (provider). De serviceaccount krijgt
**geen Cloud-projectrollen en geen sleutel**. Alleen de repositorygebonden
principalSet in de eigen pool krijgt `roles/iam.workloadIdentityUser` op deze
serviceaccount. Bestaande afwijkende resources, extra providers, keys,
impersonatiebindings of directe Cloud-projectrollen voor de serviceaccount
blokkeren hergebruik. Een onderbroken of ongewijzigde inrichting kan met dezelfde
opdracht worden herhaald; er worden geen conflicterende resources overschreven.

De exacte trust vereist repository-ID `1453713803`, eigenaar-ID `355255545`,
`ref=refs/heads/main`, `event_name=workflow_dispatch`,
`workflow_ref=dartflow/platform/.github/workflows/player-play-release.yml@refs/heads/main`,
`environment=player-play-production` en
`sub=repo:dartflow@355255545/platform@1453713803:environment:player-play-production`.
De huidige job is **geen herbruikbare workflow**; daarom wordt `workflow_ref`
gecontroleerd. `job_workflow_ref` is daarvoor niet het juiste claim. Aangepaste
GitHub-subjecttemplates passen niet bij deze exacte subjectcontrole en worden
niet stilzwijgend toegestaan. [GitHub OIDC-claims](https://docs.github.com/en/actions/reference/security/oidc)

### Eenmalig herstel van de al aangemaakte provider

De read-only GitHub-controle op 18 november 2026 bevestigt voor deze repository
`use_default=true`, `use_immutable_subject=true` en subjectprefix
`repo:dartflow@355255545/platform@1453713803`. De repository is op 11 november
2026 aangemaakt. De eerdere bootstrap gebruikte de oude subject zonder IDs;
die condition weigert de actuele geldige tokens. GitHub gebruikt voor nieuwe
repositories de [immutable subjectvorm](https://docs.github.com/en/actions/reference/security/oidc#immutable-subject-claims).

Gebruik de gereviewde versie van `ops/player-play-cloud-repair-subject.sh` in
de eigen Cloud Shell, met project `dartflow` geselecteerd. Bekijk eerst het plan:

```sh
bash ops/player-play-cloud-repair-subject.sh --project dartflow
```

Pas na controle van de twee subjectstrings de beperkte repair toe:

```sh
bash ops/player-play-cloud-repair-subject.sh --project dartflow --apply
```

Dit script is uitsluitend voor project `dartflow` met nummer `955883910359` en
de bestaande provider `dartflow-player-play/github-main`. Het valideert eerst de
exacte oorspronkelijke condition, pool, issuer, mapping, naam en beschrijving.
Alleen `attributeCondition` verandert van de bekende oude subject naar de
immutable variant; repository-ID, eigenaar-ID, branch, workflow, environment en
event blijven gelijk. Het maakt geen resources, sleutels of IAM-bindings aan en
activeert geen API's. Afwijkende inrichting stopt vóór wijziging. Bij de juiste
nieuwe condition is herhalen een read-only no-op. Daarna wordt opnieuw gelezen
en gecontroleerd dat alle andere providervelden gelijk zijn gebleven.

De eigenaar heeft de uitvoering van deze gerichte repair met de melding
‘gecontroleerd hersteld’ bevestigd. De worker heeft geen eigen Google Cloud-
beheersessie gebruikt; de echte WIF-/Play-toegangsproef is daarna geslaagd.
De gewone bootstrap accepteert uitsluitend de immutable condition en
overschrijft de oude provider niet automatisch.

Na uitvoering verschijnen alleen de publieke `PLAY_WIF_PROVIDER` en
`PLAY_SERVICE_ACCOUNT` plus de handmatige Play-instructie. Geef deze gebruiker in
**Play Console → Gebruikers en rechten → App-rechten** uitsluitend toegang tot
**nl.dartflow.app** met **App-gegevens bekijken (alleen-lezen)**,
**Apps vrijgeven aan testtracks** en **Releasen naar productie, apparaten uitsluiten
en app-ondertekening van Play gebruiken**. Laat overige app-rechten en alle
accountrechten uit; de productiereleaserol bevat volgens Google ook enkele
onvermijdelijk gebundelde rechten. [Exacte Play-rechten](https://support.google.com/googleplay/android-developer/answer/9844686?hl=nl)

Syntax en tien fake-gcloud-regressies (vijf bootstrap, vijf repair) zijn lokaal gecontroleerd met
`bash -n ops/player-play-cloud-setup.sh`,
`bash -n ops/player-play-cloud-repair-subject.sh` en
`python3 -B tests/player-play-cloud-setup-test.py`. Daarbij is geen echte
Cloud-aanroep, WIF-tokenuitwisseling, API-toegang of Play-publicatie getest.
Voor het providercommando en de beperkte binding zijn de actuele
[OIDC-CLI](https://docs.cloud.google.com/sdk/gcloud/reference/iam/workload-identity-pools/providers/create-oidc)
en [beperkte providerupdate](https://docs.cloud.google.com/sdk/gcloud/reference/iam/workload-identity-pools/providers/update-oidc)
en [serviceaccount-IAM-CLI](https://docs.cloud.google.com/sdk/gcloud/reference/iam/service-accounts/add-iam-policy-binding)
gecontroleerd op 18 november 2026.

## Eerste appbestand en eerste publicatie

De eerste handmatige upload en de eenmalige productie-indiening in Console zijn afgerond. De eigenaar bevestigt dat wijzigingen ter beoordeling zijn ingediend. De [API-controle](https://github.com/dartflow/platform/actions/runs/44328517736) bevestigt versiecode **2**, status **completed**, op productie. Dat is een trackstatus en geen bewijs van Google-goedkeuring of een openbare Store-vermelding. De onderstaande instructies bewaren de eenmalige procedure voor een nieuwe app.

De ingediende [ondertekende release 0.1.1 (2)](https://github.com/dartflow/platform/releases/tag/android-player-0.1.1-2) hoort bij `nl.dartflow.app` en exacte bron `20db906c3c646caba2d9a6e09f0429b20e865564`. Haar `app-production-release.aab` heeft SHA-256 `dc7e549f49ec4eeeeb8b18316a533058af83b053dc4837c342b6a8c010193c84` (26.312.672 bytes). [Bestands- en testbewijs](oplevering.md) en het [Play-invulblad](play-console-0.1.1.md) horen bij deze versie. Deze bestanden blijven bevroren; de update 0.1.2 heeft een eigen tag en hogere versiecode.

Maak de spelersapp in Play Console en upload het **ondertekende productionRelease-
AAB van `nl.dartflow.app`** eerst eenmaal handmatig. Een aangemaakte lege app is
nog niet beschikbaar voor de Publishing API. Gebruik de bestaande spelersupload-
sleutel en Google Play App Signing; de app-signingsleutel en uploadsleutel zijn
verschillende sleutels. Een debug-, staging- of ongetekende bundel is ongeschikt.

Rond de Store-vermelding, privacy, gegevensveiligheid, doelgroep/classificatie,
reviewerstoegang en eventuele toegang tot productie af. De bestaande publisherhelper
vereist ook voor de eerste productiepublicatie een handmatige Console-release.
Daarna kan hij een gecontroleerde interne versie naar productie promoveren.
Een API-commit is geen bewijs dat Google de app al heeft goedgekeurd of beschikbaar gesteld.

### Ondertekende update · 0.1.2 (3)

De compactere spelersinterface hoort bij mainbron
`6694643c74c39699d5e9e0a14de023054eaf71a8` ([PR #10](https://github.com/dartflow/platform/pull/10),
[PR #11](https://github.com/dartflow/platform/pull/11) en [PR #12](https://github.com/dartflow/platform/pull/12)),
versionName **0.1.2** en versionCode **3**. De gepubliceerde tag is
[`android-player-0.1.2-3`](https://github.com/dartflow/platform/releases/tag/android-player-0.1.2-3).
De exacte [web-CI](https://github.com/dartflow/platform/actions/runs/44375702239)
en beide jobs in de [native CI](https://github.com/dartflow/platform/actions/runs/44375702068)
zijn geslaagd: 102 JVM-uitvoeringen en 18 native UI-proeven, zonder fouten of
overgeslagen tests. De gecontroleerde CI-artifacts zijn ondertekend en bevroren.
De AAB heeft SHA-256 `6c8ba503326a493b4db75bba162e0ade79de4dc4b28f3472ed43278782e7b1be`
en is 26.293.611 bytes groot.

Dezelfde applicatiebron draait gezond op
[staging](https://github.com/dartflow/platform/actions/runs/44377944190)
(release `44377944190-1`, config `staging-2026-11-18-play-safety-1`) en
[productie](https://github.com/dartflow/platform/actions/runs/44378566429)
(release `44378566429-1`, config `production-2026-11-18-play-safety-1`). De publieke
preflight voor beide backends, Auth, App Links en juridische pagina's is geslaagd.
De [interne Play-upload 44380265441](https://github.com/dartflow/platform/actions/runs/44380265441)
is geslaagd: de API-edit is gecommit voor versiecode 3 op `internal` en bevestigt
de exacte AAB-hash. De [productiepromotie 44380533558](https://github.com/dartflow/platform/actions/runs/44380533558)
is eveneens geslaagd: de API heeft de edit voor versiecode 3 op `production`
gecommit. De [geslaagde afzonderlijke trackcontrole 44380730912](https://github.com/dartflow/platform/actions/runs/44380730912)
bevestigt op **18 november 2026 om 19:28:06 UTC** dat zowel `internal` als `production`
versiecode **3** met status **`completed`** bevatten. Openbare beschikbaarheid en
Google-goedkeuring zijn niet aangetoond.
Volledige [bestands- en testresultaten](oplevering.md) en het
[samengevoegde uitrolbewijs](../evidence/player-compact-ui-2026-11-18.json) horen bij
deze applicatiebron. Een latere documentatiecommit vervangt die bron niet.

Als bij een volgende release wijzigingen door Google worden beoordeeld en de API
`CHANGES_ALREADY_IN_REVIEW` teruggeeft, stopt de helper, ook als de nieuwe actie alleen de
interne track bijwerkt. Behoud de lopende beoordeling en herhaal pas na afronding;
wijzig `ERROR_IF_IN_REVIEW` niet en laat die queryparameter niet weg. Zonder deze
keuze is het API-standaardgedrag het annuleren en opnieuw indienen van de lopende
review. [Officiële commitsemantiek](https://developers.google.com/android-publisher/api-ref/rest/v3/edits/commit)

## Controles en toekomstige releases

Een ondertekende bundel moet afkomstig zijn van de geteste bron-SHA en het juiste
releaseartifact. Controleer package, versionCode, versie, bestand-SHA-256 en
uploadcertificaat vóór toegang tot Google wordt aangevraagd. Gebruik een steeds
oplopend versionCode; maak geen nieuw bestand onder een reeds gebruikt versionCode.
Verifieer de publicatie daarna ook in **Publicatieoverzicht** en de betreffende track.

De publieke spelerspreflight heeft geen Google-token nodig:

```sh
python3 -B android/player/ci/check_release_readiness.py \
  --sha '<volledige geteste release-SHA>' \
  --fingerprint '<Play App Signing SHA-256 voor nl.dartflow.app>'
```

Hij controleert de exacte gezonde release op staging en productie, het native
spelerscontract, omgevingsgebonden Auth-projecten, productie-App Links en de
openbare pagina's `/privacy`, `/account-verwijderen`, `/communityregels` en
`/voorwaarden`. Hij schrijft niets en benadert geen accounts. Offline regressies:

```sh
python3 -B android/player/ci/test_check_release_readiness.py
python3 -B android/oche-live/ci/test_play_release.py
```

De bestaande `android/oche-live/ci/play_release.py` is voor de Play-API
package-generiek. Gebruik uitsluitend `--package nl.dartflow.app`, de door
`list-tracks` gevonden interne track (`qa` of `internal`) en `production`.
Gebruik nooit `tv:*`-tracks voor de spelersapp en wijzig geen Oche-instellingen.
Het toegangstoken wordt alleen tijdelijk via `PLAY_ACCESS_TOKEN` aan het proces
gegeven met OAuth-scope `https://www.googleapis.com/auth/androidpublisher`.

- `list-tracks` maakt een tijdelijke edit, leest tracks en verwijdert de edit.
- `upload-internal --validate-only` kan de AAB **wel uploaden in een tijdelijke
  edit** en de interne track in die edit wijzigen. Hij valideert en ruimt de edit
  op; hij commit of publiceert niet. Dit is geen uitsluitend leesbare netwerkproef.
- `promote --validate-only` valideert dezelfde beoogde trackwijziging zonder
  commit. De exacte intern geteste versionCode en AAB-hash blijven leidend.
- Zonder `--validate-only` wordt na validatie gecommit met
  `changesInReviewBehavior=ERROR_IF_IN_REVIEW`. Een bestaande Google-review wordt
  dus niet stilzwijgend geannuleerd.

Voer geen gelijktijdige Console- en API-wijzigingen uit: edits kunnen daardoor
ongeldig worden. Controleer na een onzekere commituitkomst eerst de werkelijke
trackstatus vóór een retry. De helper weigert downgrades en onverwachte targeting
of meerdere versiecodes, zodat bestaande configuratie niet ongemerkt verdwijnt.

## Handmatige GitHub-acties

Open **Actions → DartFlow Speler Google Play → Run workflow** op `main`.
De workflow gebruikt het eigen environment `player-play-production` en controleert
dat web-CI en native CI op de exacte bron-SHA zijn geslaagd. Dezelfde gezonde SHA
moet op staging en productie actief zijn.

1. Kies eerst `check-access` om de ingestelde Play-rechten en bestaande tracks
   te controleren. Er wordt geen AAB geüpload of trackrelease gewijzigd.
2. Gebruik `upload-internal` met de bronrelease en de verplichte
   `bundle_sha256`. Voor de 0.1.2 (3)-release is de brontag `android-player-0.1.2-3`,
   met assets `app-production-release.aab` en `release-receipt.json`.
   Gebruik bundelhash `6c8ba503326a493b4db75bba162e0ade79de4dc4b28f3472ed43278782e7b1be`
   uit het bevroren receipt en versiecode `3`.
   De workflow controleert het receipt en de AAB voordat hij het bestaande
   spelerspakket op de gekozen interne track bijwerkt.
3. Kies na een gecontroleerde interne release `promote-production` om diezelfde
   versie te promoveren. De eerste productiepublicatie blijft voor een nieuwe app
   een Console-stap. De helper vereist op de productietrack een bestaande release
   met API-status `completed`; die controle bewijst geen openbare Store-beschikbaarheid.

Gebruik waar aangeboden eerst `validate_only` om de beoogde wijziging zonder
commit te valideren. Daarbij kan de AAB in de tijdelijke edit worden geüpload,
zoals hierboven beschreven. Start pas de echte upload/promotie wanneer de
uitvoer het bedoelde pakket, versiecode, SHA en track bevestigt.

## Officiële bronnen

Gecontroleerd op 18 november 2026:
[Google API-inrichting](https://developers.google.com/android-publisher/getting_started),
[eerste handmatige upload en edits](https://developers.google.com/android-publisher/edits),
[WIF voor deploymentpipelines](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines),
[bundelupload](https://developers.google.com/android-publisher/api-ref/rest/v3/edits.bundles/upload),
[commit en bestaande reviews](https://developers.google.com/android-publisher/api-ref/rest/v3/edits/commit).
