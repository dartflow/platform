# DartFlow Speler en vaste baanschermen installeren

Gebruik voor de proef `https://staging.dartflow.nl`. Installaties en apparaatkoppelingen op staging horen bij staging; productie gebruikt zijn eigen domein en gegevens.

## Speler

1. Open `/speler`, meld je aan met e-mail of Google en bevestig zo nodig je naam op het scorebord. Een bestaande sessie wordt hergebruikt. Een gescande baan-QR of wedstrijdlink blijft na aanmelden de bestemming.
2. Kies in het spelersmenu **Installeer DartFlow**. Bevestig het browservenster als dat verschijnt. Volg anders de getoonde beginscherminstructies; op iPhone/iPad staat deze keuze in het deelmenu van Safari.
3. Sluit de app en open **DartFlow Speler** via het nieuwe icoon. Je opent direct de speelomgeving. In de zelfstandige app wordt de installatiekeuze verborgen.

Bij een actieve X01-partij verschijnt de schermvullende scoreconsole. Voer het worptotaal in en kies **Bevestigen**. Finish en aantal darts verschijnen wanneer die nodig zijn. Met de compacte terugknop blijft de partij bewaard; je kunt daarna de scoreconsole opnieuw openen. Thuis en hybride schrijft iedere speler zijn eigen beurt; lokaal blijft de aangewezen schrijver gelden. Een afgeronde solo geeft de fysieke baan direct vrij en bewaart de historie. Een oude training kan daarna geen nieuwe baansessie terugdraaien.

## Een scherm per baan

1. Open als wedstrijdleiding **Toernooiregie → Banen** en kies **Open baanscherm** bij de bedoelde baan. Vaste verenigingsbanen hebben dezelfde schermroute.
2. Open deze URL op het schermapparaat. De vaste route is `/baanscherm/<onveranderlijk-baan-ID>`. Gebruik de spelers-QR niet als installatieadres: die QR opent `/baan/<ID>` op de telefoon van de speler.
3. Kies **Installeer dit baanscherm**. De app heet **DartFlow · Baan 1**, met de actuele baannaam. Een nog ongekoppeld afgeschermd scherm gebruikt eerst een algemene naam; geef het icoon dan zelf de juiste baannaam. Herhaal dit vanuit het scherm van Baan 2 om een tweede icoon te maken. Naamwijzigingen en nieuwe partijen wijzigen het baan-ID, de app-identiteit en de start-URL niet.
4. Sluit beide apps volledig en open ze via hun eigen icoon. Controleer de baannaam en vaste QR. Een vrije baan toont het wachtscherm; dezelfde pagina volgt de live partij en wordt daarna weer vrij.

Browsers bepalen welke installatievorm beschikbaar is. De aparte manifest-ID's maken afzonderlijke apps mogelijk waar de browser dit ondersteunt; ze vormen geen garantie voor ieder apparaat. Gebruik anders een beginschermsnelkoppeling naar de **exacte** baan-URL. De getoonde installatiehulp legt de beschikbare route uit. Zie [Chrome over app-identiteit](https://developer.chrome.com/docs/capabilities/pwa-manifest-id) en [de browserafhankelijke installatievormen](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Installing).

Ondersteunt het apparaat geen afzonderlijke baaninstallaties, open dan `/scorebord` en gebruik **DartFlow Scorebord** als vaste startapp. Kies in de uiteindelijke geïnstalleerde app of het kioskprofiel eenmalig de bedoelde baan; een gewone browserkeuze wordt bij afzonderlijke appopslag niet automatisch overgenomen. Deze keuze verandert alleen door een expliciete nieuwe koppeling; een andere baan in een browsertab openen verandert de vaste startbaan niet. Gebruik op een beheerd scherm dezelfde vaste startpagina in de kioskcontainer als het apparaat zelf geen beginscherminstallatie aanbiedt. Dit is een webapp; ondersteuning van een kioskcontainer en automatisch starten moet op het werkelijke schermapparaat worden vastgesteld.

## Afgeschermde baan eenmalig koppelen

Openbare verenigingsschermen behouden hun bestaande openbare leesrechten. Een beperking op wie op een verenigingsbaan mag **spelen** verandert die openbare schermrechten niet. Voor afgeschermde evenementbanen geeft wedstrijdleiding een afzonderlijke apparaatkoppeling uit:

1. Open **Schermtoegang** bij de baan. Vul voor een afgeschermd scherm een herkenbare naam in, bijvoorbeeld *Tablet bar · Baan 1*, en kies **Koppelcode maken**. Bij een openbaar scherm staat uitgelegd waarom koppelen daar niet nodig is.
2. Voer de getoonde tijdelijke koppelcode in de uiteindelijke geïnstalleerde app of het blijvende kioskprofiel in. De code is eenmalig en tien minuten geldig. Het scherm krijgt een baangebonden, alleen-lezen apparaattoegang; er is geen spelerslogin nodig. Als het apparaat een afzonderlijke opslag voor de geïnstalleerde app gebruikt, geldt een eerdere koppeling in een gewoon browsertabblad daar niet automatisch.
3. Controleer de gekoppelde apparaten bij de baan. Trek een verdwenen of vervangen apparaat daar in. Het scherm kan daarna geen actuele stand meer ophalen en vraagt opnieuw om koppelen.

