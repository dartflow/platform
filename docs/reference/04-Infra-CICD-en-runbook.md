# 04 Infrastructuur CI CD en runbook

Richt Dartflow in als native Next.js-applicatie op de aangewezen DG Webservices-VPS. Systemd draait de appservice onder een eigen account en Caddy routeert het domein naar een unieke loopbackpoort. GitHub koppelt de geaccepteerde broncommit aan de uitrol. Elke doelomgeving bouwt met haar eigen instellingen.

De huidige Sites-build is de prototypebasis voor productgedrag en UI. De serverimplementatie krijgt een eigen build- en startcontract, met de appdata in de afgesproken Supabase-omgeving. De voorbeeldwaarden tussen hoekhaken moeten vanuit het DG-hostprofiel, de applicatierepository en de bestaande deployinterface worden ingevuld.

## 1 Gegevens die Codex eerst ophaalt

Lees de bijgeleverde **DG Webservices VPS standaard** en **DG Webservices serverdashboard**. Haal ook het DG-masterdocument **Bouw en deploy versie 2**, de actuele infra-inventory en de geïnstalleerde bron van `dg-site-deploy` op uit de aangewezen beheeromgeving. Die bronnen bepalen het daadwerkelijke wrappercontract en de hostinrichting. Leg ontbrekende gegevens vast als **Open** met de verwachte bron of verantwoordelijke. Begin op een bestaande VPS met een alleen-lezen inventarisatie van de bedoelde host en omgeving.

| Nodig | Vastleggen per doelomgeving |
|---|---|
| Doelhost | Stabiele server-ID, providerproject, hostnaam, Hetzner-regio, rol, eigenaar en baselineversie. Voor nieuwe hosts geldt Ubuntu 24.04 LTS en x86_64 als DG-basis. |
| Netwerk | DNS en domeinen, gebruikte IPv4 en IPv6, Tailscale-naam en -tags, beheerbronnen, firewall-ID en vrije loopbackpoort. |
| Project | Werkelijke applicatierepository, toegestane refs, site-ID, GitHub-environment, runnernaam, scope, labels, UID en workspace. |
| Service | App- en runneraccounts, werkelijke appunit, Caddy-configuratie, runtimepad, build- en runtimeconfiguratie. |
| Versies | Versies van Node en package manager, lockfile, gebruikte actions, playbooks, deploywrapper en OS-baseline. |
| Capaciteit | CPU, RAM, vrije bytes en inodes op relevante filesystems, gekoppelde volumes, gemeten buildpiek, releaseretentie en herstelruimte. |
| Backend | Afgesproken Supabase-project per omgeving, bron-SHA en migratieversie, Auth-configuratie, testidentiteiten, uitgaande mailgrenzen en DNS- of providerreferenties. |
| Herstel | RPO, RTO, backuppolicy, laatste herstelproef, onderhoudsvenster, herstelcontact en kluisreferenties. |

Een hostprofiel bevat referenties naar secrets. Bewaar geheimwaarden in de beheerde secretvoorziening en beperk toegang per projectomgeving. Behandel de bestaande zeven VPS’en elk als afzonderlijk geïnventariseerde hosts.

## 2 Native projectgrenzen

De namen in de tabel volgen DG-conventies. `dartflow-staging` en `dartflow-production` illustreren site-ID’s. Bevestig de werkelijk geregistreerde namen voordat je playbooks, units of workflows invult.

| Object | Inrichting volgens DG |
|---|---|
| Menselijk beheer | Persoonlijk SSH-account en persoonlijke key met gecontroleerde sudo voor beheer. |
| `runner_<site>` | Eigen systemd-runnerservice, installatie en workspace onder `/srv/sites/<site>/actions-runner`. Jobs bouwen zonder rootrechten. |
| `app_<site>` | Eigen runtime-account en appunit. Schrijfrechten uitsluitend op de aangewezen eigen data- en cachepaden. |
| Releases | `/srv/sites/<site>/releases`. Elke kandidaat heeft een eigen pad met volledige bron-SHA en run-ID. Bewaar de actieve en vorige compatibele release. |
| Beschermde configuratie | `/etc/dg-sites/<site>` is de voorgestelde DG-locatie. Stem eigendom, rechten en overdracht van build- en runtimeconfiguratie af op de getoetste wrapper. |
| Data en caches | Appdata en relevante caches staan buiten vervangbare releases. Gebruik zo nodig een eigen beheerde pnpm-store. |
| Beheerconfiguratie | Systemd-units en Caddy-configuratie zijn root-owned. Activatie gaat via de gecontroleerde deployinterface. |
| Deploygrens | Valideer site, bron, volledige SHA, run-ID en toegestane acties. Leg bronintegriteit tussen validatie en build vast. Alleen noodzakelijke activatie en servicebediening draaien met verhoogde rechten. |

