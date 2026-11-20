# DartFlow <versie>

- Status: concept / getest / staging / productie / app geüpload / winkel beschikbaar
- Datum en tijd (UTC):
- Vorige productversie:
- Broncommit en PR:
- Productbron versus eventuele latere test-/docsbron; exacte run en poging per bewijs:
- Web/desktop-versie:
- Android Player: versie, versionCode, pakketnaam
- Oche Live: ongewijzigd of eigen versie/code

## Release in gewone taal

Beschrijf het concrete probleem en wat een speler of beheerder nu kan doen. Benoem een korte voor/na-situatie waar dat helpt.

## Veranderingen sinds de vorige versie

| Onderdeel | Vorige versie | Deze versie |
| --- | --- | --- |
| | | |

## Rechten, gegevens en configuratie

- Nieuwe of gewijzigde serverrechten:
- Database-migraties en behoud van bestaande gegevens:
- Benodigde configuratie en eigenaar; uitsluitend namen, nooit geheime waarden:
- Privacy, lidmaatschap, ingetrokken rechten en cachegeldigheid:
- Eventuele noodzakelijke handelingen voor gebruikers:

## Controlebewijs

| Controle | Exacte commit/poging | Werkelijke uitslag | Bewijs/link |
| --- | --- | --- | --- |
| Typecheck/lint/domeintests | | | |
| Autorisatie/concurrency/database | | | |
| Desktop en mobiele webweergave | | | |
| Aangetroffen runtimefout: oude bron rood, fixbron gericht groen en volledige regressie | | | |
| Mislukte, afgebroken of vervangen CI-pogingen | | | |
| Android JVM, telefoon en gedrag na terugnavigeren | | | |
| Oche Live telefoon/TV-regressie | | | |
| Thema standaard + twee extreme paletten, licht/donker | | | |
| Ondertekende artefacten, hashes, certificaten | | | |

Sla geen tests over om een release groen te krijgen. Vermeld ontbrekend of mislukt bewijs als zodanig. Tel gerichte subsets niet bij een volledige suite op als extra unieke dekking. Een onderbroken ronde of een combinatie van volledige en gerichte herhalingen is geen enkele schone volledige run; bewaar de oorspronkelijke uitkomst en identificeer iedere case/poging.

Leg bij een gevonden race de oorspronkelijke fout, concrete oorzaak en beide broncommits vast. Een geslaagde aparte branchrun maakt een mislukte PR-poging niet geslaagd. Een rode regressiebaseline bewijst het oude defect; de fix vereist eigen groene gerichte en volledige controles en daarna normale CI op de uiteindelijke bron. Onderscheid een echte testfout van een aantoonbare workflowtimeout; een gemeten budgetcorrectie behoudt alle checks.

Vermeld voor beelden hoeveel echte bijlagen zijn bewaard en hoeveel individueel zijn bekeken. Noteer bron, viewport, browser/emulator/fysiek toestel en hashes. Een UI-compile is geen uitgevoerde UI-test. Publieke runtimehealth, provideracceptatie en een store-trackstatus bewijzen geen geauthenticeerde gebruikersflow of fysieke toestelontvangst.

## Uitrol

| Doel | Broncommit | Deploy/build-ID | Configuratie-ID | Gezondheidscontrole | Status/tijd |
| --- | --- | --- | --- | --- | --- |
| Staging web/desktop | | | | | |
| Productie web/desktop | | | | | |
| Android staging | | | | | |
| Android Play intern | | | | | |
| Android Play productie | | | | | |
| Oche Live indien gewijzigd | | | | | |

Noteer bij Play apart: upload, promotie, review en beschikbaarheid. Een API-status `completed` bewijst niet dat een specifieke telefoon de update al heeft ontvangen.

## Redactionele publicatie en communicatie

Technische deployment, redactionele publicatie en communicatie zijn afzonderlijke handelingen. Publiceren in Releasebeheer maakt inhoud zichtbaar; het start geen deploy of campagne. Een afzonderlijk bevestigde verzendactie wordt uitsluitend met eigen bewijs vermeld.

| Handeling | Bronobject/ID en doelgroep | Werkelijke status/tijd | Bewijs |
| --- | --- | --- | --- |
| Redactioneel concept/voorbeeld | Product, kanaal, versie | | |
| Redactionele publicatie | Release-ID, actorverwijzing zonder private gegevens | | |
| Proefverzending | Alleen gekozen proefontvanger; geen campagne | | |
| Bevestigde campagne | Campaign-ID, preview-ID, doelgroep en aantallen | | |
| Kanaaluitkomsten | Inbox/e-mail/push afzonderlijk: queued/provider accepted/received/opened/failed/suppressed voor zover gemeten | | |

Een beheerregel geeft geen toesteltoestemming of extra account-/bronrechten. Behoud persoonlijke voorkeuren en controleer opnieuw vóór aflevering. Noteer herstel binnen dezelfde campagne; een retry is geen nieuwe verzending aan de hele doelgroep. Neem geen tokens, sleutels, supporttekst of private ontvangerlijsten op in bewijs.

## Verificatiegrenzen

Maak onderscheid tussen nog uit te voeren releasehandelingen en niet uitgevoerde verificatie. Bijvoorbeeld: MAIN-gates/deploy/signing/upload/promotie kunnen pending zijn; geauthenticeerde hosted acceptatie en fysieke push zijn niet uitgevoerd tenzij een eigen meetreceipt bestaat. Een toekomstige deployreceipt vult die grenzen niet automatisch in.

## Herstel en resterende punten

Beschrijf de vorige bekende goede broncommit en configuratie, de normale herstelroute en het behoud van nieuwe gegevens. Vermeld gevolgen van terugrollen voor gepubliceerde competities, reserveringen en reeds geaccepteerde uitslagen. Verwijder geen tabellen of uitslagen voor een bronrollback. Noteer open beperkingen en de verantwoordelijke vervolgstap.
