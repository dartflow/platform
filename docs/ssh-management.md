# SSH-beheer dg-nxttrack-01

Het algemene beheeraccount `codex-dg-admin` is op 11 november 2026 aangemaakt en met een nieuwe SSH-sessie en `sudo -n id` gecontroleerd. Het account heeft wachtwoordloze sudo voor serverbeheer en gebruikt een eigen Ed25519-sleutel. Applicaties, buildaccounts en release-runners houden hun eigen identiteit.

De sleutel is geldig tot **11 november 2027 om 09:28:54 UTC**, oftewel **10:28:54 Europe/Amsterdam**. `authorized_keys` dwingt dit exacte vervaltijdstip af. Het OS-account vervalt op 12 november 2027, zodat deze controle de geldigheid van één volledig kalenderjaar niet verkort.

Vanaf de huidige Codex-worker:

```sh
ssh -F /home/codex/.ssh/dg-nxttrack-admin.conf dg-nxttrack-01-admin
ssh -F /home/codex/.ssh/dg-nxttrack-admin.conf dg-nxttrack-01-admin 'sudo -n id'
```

De verbinding loopt via Tailscale naar `100.111.66.17`. De SSH-sleutel wordt alleen geaccepteerd vanaf worker `100.79.0.26`. De sleuteloptie `restrict` blokkeert PTY, agent-, poort- en X11-forwarding en user-rc. Commando's kunnen wel via SSH worden uitgevoerd. Hostkeys worden strikt gecontroleerd met de bestaande vermelding `dg-nxttrack-01`.

De privésleutel staat uitsluitend buiten de repository in `/home/codex/.ssh/id_ed25519_dg_nxttrack_admin` met modus `0600`. De SSH-configuratie staat in `/home/codex/.ssh/dg-nxttrack-admin.conf`, eveneens met modus `0600`.

Publieke sleutelfingerprint: `SHA256:1YC2lMIE90hnIpVJCxiY8oXKiDfjQXl2E4G5UPeDiIM`.

Op de VPS staan de toegangssleutel in `/home/codex-dg-admin/.ssh/authorized_keys`, de sudo-regel in `/etc/sudoers.d/codex-dg-admin` en root-beveiligde registratiemetadata in `/etc/codex/ssh-access/codex-dg-admin.json`. Het accountwachtwoord is vergrendeld. De eerdere tijdelijke Dartflow-beheertoegang is voor de lopende inrichting behouden.

Vroegtijdig intrekken kan vanuit een ander beheeraccount door de sleutelregel te verwijderen en de sudo-regel in te trekken. Controleer de resterende sudo-configuratie met `visudo -c`. Verlenging vereist expliciete aanpassing van zowel de sleutelvervaldatum als de OS-accountvervaldatum; er is geen automatische verlenging.

De controle-uitkomsten staan in [general-ssh-admin-2026-11-11.json](evidence/general-ssh-admin-2026-11-11.json). Er staan geen privésleutels of wachtwoorden in dat bewijsbestand.
