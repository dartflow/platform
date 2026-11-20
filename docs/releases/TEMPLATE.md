# DartFlow <versie>

- Status: concept / getest / staging / productie / app geüpload / winkel beschikbaar
- Datum en tijd (UTC):
- Vorige productversie:
- Broncommit en PR:
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
| Android JVM, telefoon en gedrag na terugnavigeren | | | |
| Oche Live telefoon/TV-regressie | | | |
| Thema standaard + twee extreme paletten, licht/donker | | | |
| Ondertekende artefacten, hashes, certificaten | | | |

Sla geen tests over om een release groen te krijgen. Vermeld ontbrekend of mislukt bewijs als zodanig.

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

## Herstel en resterende punten

Beschrijf de vorige bekende goede broncommit en configuratie, de normale herstelroute en het behoud van nieuwe gegevens. Vermeld gevolgen van terugrollen voor gepubliceerde competities, reserveringen en reeds geaccepteerde uitslagen. Verwijder geen tabellen of uitslagen voor een bronrollback. Noteer open beperkingen en de verantwoordelijke vervolgstap.