De apparaattoegang verloopt uiterlijk na één jaar en kan eerder worden ingetrokken. Bewaar browsergegevens op het schermapparaat: het wissen van cookies, een privévenster of een nieuw browserprofiel kan opnieuw koppelen nodig maken. De vaste spelers-QR bevat geen apparaatgeheim en geeft geen schrijfrechten. Spelers melden zich met hun eigen account aan en behouden de bestaande baan-, club- en wedstrijdregels.

## Verbinding en wakker houden

Bij tijdelijk verbindingsverlies blijft de laatst ontvangen stand in het geopende scherm zichtbaar, met een duidelijke offline-indicatie. Na herstel wordt opnieuw de **baanstatus** opgehaald, zodat ook een inmiddels begonnen andere partij verschijnt. Een ongeldig of ingetrokken apparaat behoudt geen live toegang. Een volledige herstart zonder netwerk kan geen actuele stand laden; wacht op herstel van de verbinding.

De serviceworker bewaart uitsluitend geschikte statische appbestanden. Sessies, live wedstrijdgegevens, API-antwoorden en scoremutaties worden niet gecachet. De knop voor wakker houden vraagt de browser om schermvergrendeling uit te stellen; energiebesparing of apparaatbeleid kan dat weigeren of later beëindigen. Zie [Screen Wake Lock](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API).

## Vaste tablets en tv-boxen na stroomuitval

Een webapp kan zichzelf na een uitgeschakeld apparaat niet starten. Stel daarvoor op het apparaat een vaste kioskstart in en test een echte stroomonderbreking:

| Apparaat | Vaste start en behoud van de koppeling |
| --- | --- |
| Beheerde Android-tablet of Android-tv-box | Laat het apparaatbeheer de browser/kioskcontainer na opstarten openen op de exacte baan-URL of `/scorebord`. Gebruik een blijvend browserprofiel met cookies en lokale opslag. Configureer automatisch openen, scherm aan en appvergrendeling in het apparaatbeheer; alleen scherm vastzetten is geen bewezen automatische herstart. Zie [Android dedicated devices](https://developer.android.com/work/dpc/dedicated-devices/lock-task-mode). |
| Windows-schermcomputer | Laat een blijvend browserprofiel of de geïnstalleerde app automatisch starten na aanmelden. Edge-kioskmodus is geschikt voor openbare schermen, maar gebruikt InPrivate; kies voor een afgeschermde baan een beheerde oplossing die de apparaatcookie bewaart. Controleer het herstartbeleid afzonderlijk. Zie [Microsoft Edge-kioskmodus](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-configure-kiosk-mode). |
| Raspberry Pi | Configureer de desktopautostart voor Chromium met de vaste baan-URL en een blijvend profiel. Schakel schermblanking uit volgens het apparaatbeleid. Zie [de officiële Raspberry Pi-kioskhandleiding](https://www.raspberrypi.com/tutorials/how-to-use-a-raspberry-pi-in-kiosk-mode/). |
| iPhone/iPad | De beginschermapp kan handmatig worden geopend. Automatisch opnieuw openen na stroomuitval is een aparte beheerinstelling; handmatig begeleide toegang bewijst dat niet. Leg de ondersteunde beheermethode vast voor het gebruikte model. |

Controleer na een echte herstart: juiste baan, geen spelerslogin, behoud van een eventuele apparaatkoppeling, QR zichtbaar, actuele stand en wakker houden. Een webbrowserproef op de dev-VPS bewijst deze apparaateigenschappen niet.

## Acceptatie vastleggen

Noteer per apparaat model, OS-versie, browser/kioskversie, gekozen installatieroute en uitkomst van volledig sluiten/heropenen en stroomherstel. Test op hetzelfde ondersteunde apparaat Speler, Baan 1 en Baan 2. Speel op Baan 1 terwijl Baan 2 vrij blijft, onderbreek kort het netwerk, begin zo nodig ondertussen een volgende partij en controleer herstel. Test solo, lokaal en online op twee telefoons in portret, inclusief finish, correctie, eigen beurt en hetzelfde Sprint-scorebord.

De geautomatiseerde resultaten en de werkelijk geteste stagingrelease worden afzonderlijk bij de uitrol vastgelegd. Fysieke installatie, providerlogin en stroomherstel blijven open totdat ze op de opgegeven apparaten zijn uitgevoerd.