Toegelaten broncode kan de eigen appsecrets gebruiken. Beperk daarom workflowwijzigingen, deploymentrefs, runnergroepen, de secretsets en bestandsrechten. Verifieer expliciet dat runner en app geen siblinggeheimen kunnen lezen en geen hostbrede beheerrechten krijgen.

## 3 Host en netwerk

Gebruik de bestaande DG-infra-repository als bron voor inventory, bootstrap, Ansible-rollen en acceptatie. Een nieuwe host begint met minimale cloud-init en een beheerkey. Voer Ansible uit vanaf de aangewezen beheercontroller. Test de gewenste toestand op een acceptatiehost en controleer dat een tweede run geen onverklaarde wijzigingen oplevert. Houd secrets uit cloud-init, Git, shellgeschiedenis, logs en Ansible-diffs.

1. Verifieer de serveridentiteit en hostkey via een onafhankelijk beheer- of providerkanaal. Controleer provider-MFA en console- of rescue-toegang. Laat de bestaande beheersessie open tijdens wijzigingen aan toegang.
2. Test een tweede sessie met het persoonlijke beheeraccount. Verifieer vervolgens gewone OpenSSH over Tailscale en het beperkte grantbeleid. Controleer zowel geautoriseerde als onbevoegde identiteiten. Controleer `sshd -t` en de relevante effectieve `sshd -T`-instellingen. Sluit publieke SSH pas wanneer private toegang én hersteltoegang zijn bewezen.
3. Pas Hetzner- en hostfirewall toe op gebruikte IPv4- en IPv6-paden. Open 80 en 443 uitsluitend voor de bedoelde publieke webrol. De Next.js-app luistert op `127.0.0.1:<poort>`. Beperk metrics en beheer tot de aangewezen Tailscale-identiteiten. De deployrunner gebruikt uitgaand HTTPS naar de bedoelde GitHub-diensten.
4. Leg OS-patchbeleid, serviceherstarts, reboot-required, journaldretentie, buildpiek en waarschuwingen voor vrije bytes, inodes, RAM en certificaatverval vast. Test meet- en netwerkgrenzen daadwerkelijk.

Voorbeelden van inventarisatiecommando’s voor de aangewezen host. Filter de uitvoer op het doelproject. Publiceer uitsluitend geschoonde bevindingen.

```bash
hostnamectl
id
df -h
df -i
free -h
ss -ltn
systemctl status --no-pager '<appunit>'
systemctl status --no-pager '<runnerunit>'
stat -c '%U %G %a %n' '/srv/sites/<site>' '/etc/dg-sites/<site>'
```

## 4 Omgevingsconfiguratie

| Naam of categorie | Bron en tijdstip |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | De publieke Supabase-project-URL van de doelomgeving. Aanleveren bij de build van die omgeving. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publiceerbare sleutel van datzelfde project. Aanleveren bij de build. De autorisatie volgt de getoetste Supabase-policies en servercontroles. |
| `DARTFLOW_APP_ORIGIN` | Canonieke HTTPS-origin van de omgeving. Beschermde serverconfiguratie voor onder meer Auth-redirects en gegenereerde links. |
| `SUPABASE_SECRET_KEY` | Uitsluitend toevoegen voor een aantoonbare server-side taak die een verhoogde sleutel vereist. Beperk toegang tot die taak en de bijbehorende omgeving. |
| Google en OTP-mail | Providercredentials in de bijbehorende Supabase Auth-configuratie. De app ontvangt de noodzakelijke publieke projectconfiguratie en eigen canonieke origin. |
| Databasebeheer | Migratie- en backupcredentials in het afzonderlijke beheerpad. Verifieer project-ID en migratieversie vóór iedere wijziging. |
| Release-identiteit | `DARTFLOW_RELEASE_SHA` of een gecontroleerd release-manifest uit de buildketen. Verifieer de volledige actieve SHA in runtime. |
| Host- en runneridentiteit | Site-ID, host-ID, runnernaam, labels, workspace, appunit, poort en limieten uit de infra-inventory. |

