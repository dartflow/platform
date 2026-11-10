# DG native deploycontract — nog niet geconfigureerd

De lokale app en GitHub-build zijn voorbereid. Er is geen doelhost geïnventariseerd en geen geïnstalleerde `dg-site-deploy`-bron beschikbaar. Daarom voert geen meegeleverde workflow hostmutaties uit. Een bestaande wrappernaam bewijst zijn rechten of argumentcontract niet.

Vul `ops/host-profile.staging.example.json` in vanuit de aangewezen DG-infra-inventory, het masterdocument **Bouw en deploy versie 2** en de werkelijk geïnstalleerde wrapperbron. Neem de echte volledige bronrevisie of checksum op. Sla alleen kluisverwijzingen op. Gebruik dit profiel vervolgens in de bestaande infrastructuurrepository; maak geen tweede algemene rootbeheerlaag in deze applicatie.

De toekomstige adapter heeft precies één geregistreerde staging-site en één toegelaten operatie. De invoer bestaat uit een volledige SHA, numeriek GitHub-run-ID en een beschermde bronreferentie. Een workflowinput wordt nooit een vrije shellopdracht, account-, service-, domein-, poort- of padparameter. De echte wrapperargumenten worden pas na broninspectie toegevoegd. Er is hier bewust geen verzonnen `sudo dg-site-deploy --...`-aanroep.

De adapter moet vóór activatie aantoonbaar aan deze grenzen voldoen:

1. Verifieer repository, vertrouwde ref, volledige SHA en succesvolle `CI` voor diezelfde SHA. Pas de beschermde workflow vanaf de standaardbranch toe. Onbetrouwbare PR-code bereikt de self-hosted runner niet. Controleer runnergroep/scope en labels ook vanuit GitHub; alleen `RUNNER_NAME` is geen identiteitsbewijs.
2. Vergelijk runnernaam, effectieve UID, host-ID, canonieke workspace, omgeving en checkout-SHA met het root-owned hostprofiel. Controleer leesweigering voor siblingsecrets en schrijweigering op root-owned unit/Caddy-configuratie.
3. Verkrijg eerst de hostbrede build-lock en daarna de site-deploylock. Controleer gemeten buildbudget, vrije bytes en inodes. Een schone workspace is geen onveranderbare bron: maak na verificatie een snapshot die de runner niet meer kan verwisselen, en controleer de inhoud opnieuw op de verhoogde grens. Weiger padtraversal, escaping symlinks/hardlinks en ongewenste eigendoms-/moduswijzigingen. Pak een workflowartifact nooit als root rechtstreeks in een actieve of beschermde directory uit.
4. Maak het vereiste herstelpunt en controleer migratie- en backendversie. Voer uitsluitend de vooraf beoordeelde compatibele migratie uit met het aparte beheerpad. De app-role mag geen schemawijzigingen uitvoeren. Een approllback verandert de database of Auth-providerinstellingen niet.
5. Bouw op de dedicated stagingrunner onder het geregistreerde account met `npm ci`, gepinde Node en de staging `NEXT_PUBLIC_*`-waarden. Gebruik het standalone-pakketcontract. Een artifact uit de hosted workflow is bewijs/inspectiemateriaal; de DG-doelomgeving bouwt opnieuw op dezelfde bron-SHA.
6. Draag `DARTFLOW_DATABASE_URL` alleen over via een vooraf beoordeeld secretpad, bijvoorbeeld een beschermde file descriptor of stdin van de vaste broker. Gebruik geen commandoregel, `set -x`, algemene environmentdump of onbeschermd tijdelijk bestand. Root-owned runtimeconfiguratie, units en Caddy worden uitsluitend door de beperkte beheergrens aangepast.
7. Activeer atomair via het bewezen DG-mechanisme. Bewaar huidige en vorige compatibele release; verwijder ze niet bij een mislukte kandidaat. Noteer bron-SHA, run-ID, lockfilehash, toolchain, baseline/wrapperversie en backendmigratie in het releasebewijs.
8. Controleer werkelijk actieve revisie via loopback en extern HTTPS; test database, sessie en de pilotflow apart. Pas na die controles is deploy geslaagd. Registreer een mislukte of gedeeltelijke uitrol als zodanig. Test parallelle jobs, onderbreking, rollback, gecontroleerde reboot en geïsoleerde restore op een acceptatiehost.

Pas hierna mag `.github/workflows/deploy-staging.yml.example` een actieve workflow worden, met de werkelijke runnerlabels, geverifieerde adapter en beschermde GitHub-environment. De huidige template blijft dubbel gesloten: afwijkende bestandsextensie en `if: false`.

De standaard in de overdracht noemt Ubuntu 24.04 x86_64, eigen app-/runneraccounts, native systemd/Caddy en Tailscale-beheer. Dat zijn gewenste conventies; geen van de zeven bestaande DG-hosts is vanuit deze workspace als zodanig geverifieerd.
