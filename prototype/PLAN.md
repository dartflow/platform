# Dartflow — platform, verenigingen en spelers

Dartflow is de overkoepelende organisatie en het gedeelde platform. Elke speler heeft één globale identiteit. Een speler kan tegelijk goedgekeurd lid zijn van meerdere verenigingen. De geselecteerde omgeving bepaalt welke clubactiviteiten en kamers worden getoond; het veranderen van omgeving maakt geen nieuw account.

## Omgevingen

De globale Dartflow-omgeving bevat wereldwijd vrij spelen, spelers van verschillende verenigingen, globale chatkamers en door Dartflow georganiseerde competities en toernooien. Verenigingen hebben een eigen omgeving met leden, rollen, nieuws, oefenwedstrijden, competities, toernooien en kamers. Een clubactiviteit heeft een clubId; een wereldwijde activiteit heeft expliciet clubId:null. Het evenement bepaalt de eigenaar van een partij, ook wanneer die partij via een directe link vanuit een andere context wordt geopend.

Lidmaatschap en evenementdeelname zijn aparte relaties: lid worden geeft niet automatisch deelname aan elke competitie of elk toernooi. Een organisator kan deelnemers van buiten de eigen vereniging toelaten. Oefenwedstrijden kunnen altijd vanuit de globale omgeving tussen verschillende verenigingen worden opgezet. Vriendschappen behoren aan het globale spelersaccount.

## Navigatie

De speler opent **Vandaag** voor een lopende partij, open akkoord of de agenda. **Spelen** bundelt de vrije wedstrijdkamer, training en Baanmodus. **Evenementen** bevat competities, de toernooizaal en geplande speeldagen. Bij een toernooi blijven deelnemers, poules, knock-out, wedstrijden en de toernooikamer bij elkaar. Verenigingen, chatkamers en vrienden staan onder Club & community.

De organisator opent **Overzicht** voor de werkvoorraad, **Evenementen** voor planning en inrichting, **Wedstrijdleiding** voor check-in, borden, schema, Baanmodus en Schermstudio, en **Clubbeheer** voor lidmaatschappen, profielen en meldingen. De omgevingskiezer bepaalt de actieve club of het platform en houdt de huidige rol vast. De mobiele organisatorbalk opent dezelfde werkruimtes als het desktopmenu.

## Speelervaring

Een gedeelde wedstrijdmotor ondersteunt 301/501/701, dubbel uit, best-of en een vast aantal legs met mogelijke gelijkstand. Opstellingen: één gedeeld bord, twee borden op dezelfde locatie, ieder thuis, of club + thuis. Lobby met uitnodigingscode, beeldcontrole, gereedmelding en startkeuze. Wedstrijdkamer met beurtcontrole, scorevalidatie, checkouttips, correctieverzoeken, pauze en herstel, chat en wederzijdse uitslagbevestiging. Alleen bevestigde competitieve resultaten tellen mee voor de competitieve voortgang. Training staat daarvan los.

## Community

Openbare kamers, privékamers, clubkamers en toernooikamers hebben een maximumbezetting. Deelnemers kunnen chatten en een duel voorstellen; de geaccepteerde uitdaging opent de wedstrijdlobby. Host/moderator kan dempen, berichten verwijderen, deelnemers verwijderen, verbannen en rollen beheren. Private clubkamers vereisen club- en kamerlidmaatschap in de demo. Vriendschappen hebben verzoeken, acceptatie en verwijdering. Clubbeheer ondersteunt aanvragen, rollen, ledenlimiet, uitnodigingen, nieuws en clubkamers.

## Werkende demo en simulaties

Baanmodus bewaart scores en uitslagen in gedeelde opslag. Twee telefoons en de 9:16-scorekaart zien dezelfde stand. De actieve schrijver kan scoren en een tweede speler kan de invoer overnemen. De gedeelde historie gebruikt het Baanmodus-demoprofiel.

Clubbeheer, de gewone wedstrijdkamer, chat en het grootste deel van competitie- en toernooiregie gebruiken browserlokale gegevens. Schermstudio gebruikt diezelfde lokale speeldag. Een gekoppelde baanpartij kan over apparaten worden gespeeld. Na akkoord van beide spelers haalt de organisator de uitslag op om de lokale stand bij te werken. De eigen camera en microfoon kunnen lokaal worden getest. Extern beeld, aanwezigheid en voorbeeldtegenstanders zijn simulaties.

## Eerste stagingpilot

1. Eén server-side account voor dashboard, club en Baanmodus. Test dat de speler, clubbeheerder en wedstrijdleider uitsluitend de acties en gegevens van hun rol en omgeving krijgen.
2. Eén gedeelde wedstrijd en uitslag per geplande partij. Dezelfde uitslag bereikt wedstrijdhistorie, competitie of toernooischema precies één keer, ook na een herhaalde aanvraag.
3. Eén clubavond op de stagingomgeving. Test op twee telefoons en een 9:16-scherm de hele keten van inschrijving en bordoproep tot schrijverovername, uitvalherstel, beide bevestigingen en stand. Gebruik afgescheiden testgegevens.
4. Breid de gedeelde infrastructuur daarna uit naar chat, aanwezigheid, schermregie, live beeld en meerdere gelijktijdige speeldagen.

De pilot gebruikt de Royal Oche-identiteit.