Staging en productie gebruiken eigen GitHub-environments, buildconfiguratie, runtimeconfiguratie, Supabase-projecten, Auth-redirects en testgrenzen. Staging gebruikt afgesproken testaccounts en ontvangers. Leg vóór projectacceptatie vast welke OTP-mails werkelijk mogen worden verzonden en welke OAuth-account gebruikt mag worden. Gebruik voor de infrastructuurproef een tijdelijke acceptatiesite zonder echte uitgaande effecten. Bouw beide doelomgevingen op dezelfde bron-SHA met de bedoelde `NEXT_PUBLIC_`-waarden.

## 5 Voorbeeld voor appunit en Caddy

De fragmenten geven het native uitvoercontract weer. Vervang de voorbeeldpaden, accountnamen en parameters door waarden uit de goedgekeurde DG-configuratie. Controleer welk activatiepad de bestaande wrapper beheert. Het voorbeeld met `current` veronderstelt een door de wrapper beheerde actieve verwijzing. Gebruik de werkelijk gepinde Node-binary en kies een `ExecStart` die bij het goedgekeurde Next.js-buildformaat hoort.

```ini
[Unit]
Description=Dartflow <site>
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=app_<site>
Group=app_<site>
WorkingDirectory=/srv/sites/<site>/current
Environment=NODE_ENV=production
EnvironmentFile=/etc/dg-sites/<site>/runtime.env
ExecStart=<absoluut-node-pad> /srv/sites/<site>/current/node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port <loopbackpoort>
Restart=on-failure
NoNewPrivileges=true
PrivateTmp=true
UMask=0027

[Install]
WantedBy=multi-user.target
```

Stem hardening en schrijfbare cachepaden af op de werkelijke appunit. Beoordeel runnerhardening los van die appunit. Bij een gecontroleerd sudo-pad heeft `NoNewPrivileges` op de runner invloed op activatie.

```caddyfile
<app-domein> {
    reverse_proxy 127.0.0.1:<loopbackpoort>
}
```

Valideer het complete Caddy-configuratiebestand binnen het bestaande gecontroleerde beheerpad vóór herladen. Test HTTPS, de bedoelde hostnaam en redirects buiten de doelhost. Controleer dat de publieke route naar de juiste app en revisie gaat. Een geslaagde livenesscheck toont alleen dat het proces reageert. Readiness, database, Auth en de pilotflow krijgen eigen acceptatiebewijs.

## 6 GitHub en deployvolgorde

1. Laat CI op een schone runner de volledige kandidaat-SHA testen. Voer algemene en onbetrouwbare PR-code daar uit. Neem locked install, typecontrole, lint, unit- en domeintests, build en de afgesproken integratietests op.
2. Laat een beschermde stagingworkflow exact de CI-kandidaat op een dedicated stagingrunner bouwen. Gebruik uitsluitend vertrouwde refs. Beperk `GITHUB_TOKEN`-rechten en gebruik gecontroleerde actionversies. Installeer de runner per projectomgeving met een kortlevend registratietoken via de beheercontroller.
3. Verifieer in de job de verwachte runnernaam, labels, host, effectieve gebruiker, workspace, environment en volledige checkout-SHA. Registreer veilige metadata en verwijs vanuit het acceptatierapport naar de CI-run.
4. Gebruik GitHub-concurrency, een hostbrede build-lock en een afzonderlijke deploylock per site. Verkrijg de locks in de gedocumenteerde volgorde en controleer vrije bytes, inodes en resourcebudget vóór backup, migratie en build.
5. Leg de gecontroleerde bron vast in een snapshot of gelijkwaardig mechanisme dat ná validatie tegen workspaceverwisseling beschermt. Bouw met de locked dependencies als onprivileged gebruiker en schrijf het release-manifest met SHA, run-ID, toolchain, baseline- en wrapperrevisie.
6. Maak het vereiste herstelpunt en voer uitsluitend de expliciet toegestane, compatibele migraties voor de bedoelde omgeving uit. Controleer de kandidaat volgens het bestaande wrappercontract en laat de appunit onder haar eigen account starten.
7. Voer loopback- en externe HTTPS-checks uit op de bedoelde revisie. Test relevante readiness en de Dartflow-pilot met afgesproken testaccounts. Leg de werkelijk actieve SHA, data- en Auth-toestand en GitHub-run vast.
8. Bied de geaccepteerde staging-SHA pas na de afgesproken productiepoort aan de dedicated productierunner aan. Productie bouwt opnieuw met de eigen configuratie. Vergelijk de runtime-SHA met de geaccepteerde staging-SHA en voer de productiechecks uit.

