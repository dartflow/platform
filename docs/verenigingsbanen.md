# Vaste verenigingsbanen

Een vaste baan hoort bij de vereniging. Je hoeft er geen competitie, toernooi, speeldatum of inschrijving voor aan te maken. Iedere baan heeft een blijvende QR-code voor spelers en een afzonderlijk alleen-lezen baanscherm.

## Een baan toevoegen

1. Meld je aan als eigenaar of beheerder van de vereniging.
2. Open **Verenigingen**, kies je vereniging en open **Banen**.
3. Kies **Baan toevoegen**, geef de baan een herkenbare naam en kies de toegang:
   - **Iedereen met een DartFlow-account**: ook bezoekers kunnen spelen, zonder lid te worden van de vereniging.
   - **Alleen verenigingsleden**: alleen actieve leden kunnen spelen.
4. Maak de baan aan. Open **Open alleen-lezen baanscherm** op de monitor of tv bij het dartbord. De QR-code kan ook bij de baan worden opgehangen.

De schermlink toont de naam van de vereniging, de baan en de actuele speelstand. Iedereen met die link kan meekijken. Het scherm verleent geen score-invoer of beheerrechten. De toegang tot spelen blijft afhankelijk van de gekozen baaninstelling.

## Spelen via de QR

1. Scan de QR-code met je telefoon. De code verwijst altijd naar dezelfde fysieke baan.
2. Kies **Registreren of aanmelden** als je nog niet bent ingelogd. Gebruik je eigen account; na het aanmelden keer je terug naar de baan.
3. Op een vrije baan kies je solo, samen op locatie of tegen een tegenstander op afstand.
4. Voor een lokaal duel scant de tweede speler dezelfde baan-QR en sluit aan met een eigen account. Voor een partij op afstand gebruik je de uitnodiging. Beide spelers bevestigen dat ze klaar zijn.
5. Voer scores in op de telefoon. Het gekoppelde baanscherm volgt de actuele partij en blijft de vaste QR tonen.

Een baan kan één actieve opstelling tegelijk hebben. Een toevallige bezoeker krijgt geen schrijfrecht op een lopende partij. Rond de partij of training af om de baan weer beschikbaar te maken. Solo-opstellingen en wachtende lobby's hebben een beperkte geldigheid, zodat een verlaten opstelling de baan niet blijvend bezet houdt.

## Baan beheren

De verenigingsbeheerder kan de naam en toegang wijzigen en de baan tijdelijk blokkeren. Tijdens een actieve partij of training kun je de toegang niet beperken of de baan blokkeren; rond eerst de opstelling af. De QR en schermlink blijven bij dezelfde baan horen wanneer de naam verandert.

Een open baan maakt bezoekers geen clublid en geeft geen toegang tot besloten clubkamers, ledenbeheer of andere evenementen. Voor vaste banen zijn geen nieuwe GitHub-secrets of omgevingsvariabelen nodig.

## Uitrol

De additieve migratie `20261111200631_standalone_club_boards.sql` moet vóór de nieuwe apprelease worden toegepast. De bestaande scoreverwerking, partij-ID's en baanvergrendelingen blijven de bron van waarheid. Interne gegevens voor een vaste baan verschijnen niet als competitie of toernooi in de gebruikersinterface. Readiness vereist naast de bestaande v15-versie ook `club_boards=1`.

De regressiecontroles gebruiken uitsluitend de lokale testdatabase. Echte gebruikersregistratie, een fysieke QR-scan en weergave op de eigen tv blijven aanvullende gebruikscontroles na de technische uitrol.
