# Exacte referentie en eerdere projectafspraken

## Prototype v15

| Gegeven | Waarde |
|---|---|
| Publieke marketinghome | https://puinruimers-darts-demo.dgwebserv.chatgpt.site/ |
| App | https://puinruimers-darts-demo.dgwebserv.chatgpt.site/app |
| Sprint en telefoon | https://puinruimers-darts-demo.dgwebserv.chatgpt.site/app#baan |
| Sites-project | `appgprj_6aeb3b0098948191b155d7ceb4353565` |
| Sites-versie | `15` · `appgprj_6aeb3b0098948191b155d7ceb4353565~appgver_382be9926a2c8191a44a0f0e01c154d3` |
| Publicatie | `appgdep_6af458eb728881919573c03c4b85862a` |
| Git-commit | `e27cccdbd0b6cd2144cc2f26cab9e2986a903e61` |
| Git tree | `11a6c9b02a99b5880971380eca05c4ae29151911` |
| Baseline | 46/46 automatische tests op de exacte v15-checkout. Onafhankelijke score-, overname-, checkout-, mail- en fixturetests. |

De huidige live Sites-versie is op 11 november 2026 bevestigd als v15. Deze publicatie is de ontwerp- en gedragsreferentie voor de ombouw. De release-SHA op de dev-VPS is een aparte commit van de doelapp en krijgt eigen CI- en deploybewijs. Leg de gekoppelde v15-referentie-SHA vast in de doelrepo.

## Bron meenemen naar de dev-VPS

1. Gebruik de losse referentie-export `DartFlow-Sites-v15-bron.tar.gz` naast de overdrachts-ZIP. Controleer de SHA-256 tegen `v15-bronexport.sha256`. De export bevat de gevolgde bronbestanden en tests. Alternatief is de bestaande Sites-broncheckout, in deze werkomgeving `/workspace/sites/dartflow/.sites-checkout`. Open voor een verse export hetzelfde Sites-project met de gekoppelde bronrepository en geautoriseerde toegang. Controleer de commit aan de hand van het bovenstaande versie-ID.
2. Pak de export uit in een aparte referentiemap of check de Git-commit expliciet uit in een aparte werkboom. Lever die map aan Codex naast de doelcheckout via het bestaande beveiligde bestandspad. De bestaande doelapp en repository zijn het implementatiedoel.
3. Verifieer de tree en bestandslijst tegen [v15-git-tree.txt](v15-git-tree.txt). De lijst bevat de Git-blob-ID's van alle bestanden. Een enkel ZIP-bestand met browserpagina's uit de live site is voor de Worker- en testspecificatie onvoldoende.
4. Controleer op de dev-VPS de doelrepo en werkboom, importeer functionele modules en assets gericht en houd `.openai/hosting.json` en de deploymentbundle bij de Sites-referentie. Runtimeconfiguratie en bestaande doeldata blijven onderdeel van de doelapp.

Voorbeeld vanuit de geautoriseerde **Sites-broncheckout**.

```bash
git cat-file -e 'e27cccdbd0b6cd2144cc2f26cab9e2986a903e61^{commit}'
git rev-parse 'e27cccdbd0b6cd2144cc2f26cab9e2986a903e61^{tree}'
git ls-tree -r --full-tree e27cccdbd0b6cd2144cc2f26cab9e2986a903e61
git archive --format=tar.gz --prefix=dartflow-sites-v15/ \
  -o dartflow-sites-v15-reference.tar.gz e27cccdbd0b6cd2144cc2f26cab9e2986a903e61
```

Draai in de geëxporteerde referentie `npm test` en `npm run build` met een Node-versie die `node:sqlite` ondersteunt voor de lokale D1-adapter. `npm run dev` start de demo met lokale SQLite. `node scripts/export-mails.mjs <doelmap>` maakt de 32 voorbeeldmails en catalogus uit dezelfde bron. Geen van deze commando's verzendt mails of deployt naar een omgeving.

## Bestandspad als startpunt

| Onderdeel | Bron in v15 |
|---|---|
| Marketing, anchors, canonical en widget | `public/marketing.html`, `marketing.css`, `marketing.js`, `robots.txt`, `sitemap.xml`, `app-redirect.js`, `worker/index.js` |
| Identiteit en beelden | `public/brand.css`, `assets/dartflow-logo.svg`, `assets/dartflow-icon.svg`, `assets/marketing-hero.webp`, `assets/marketing-venue.webp`, `assets/marketing-share.jpg` binnen `public/` |
| App en dashboards | `public/app.js`, `navigation.js`, `portal.js`, `player-dashboard.js`, `organizer-workspace.js`, `dashboard-hubs.js`, `dashboard-polish.css`, `responsive.css` |
| Scores en spelen | `public/scoring.js`, `rooms.js`, `training.js`, `play.css` |
| Sprint, QR, telefoon en gedeelde Baanmodus | `public/baan*.js`, `public/baan*.css`, `public/sprint.css`, `worker/baan-api.js`, `worker/baan-domain.js`, `drizzle/0000_baanmodus.sql` |
| Competities, clubs en community | `public/competitions.js`, `clubs.js`, `community.js` |
| Toernooi op locatie, offline en cast | `public/venue.js`, `venue-engine.js`, `venue-offline.js`, `venue-cast.js` |
| Mailbeheer | `public/mail-engine.js`, `mail.js`, `mail.css`, `mail-trigger-hooks.js`, `scripts/export-mails.mjs` |

De prototype-README vermeldt een eerdere goudkleurige identiteit. Gebruik de huidige render, stylesheet en transparante logo-assets als ontwerpbron. De prototype-Worker met D1 illustreert de geteste scoretransacties. Gebruik de bestaande doelarchitectuur voor de productieserver en datastore.

## Projectafspraken en leveranciersdocumentatie

De recente gebruikersopdracht breidt de eerdere stagingpilot uit tot volledige featurepariteit en daadwerkelijke productie-uitrol. De oudere documenten geven de bron voor het host- en releasecontract. Controleer hun voorbeelden tegen de ingerichte omgevingen.

- [DartFlow-Codex-Staging-Milo-VPS-2026-11-11.txt](https://chatgpt.com/library?file_id=libfile_fde3_f-ce65fe175ffc8191b27f6e50e4a7dd67_125633b699908191875ab63b547db321&account_id=personal)
- [DG-Webservices-VPS-Standaard-2026-11-04.docx](https://chatgpt.com/library?file_id=libfile_fde3_f-84443835843081918edd93546f4bbb05_125633b699908191875ab63b547db321&account_id=personal)
- [DG-Webservices-VPS-Stappenplan-2026-11-04.txt](https://chatgpt.com/library?file_id=libfile_41b342e156ac81918a251f04c4d0c260&account_id=personal)
- [Dartflow-Codex-Masterprompt-v11.txt](https://chatgpt.com/library?file_id=libfile_fde3_f-b5f940a11fd881919fa1fb3442eb407b_125633b699908191875ab63b547db321&account_id=personal)
- [Dartflow-Mailbeheer-Codex-Masterprompt-v12.txt](https://chatgpt.com/library?file_id=libfile_fde3_f-f6f8374b808c8191bcbcfea0d6ae4087_125633b699908191875ab63b547db321&account_id=personal)

Gebruik de actuele technische referenties aan het eind van de afzonderlijke hoofdstukken. Controleer voor geautomatiseerde Supabase-migraties de vastgezette CLI-versie en het expliciete doelproject. De CLI v3 wijzigde recent het gedrag voor hosted mutaties. [Supabase CLI v3](https://supabase.com/changelog/supabase-cli-v3)
