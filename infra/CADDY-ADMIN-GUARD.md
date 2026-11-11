# Caddy-adminpoort afschermen voor Dartflow

De bestaande Caddy-adminlistener op `127.0.0.1:2019` was bereikbaar vanuit de zes Dartflow-accounts. Bestandsrechten en sudoers beperken deze HTTP-interface niet. De vaste guard beschermt uitsluitend die zes UID's tegen TCP-poort 2019 op IPv4-loopback `127.0.0.0/8` en IPv6-loopback `::1`. Root, Caddy en alle Milo-accounts blijven buiten de selectie. Overig verkeer en bestaande nftables-tabellen blijven ongewijzigd.

`restrict-caddy-admin.py` leest alleen de niet-geheime accountidentificaties uit de twee root-owned `deploy.json`-bestanden en vergelijkt ze met de huidige passwd-registratie. Het leest geen `public.json`, `runtime.env`, runnercredential of providersecret. Uitvoering vereist root op `dg-nxttrack-01`; stdin bevat geen invoer.

De enige kernelwijziging is de nieuwe tabel `inet dartflow_admin_guard`, met één output-chain op prioriteit -10, policy accept, en twee rejectregels. Het volledige JSON-batch wordt eerst met `nft --check --json --file -` gecontroleerd en daarna in één transactie toegepast. De twee CREATE-opdrachten weigeren een gelijktijdig aangemaakte tabel/chain. Bestaande exact overeenkomende regels zijn idempotent; een afwijkende eigen tabel wordt geweigerd en nooit geflusht of vervangen. Een verwijder- of force-optie bestaat niet.

## Installatie door root na review

Installeer de beoordeelde scriptbytes als `/usr/local/libexec/dartflow-restrict-caddy-admin.py`, root:root 0755, en `dartflow-admin-guard.service.example` als `/etc/systemd/system/dartflow-admin-guard.service`, root:root 0644. Installeer de inhoud van `dartflow-admin-guard.dependencies.conf.example` als root-owned 0644 drop-in `20-admin-guard.conf` onder elk van:

- `/etc/systemd/system/dartflow-staging.service.d/`
- `/etc/systemd/system/dartflow-production.service.d/`
- `/etc/systemd/system/dartflow-actions-staging.service.d/`
- `/etc/systemd/system/dartflow-actions-production.service.d/`

Deze Requires/After-afhankelijkheden voorkomen het starten van apps/runners wanneer de guard bij het opstarten faalt. Alleen Before-ordering zou daarvoor onvoldoende zijn. De guard draait na lokale filesystems en een eventueel geplande `nftables.service`, vóór `network-pre.target` en de vier consumenten. `PrivateNetwork=no` zorgt dat de tabel in de hostnetwerknamespace terechtkomt. De scripts van de tijdelijke buildunits gebruiken eveneens deze hostnamespace; `meta skuid` toetst de echte kernel-UID van hun sockets. Er wordt geen descriptor of privilege aan buildercode doorgegeven.

Controleer de unit met `systemd-analyze verify`, doe `systemctl daemon-reload` en start/enable uitsluitend deze vaste guard. Herstart Milo en Caddy niet. De unit voert na apply onmiddellijk `--verify` uit. Er is geen ExecStop dat regels verwijdert.

```sh
sudo systemctl enable --now dartflow-admin-guard.service
sudo /usr/bin/python3 -I /usr/local/libexec/dartflow-restrict-caddy-admin.py --verify
sudo systemctl is-enabled dartflow-admin-guard.service
sudo systemctl is-active dartflow-admin-guard.service
```

## Bewijs vóór de eerste build

Controleer als elk van de zes Dartflow-UID's met de werkelijke aanvullende groepen een begrensde socket/HEAD-aanvraag op `127.0.0.1:2019/config/`: deze moet nu blokkeren of een reset geven. Controleer als root en als de drie bestaande Milo-accounts dat dezelfde HEAD-aanvraag de bestaande HTTP-respons blijft bereiken; de eerdere respons was 405. Lees geen responsebody en gebruik geen mutatiemethode. Controleer daarnaast beide apppoorten, de eigen NFT-JSON-inhoud en Milo's PID, current-link en publieke release-identiteit. De IPv6-regel wordt eveneens op exactheid gecontroleerd; als Caddy niet op `::1` luistert bewijst een geweigerde IPv6-verbinding op zichzelf geen UID-selectie.

Bewijs dat de unit enabled en active is, de vier Require/After-afhankelijkheden geladen zijn en `--verify` slaagt. Dit toont een geladen persistente configuratie, maar vervangt geen echte rebootcontrole. Plan die laatste afzonderlijk: na herstart moeten guard en consumenten in dezelfde volgorde laden en moeten kernelregels, blokkade voor zes UID's en toegang voor root/Milo opnieuw worden gemeten. Registreer een niet-uitgevoerde reboot als open; claim geen bewezen reboot uitsluitend op grond van `is-enabled`.
