# DartFlow — overdracht aan Codex

**11 november 2026 · DG Webservices · referentieprototype v15**

De opdracht is de bestaande DartFlow-app volledig in lijn brengen met het huidige prototype en de hele keten werkend maken op de al ingerichte staging- en productieomgeving. Begin in de bestaande development-checkout. Gebruik de geaccepteerde stagingcommit vervolgens voor een echte productie-uitrol met productieconfiguratie.

## Voor Danny

1. Pak deze ZIP uit naast de development-checkout en geef Codex de map plus [CODEX-MASTERPROMPT.txt](CODEX-MASTERPROMPT.txt). Geef ook de bijgeleverde referentie-export `DartFlow-Sites-v15-bron.tar.gz` of toegang tot de [exacte Sites-broncheckout](bronnen/01-Referentiebron.md).
2. Laat Codex eerst de twee bestaande doelomgevingen invullen in het [omgevingsprofiel](voorbeelden/config/omgevingsprofiel.example.json). De laatste stagingopdracht noemt `/home/codex/repos/dartflow`, `staging.dartflow.nl` en `dg-nxttrack-01`. De huidige repo, hostcontracten en productie-origin volgen uit verificatie op de dev-VPS.
3. Maak voor elk Supabase-project een eigen Google OAuth-webclient en laat Codex de callbackgegevens uit de juiste omgeving tonen. Configureer zelf Resend als custom SMTP in Supabase en test de mailcode op een testaccount.
4. Open **Platformbeheer → Integraties** in DartFlow. Vul bij **Resend** de verzendsleutel, afzender, eventueel antwoordadres en het signing secret van de webhook in. Bij **Google Auth** vul je de Client ID en Client Secret in en start je een echte proeflogin. Beide handelingen voer je per omgeving uit. De app toont de status. Geheime waarden worden na opslaan alleen server-side gebruikt.
5. Laat Codex [het opleverrapport](voorbeelden/opleverrapport.md) invullen met de release-SHA, CI-run, stagingacceptatie, daadwerkelijke productie-uitrol en bewijs van de primaire flows.

## Route door het pakket

| Bestand | Gebruik |
|---|---|
| [CODEX-MASTERPROMPT.txt](CODEX-MASTERPROMPT.txt) | Direct meegeven aan Codex |
| [01 · Prototype en featurepariteit](docs/01-Prototype-en-featurepariteit.md) | Huidige UX, routes, werkende onderdelen en om te bouwen demogedrag |
| [02 · Architectuur en bouwvolgorde](docs/02-Architectuur-en-bouwvolgorde.md) | Datamodel, autorisatie, realtime, voortgang en migraties |
| [03 · Staging, productie en deploy](docs/03-Staging-productie-en-deploy.md) | DG-releasecontract en gecontroleerde promotie van dezelfde SHA |
| [04 · Resend en mailbeheer](docs/04-Resend-en-mailbeheer.md) | Inrichting in DartFlow, templates, wachtrij, afleverstatus en testmails |
| [05 · Google Auth en OTP](docs/05-Google-Auth-en-OTP.md) | Beheer in DartFlow, Supabase-koppeling, callbacks en custom SMTP |
| [06 · Acceptatie en tests](docs/06-Acceptatie-en-tests.md) | Functionele, visuele, multi-device- en releasecontroles |
| [Faseprompts](prompts/FASEPROMPTS.md) | Opdrachten voor afgebakende implementatiestappen |
| [Mailgalerij](voorbeelden/mailcatalogus/index.html) | 32 HTML- en tekstvoorbeelden, triggercatalogus en Supabase OTP-voorbeeld |
| [Provenance en bronnen](bronnen/01-Referentiebron.md) | Exacte Sites-commit, publicatie, broncontrole en eerdere DG-afspraken |

## Wat als bewijs telt

De uitvoering is afgerond zodra de marketinghome, beide dashboards en alle functies uit de featurematrix op de doelapp zijn gebouwd en getest. Een echte lokale of online partij werkt dan tussen twee onafhankelijke accounts en een Sprint-scherm. De invoer kan worden overgenomen en één bevestigde uitslag werkt door in het juiste schema en de juiste historie. Clubs en rollen zijn server-side begrensd. Per omgeving werken Google-login, OTP via Supabase SMTP en een gecontroleerde transactionele Resend-mail. Productie draait de geaccepteerde commit op de eigen omgeving met aantoonbare release-SHA en health/readiness.

Deze ZIP bevat de bouwopdracht, voorbeelden, geverifieerde featurebeschrijving en instructies om de exacte Sites-bron te exporteren. De inlog- en mailkoppelingen en de VPS-releases behoren tot de uitvoering door Codex op de dev-VPS.
