# Ingebouwde Player-bediening · 0.3.0

Dit beschrijft de kandidaatbron en de lokale synthetische tests; het is geen bewijs van een doorlopen gehoste wedstrijd of een ontvangen push op een echt toestel.

## Eigen profiel en vrienden

Bij de eerste aanmelding vraagt Begin met spelen om een privé-volledige naam (optioneel), openbare displaynaam, beschikbare gebruikersnaam en de bestaande spelers-PIN waar die nog ontbreekt. De app vraagt vóór vastleggen expliciet bevestiging dat de @gebruikersnaam vast blijft. De server beslist opnieuw over formaat en beschikbaarheid. Een fout of conflicterende claim bewaart de overige invoer en toont feedback.

Meer → Profiel & instellingen toont de volledige naam als privéveld, de displaynaam als openbaar bewerkbaar veld en een vastgelegde gebruikersnaam als tekst. Profiel opslaan verandert geen account-ID of wedstrijd-ID. Help bij gebruikersnaam opent dezelfde gepubliceerde Help/FAQ.

Meer → Vrienden & spelerskamers → Speler zoeken zoekt op displaynaam of @gebruikersnaam. Elke uitslag toont een avatar/initialen, displaynaam en unieke @naam. Meer spelers tonen haalt de volgende serverpagina op; de app doorzoekt geen privé-volledige naam of e-mail. Nieuwe invoer verwerpt nog lopende oude zoekresultaten. Toevoegen gebruikt de bestaande vriendschapsactie.

## Geplande competitie via de baan-QR

Een bestaande baan-QR opent de ingebouwde baanpagina na de eigen aanmelding. Competitiewedstrijd starten? toont de actuele toegankelijke geplande partijen met tegenstander, ronde, regels en blokkadereden. Ja, competitiewedstrijd starten opent een tijdelijke lobby voor precies het gekozen brononderdeel; het wordt geen losse vrije partij. Er wordt geen nieuwe competitie-einddatum ingevoerd.

De eerste speler is met het eigen account bevestigd en diens account bedient de partij. De tweede geplande speler scant en kiest Ik ben de geplande tegenstander met de eigen login, of bevestigt op het eerste toestel met de bestaande @gebruikersnaam en spelers-PIN. Die PIN wisselt de aangemelde account niet. De app noemt expliciet het schrijversaccount; dit is geen exclusief fysiek-toestelslot.

Pas na beide bevestigingen biedt de lobby de startvoorbereiding aan. De bestaande partijpagina houdt de normale acceptatie, bull/startprocedure, beurtrechten en scorebevestiging. Dezelfde canonieke match-ID blijft behouden. Verversen/procesherstel haalt de actuele lobby opnieuw op; annuleren of vervallen geeft de reservering vrij. Een reeds voorbereide partij opent de bestaande matchroute. Niet-ondersteunde meerspelerscomponenten tonen de serverreden en de seizoenroute.

Oche Live 1.2.0 toont tijdens wachten alleen publieke competitienaam, ronde, twee namen met bevestigingsstatus, schrijversnaam en de bestaande baan-QR. De absolute vervaltijd stopt die wachtrijkaart; een echte actuele partij krijgt voorrang.

## Meldingen en teststatus

Meer → Meldingen houdt de bestaande inbox bruikbaar. Systeemmeldingen toestaan op dit toestel volgt een eigen uitleg en Android-toestemming; Nu niet laat de app bruikbaar. Open Android-meldingsinstellingen opent de echte systeeminstellingen. De vier categorievoorkeuren en Android-kanalen kunnen afzonderlijk worden uitgezet.

Stuur testmelding naar dit toestel is alleen bruikbaar na een eigen actuele toestelregistratie. Ververs verzendstatus haalt provideracceptatie, ontvangen en geopend afzonderlijk op. Geen van deze velden is een gemeten zichtbaarheidsgarantie. De app toont ontbrekende Firebase-configuratie; een test met die status geldt niet als bezorgd. Actuele meldingen openen pas na hernieuwde account- en broncontrole. Zie [achtergrondmeldingen](achtergrondmeldingen.md) en [de actuele Play-onderbouwing](play-console-0.3.0.md).
