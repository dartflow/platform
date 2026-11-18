# TURN TLS voor spelersverbindingen

De stagingrelays zijn op 18 november 2026 ingericht voor
`turns:staging.dartflow.nl:3478?transport=tcp`. Na de geslaagde stagingproef is
productie afzonderlijk gepromoveerd en extern gecontroleerd op
`turns:dartflow.nl:3479?transport=tcp`. Het wisselen van de applicatieruntime-URL
gebeurt afzonderlijk in de releaseflow.

## Transport en compatibiliteit

Coturn 4.18.0 maakt met `no-tcp` een TLS-only TCP-listener. De combinatie met
`tls-listening-port=3478` behoudt de bestaande TCP-poort; `listening-port=3478`
blijft daarnaast gewone UDP-clientverbindingen aanbieden voor oudere clients.
`no-tcp-relay` is een andere optie: UDP-relay voor WebRTC blijft beschikbaar.
Geen nieuwe firewallpoort of relayrange is nodig. De bestaande secret, realm,
quota en netwerk-peerbeperkingen blijven behouden.

Dit is gecontroleerd tegen de exact geïnstalleerde upstreambron:

- [Voorbeeldconfiguratie, pinned coturn-commit](https://github.com/coturn/coturn/blob/23c6c1d32a3d2b21a56cee65d3203bcc4ea82d2b/examples/etc/turnserver.conf)
- [Listenerkeuze in netengine.c](https://github.com/coturn/coturn/blob/23c6c1d32a3d2b21a56cee65d3203bcc4ea82d2b/src/apps/relay/netengine.c)
- [TLS-only socket bij no-tcp](https://github.com/coturn/coturn/blob/23c6c1d32a3d2b21a56cee65d3203bcc4ea82d2b/src/apps/relay/tls_listener.c)

Het bewaren van een oude UDP-listener betekent niet dat nieuwe clients die
moeten blijven gebruiken. De applicatieruntime moet afzonderlijk uitsluitend de
bedoelde `turns:`-URL aan nieuwe mediakamers verstrekken. Versleutelde WebRTC-media
en versleuteling van TURN-controlmetadata zijn afzonderlijke controles.

## Provisioning en vernieuwing

De root-helper `infra/provision-turn-tls.py` accepteert uitsluitend de vaste host
`dg-nxttrack-01` en een expliciete omgeving:

```sh
python3 -I /root/reviewed-operator/provision-turn-tls.py --apply staging
python3 -I /usr/local/libexec/dg-turn-tls.py --refresh staging
python3 -I /usr/local/libexec/dg-turn-tls.py --rollback staging
```

Bij `--apply production` gebruikt dezelfde helper de productiehost `dartflow.nl`
en bestaande poort 3479. Pas dit uitsluitend toe als de productiepromotie is
geautoriseerd en de stagingproef is gecontroleerd.

De helper leest het certificaat en de sleutel uit de bestaande vaste
Caddy-certificaatopslag. Hij valideert hostnaam, geldigheid en een overeenkomend
publiek sleutelpaar. Private-keyinhoud en TURN-secrets verschijnen niet in argv,
statusuitvoer of deze documentatie.

Een root-only certificaatgeneratie onder
`/etc/dg-sites/dartflow-<omgeving>/turn-tls/` krijgt modus 0700; beide PEM-bestanden
krijgen 0600. De bestaande DynamicUser-service krijgt ze als afzonderlijke
systemd-credentials. De service krijgt geen toegang tot de Caddy-store of een
vaste sleutel-eigenaars-UID. Eén atomair bijgewerkt drop-in verwijst naar beide
bestanden uit dezelfde complete generatie.

`dg-turn-tls-refresh-<omgeving>.timer` controleert elk uur met maximaal vijf
minuten spreiding. Een ongewijzigd certificaat veroorzaakt geen restart. Een
vernieuwd certificaat wordt gecontroleerd, geïnstalleerd en daarna wordt alleen
de bijbehorende TURN-service herstart. Dat kan bestaande verbindingen in die
omgeving kort onderbreken; clients moeten hun bestaande reconnectpad gebruiken.

Vóór iedere wijziging worden de betrokken configuratie-/unitbestanden onder
`/var/backups/dg-turn-tls/<omgeving>/` beveiligd opgeslagen. Fouten bij toepassen
herstellen de vorige configuratie en starten de oude relay opnieuw. `--rollback`
herstelt de laatst bewaarde configuratie voor die ene omgeving. Bewaar deze
beveiligde backups zolang een rollback nodig kan zijn; ze bevatten de bestaande
TURN-configuratie en mogen niet in een repository of openbaar artifact terechtkomen.

Een beheerder moet mislukte refreshtaken en naderende certificaatverval volgen.
De helper vernieuwt zelf geen ACME-certificaten: Caddy blijft daarvoor verantwoordelijk.

## Acceptance en grenzen van het bewijs

```sh
python3 -B tests/turn-tls-test.py
python3 -B tests/turn-peer-guard-test.py
python3 -B tests/turn-tls-live.py --run-target staging
```

De liveproef draait vanaf de eigen externe worker. De bestaande peer guard blokkeert
bewust same-host TURN-controlverkeer, waardoor een proef vanaf de VPS zelf geen
geschikte publieke acceptatie is. Tijdelijke synthetische vijfminutencredentials
worden intern opgehaald; de statische HMAC-secret verlaat de VPS niet.

Geslaagd op staging: vertrouwde keten en SNI-hostnaam, TLS 1.3, geauthenticeerde
allocatie, bidirectionele relay met een eigen externe peer, normale UDP-allocatie,
afwijzing van private peers en expliciete vrijgave van beide allocaties. Een
plaintext TCP-Allocate ontvangt geen STUN-antwoord; de TLS-only listener kan de
verbinding openhouden tot de handshake-timeout. De proef claimt daarom geen
onmiddellijke TCP-close.

Ook gecontroleerd: actieve hourly timer, root-only sleutelkopieën, ongewijzigde
refresh zonder herstart, peer guard gekoppeld aan de huidige servicecgroup en
ongewijzigde productieconfiguratie én productieproces tijdens de stagingwijziging.
Zie `docs/evidence/player-play-turn-tls-staging-2026-11-18.json` voor de uitslag.
Dezelfde externe proeven zijn daarna geslaagd voor productie; stagingconfig en
stagingproces bleven bij die promotie ongewijzigd. Dat bewijs staat in
`docs/evidence/player-play-turn-tls-production-2026-11-18.json`.
Dit is geen test van twee echte telefoons, camerawisselen of hoorbaar videogeluid.