Het contract voor `dg-site-deploy` bevat een vooraf toegelaten site-ID, gecontroleerde bron, volledige SHA en run-ID. Neem de echte argumentvolgorde, toegestane acties, locking en bevoegdheden uit de DG-wrapper en leg de versie vast. Houd env-invoer buiten commandoregel en joblogs. Vervang het gecontroleerde pad nooit door willekeurige shellinputs of brede hostrechten.

## 7 Controle na uitrol en herstel

| Controle | Bewijs voor acceptatie |
|---|---|
| Identiteit en rechten | GitHub-job op de bedoelde runner. Verifieer host, UID, labels, omgeving en SHA. Toon geweigerde toegang tot siblingconfig, root-owned config en onverwachte acties. |
| Netwerk en domein | Private beheerlogin vanaf bevoegd apparaat, geweigerde onbevoegde toegang, publieke apppoort en SSH dicht na de bootstrap, juiste HTTPS-route en TLS. |
| Brongegevens en capaciteit | Vastgelegd release-manifest, juiste bron-SHA, locked install, gemeten budget, geslaagde locks en vrijeruimtecontrole. |
| Runtime en projectketen | Loopback en externe HTTPS geven de bedoelde SHA. Bewijs voor database, Auth, uitgaande OTP-mail binnen testscope en de volledige afgesproken spelers- en wedstrijdflow. |
| Onderbreking en parallelle deploy | Tests met twee deployjobs en onderbroken kandidaat. De actieve release en andere sites blijven bruikbaar. |
| Monitoring en herstel | Gescheiden metingen voor host, HTTPS, readiness, revisie, runner en backup. Geïsoleerde restore met gemeten hersteltijd. Een gecontroleerde reboot op de acceptatiehost gevolgd door een nieuwe GitHub-job. |

Bij een mislukte kandidaat houdt de wrapper de actieve release beschikbaar volgens het bewezen herstelmechanisme. Als de nieuwe release al actief is, noteer de fout, actieve SHA en migratietoestand. Kies via de gecontroleerde rollbackactie de vorige release waarvan schema, data en Auth-configuratie compatibel zijn. Controleer de herstelde revisie opnieuw via loopback, HTTPS en een projectflow. Voor een onverenigbare databasewijziging volgt een afzonderlijk herstel- of voorwaarts migratieplan met datadekking en verliesvenster. Een approllback zet de database of Supabase Auth-instellingen niet terug.

Beheer afzonderlijke backups van hostconfiguratie, persistente appdata en de externe database. Verifieer de dekking van gekoppelde volumes. Bewaar decryptie- en herstelmiddelen buiten dezelfde host. Herstel eerst geïsoleerd zonder productiedomeinen en echte uitgaande effecten. Registreer een herstelde runner en Tailscale-node bewust opnieuw. Noteer per controle **Pass**, **Fail**, **Open** of gemotiveerd **N.v.t.**, plus datum, tijdstip en bewijslink. Een geaccepteerde host heeft bewijs voor de verplichte controles.

## 8 Koppeling met het DG serverdashboard

Registreer Dartflow per omgeving in het bestaande DG-overzicht wanneer dat beschikbaar is. Geef het stabiele server-ID, project, site-ID, domein, actieve SHA, run-ID, runner, service, readiness en backup- of runbookreferenties door. Houd providerstatus, meetstatus, app-readiness, release en backup als afzonderlijke signalen. Verouderde of ontbrekende observaties krijgen **Onbekend**.

De blauwdruk betreft een aparte private beheeromgeving. Zij gebruikt in de eerste versie leesintegraties en heeft eigen toegangscontrole met MFA. In de infrastructuurcontext worden gewone OTP- en Google-login dus aangevuld met de afgesproken tweede factor. Dartflow-spelers gebruiken het eigen Auth-contract. Het DG-dashboard bewaart kluisverwijzingen en beheermetadata. Eventuele latere deployacties lopen via de bestaande GitHub-keten met vaste, gecontroleerde invoer en uitvoeringsbewijs.

## Bronnen

- DG Webservices VPS standaard, versie 1, 4 november 2026, hoofdstukken 1 tot en met 9.
- DG Webservices serverdashboard, versie 1, 4 november 2026, hoofdstukken 2 tot en met 6.
- [Next.js Self-Hosting](https://nextjs.org/docs/app/guides/self-hosting)
- [GitHub Actions Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)
- [Caddy reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)
