# Deelprompts voor Codex

Gebruik de masterprompt als kader. Geef elke deelprompt het overdrachtspakket, de doelrepo en het al verzamelde bewijs. De doorlopende opdracht eindigt bij daadwerkelijke productie-uitrol.

## A · Bron en doelomgeving vaststellen

> Lees de masterprompt en actuele repo-instructies. Verifieer v15 commit, tree, primaire routes en testbasis. Inventariseer de bestaande app, appversies, CI-checknamen en werkelijke staging- en productiehostcontracten read-only. Vul het omgevingsprofiel met bewijsbronnen en zonder geheimwaarden. Leg per feature uit welke doelcode al werkt, welke prototype-interactie moet worden overgenomen en welke serverfunctionaliteit ontbreekt. Begin aan onafhankelijke wijzigingen in de huidige doelrepo zodra bron en grenzen helder zijn.

## B · Account, clubs en platform

> Sluit aan op bestaande Supabase Auth en maak OTP en Google werkend met server-side sessies. Maak één veilig gekoppeld profiel per auth-identiteit. Bouw club- en platformscopes, rollen, lidmaatschap en navigatie volgens v15. Een ingelogd account kan in meer clubs spelen en kan alleen de toegestane routes en gegevens zien. Bewijs ook negatieve cross-club- en directe-API-tests met twee accounts. Behoud geldige terugkeerlinks uit de vaste QR, deellinks en uitnodigingen.

## C · Scoren, Sprint en speelkamer

> Neem de geteste X01-regels, v15 wedstrijdkamer en Sprint-layout over. Koppel de telefoonconsole en 9:16-scoreprojectie aan dezelfde gezaghebbende wedstrijd. Bouw schrijversovername, update na reconnect, herhaalde commando's, dubbele en late requests, resultaatakkoord en veilige correctie. Lever training, Dartbot, lokaal en online spelen met eigen statistieken en gedeeld beeld voor de online opstelling. Test met twee aparte gebruikerssessies en één onafhankelijke monitor. Toon oude en nieuwe revisie bij een gesimuleerde race zonder geheime of persoonlijke gegevens.

## D · Community, competitie en toernooiregie

> Maak vrienden, blokkades, chat, kamerrollen, clubbeheer en uitdagingen servergestuurd. Bouw evenementdeelname, statuswijzigingen, fixtureplanning, poules en huidige knock-out, check-in, wachtrij, automatische baantoewijzing, offline replay, uitslaggeschil en schermstudio met de huidige v15-vormgeving. Koppel een opgeroepen partij aan Sprint en verwerk haar definitieve uitslag één keer. Test twee gelijktijdige regiesessies en een fout tijdens offline synchronisatie.

## E · Resend, Google en OTP

> Implementeer docs/04 en docs/05 in dezelfde platformbeheeromgeving. Verbind alle 32 catalogusitems aan hun juiste eigenaarschap en triggerpad. Test draft en publish, de aparte echte staging-proefmail, webhookverificatie, providerfout, dedupe en suppressie. Maak Google-configuratie daadwerkelijk schrijfbaar via de Supabase Management API voor precies het runtimeproject. Bewijs Google-login en e-mail-OTP met testaccounts en controleer dat geheime waarden en codes uit client en logs blijven. Laat Danny de SMTP-stap in Supabase doen en lever exacte omgevingsspecifieke velden voor die stap.

## F · Volledige acceptatie, staging en productie

> Loop docs/06 langs en sluit open parity-items. Vergelijk staging met v15 op desktop, mobiel, live 9:16 en casting. Voer migration rehearsal, smoke, rollbackproef en de normale stagingdeploy op exact de CI-SHA uit. Bouw en activeer na acceptatie diezelfde bron-SHA via de bestaande productiejob met de echte productieconfiguratie. Verifieer productie-origin, SHA, health/readiness, gecontroleerde auth en mail, en gedeelde scoreketen. Vul het opleverrapport in en zet per resterende afhankelijkheid eigenaar, laatste waarneming en exacte volgende actie.
