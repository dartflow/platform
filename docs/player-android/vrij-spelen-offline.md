# Native vrij spel, oefeningen en offline invoer

De kandidaat Player 0.4.0/code7 bedient de canonieke `play`-API rechtstreeks. De bestaande officiële wedstrijd, QR-competitielobby en wedstrijdleiding gebruiken hun eigen canonieke match-UUID. De nieuwe spelvormen gebruiken een vaste play-session-UUID; hervatten, baanwissel en schrijversoverdracht maken geen nieuwe uitslag aan.

De native schermen ondersteunen X01, Cricket, Tactics 3/5, Around the Clock, Dubbelbingo, finishtraining en een historische leguitdaging. Geobserveerde pijlen en eventuele expliciet opgegeven doelwitten blijven afzonderlijke invoer. Een onbekende regelversie of spelvorm blokkeert invoer met een updatebericht. Oche Live 1.3.0/code1017 leest nieuwe sessies uit de openbare `snapshot.play`-projectie en behoudt de bestaande officiële `snapshot.match`-weergave; er is geen terugval naar een verzonnen 501-stand.

## Toegang en herstel

Een accountlogin en een privédeelname zijn afzonderlijke bevoegdheden. Persoonlijke links gebruiken een fragment (`#controller`, `#participant`, `#claim` of `#recovery`); de app stuurt een bevoegdheid uitsluitend in `X-DartFlow-Play-Capability`. Claim vereist bovendien de eigen normale aanmelding. PIN-koppeling verandert de aangemelde accountsessie niet. Oche ontvangt geen claimlinks, tokens, account-ID's of nog verborgen historische worpen.

Capabilities, ontvangen persoonlijke links, snapshots en wachtende invoer staan versleuteld onder Android Keystore; Android-back-up blijft uitgeschakeld. Officiële en bestaande trainingswachtrijen zijn per account en omgeving gescheiden. Een accountwissel mag de wachtende invoer van het vorige account niet overschrijven. De eigen gegevens verdwijnen bij accountverwijdering uit deze lokale binding. De server bepaalt geldigheid en de vastgelegde claim-/hersteltermijn; openen verlengt die termijn niet.

## Offline en onzekere ontvangst

De app toont een expliciet voorlopige lokale stand en het aantal nog te verwerken beurten. In gedeelde bediening kan een geordende reeks toegestane beurten worden opgeslagen. Eigen telefoons en Dartbot wachten na de eigen beurt op de werkelijke serverbevestiging van de andere beurt. Een botbeurt wordt niet lokaal verzonnen.

Elke opgeslagen beurt behoudt verzoek-ID, oorspronkelijke revisie, regels en eventuele schrijverversie. Een batch met onzekere ontvangst behoudt ook zijn oorspronkelijke inhoud. Een mogelijk al verzonden beurt kan niet blind lokaal worden gewist. Als de serverstand al verder is, wordt de opgeslagen reeks niet opnieuw op die nieuwere stand geprojecteerd: invoer pauzeert tot ontvangst of een gemotiveerde conflictbeslissing duidelijk is. Een conflict bewaart de serverlezing en de beschikbare lokale lezing.

Bij nieuwe play-sessies blijft terugnemen van een al geaccepteerde beurt één duurzaam verzoek; daarna wacht nieuwe invoer op verbinding en bevestiging. Officiële gedeelde bediening kan een lokale terugname alleen projecteren met actueel schrijfrecht, `canUndo`, een beschikbare historie en een live, ongepauzeerde bron. Een nieuw set-/bullstartmoment, andere remote beurt of onbekende geschiedenis vraagt eerst de server.

Baanwissel en hervatten gebruiken benoemde kandidaten uit `/play/boards`; de server controleert bezetting en toegang opnieuw bij bevestiging. De app vraagt geen interne baan-UUID aan een gewone gebruiker.

## Statistieken en hulp

De normale statistieknavigatie biedt een aparte ingang voor vrij spel, oefeningen en uitdagingen. `/play/statistics` levert uitsluitend eigen of geclaimde afgeronde sessies, met afzonderlijke groepen per spelvorm, herkomst en vastgelegd regelprofiel. Officiële individuele statistieken behouden hun bestaande definitie. Onbekende pijlen of dubbelpogingen worden als onbekend getoond; AVG en MPR worden alleen voor de relevante spelvorm getoond.

Finishtraining vergelijkt alleen dezelfde `comparisonKey`: target, uitregel, aantal pogingen, beschikbaarheid van routehulp en regelversie. Dit meet niet of routehulp werkelijk werd gebruikt. De handleiding heeft achttien gebundelde Nederlandstalige hoofdstukken en een afzonderlijke openbare cache. De native bundel moet bytegelijk blijven aan `lib/content/manual.nl.json`.

## Controlegrens

Gedeelde enginevoorbeelden staan in `tests/fixtures/play-rules.json`. De native JVM-tests gebruiken deze echte referentievectoren, inclusief openen, bust, ongedaan maken, Tactics-herhaling, teamrotatie en historische vergelijking zonder toekomstige bronworpen te onthullen. De Compose- en Keystore-proeven gebruiken expliciet synthetische emulatorfixtures. Lokale compilatie van hun APK bewijst geen uitvoering, geen hosted gebruikersreis en geen fysieke baan-, camera- of pushbezorging.

Voor aflevering zijn volledige geslaagde CI-runs op exact MAIN, de werkelijke UI-rapporten zonder skips, de gecontroleerde artifactdigests en de releasepreflight vereist. De voorbereide helpers bouwen de app niet opnieuw. Signing, Play-toegang, upload, Firebaseconfiguratie en daadwerkelijke provider-/apparaatontvangst blijven afzonderlijk aantoonbare stappen; dit document claimt die niet.
