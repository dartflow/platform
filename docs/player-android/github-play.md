# DartFlow Speler naar Google Play via GitHub

Deze procedure hoort uitsluitend bij **DartFlow Speler**, pakket
`nl.dartflow.app`. Oche Live heeft een eigen app, uploadcertificaat en releaseflow.
De werkende GitHub Actions-inrichting vraagt geen wijziging van het GitHub-abonnement.
Google-controle, accountverificatie en verplichte Play-formulieren blijven eigenaarstaken.

## Eenmalig in Google Cloud en Play Console

1. Maak of kies een Google Cloud-project. Schakel de **Google Play Android Developer API** in.
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
| `PLAYER_PLAY_ENABLED` | Eerst `false`; pas `true` nadat Cloud, Play-rechten en eerste handmatige upload gereed zijn. |
| `PLAY_WIF_PROVIDER` | Resourcepad van de nieuw ingerichte GitHub WIF-provider. |
| `PLAY_SERVICE_ACCOUNT` | E-mailadres van het afzonderlijke spelersapp-serviceaccount. |
| `PLAY_APP_SIGNING_SHA256` | Het vastgelegde publieke Play App Signing-certificaat voor `nl.dartflow.app`: `DE:54:EB:62:ED:D3:10:AA:F9:39:0F:47:6D:AF:73:E2:94:13:75:CE:EE:BE:DC:0B:89:D8:8D:E2:D4:EC:3E:F1`. |

De eigenaar levert eerst de gekozen Google Cloud-project-ID aan. Daarna kan de
projectgebonden Cloud Shell-inrichtingsopdracht worden voorbereid. Controleer
vóór uitvoeren de project-ID en de getoonde trustregels; die opdracht bestaat
nog niet zolang het project niet is gekozen.
Een Google Cloud-project hoeft volgens Google niet meer apart aan het Play-
ontwikkelaarsaccount gekoppeld te worden om de Developer API te gebruiken.

## Eerste appbestand en eerste publicatie

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
   `bundle_sha256`. Voor deze versie is de brontag `android-player-0.1.1-2`,
   met assets `app-production-release.aab` en `release-receipt.json`.
   De workflow controleert het receipt en de AAB voordat hij het bestaande
   spelerspakket op de gekozen interne track bijwerkt.
3. Kies na een gecontroleerde interne release `promote-production` om diezelfde
   versie te promoveren. De eerste productiepublicatie blijft een Console-stap;
   de helper vereist een eerder volledig gepubliceerde productierelease.

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
