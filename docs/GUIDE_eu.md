# MeteoRideren erabiltzailearen gida

Aplikazioaren barruan daramazun laguntzak "zer egin behar dut" galderari
erantzuten dio. Gida honek, berriz, "zergatik" eta "zer gertatzen da baldin eta"
galderei. Hemen dago xehetasun osoa: hornitzaile bakoitzaren mugak, aplikazioak
zer gordetzen duen eta non, nola jokatzen duen estaldurarik gabe eta
nola lortu aplikazioak edo zeure kopia propioa martxan jarri.

Versión en español: [GUIA.md](GUIA.md) · English version: [GUIDE.md](GUIDE.md) ·
Aplikazioko laguntza: [help_eu.html](https://app.meteoride.cc/help_eu.html)

---

## 1. Zer da MeteoRide

MeteoRide txirrindularientzako aplikazio bat da —webean, eta iPhone eta
Androiderako aplikazio gisa— GPX/KML ibilbideak kargatzen dituena eta
iragarpena ibilbidean zehar erakusten duena.

Aplikazioak ibilbidearen urratsak kalkulatzen ditu zuk aukeratutako
txirrindularitza-abiaduratik abiatuta, eta eguraldi-hornitzaile bati edo
gehiagori eskatzen dizkie tenperatura, haizea, prezipitazioa, hezetasuna,
hodei-estaldura, argitasuna eta UV indizea urrats horietako bakoitzerako.
Ordezko hornitzaile automatikoak ditu, hornitzaile batek huts egiten duenean ere
daturik izan dezazun, eta iturri desberdinetako iragarpenak edo bi data
desberdinetakoak alderatzeko aukera ematen du.

MeteoRidek ez du ibilbidea editatzen: irakurri bakarrik egiten du.

---

## 2. Lehen urratsak

### 2.1 Kargatu GPX/KML ibilbide bat

Sakatu **📁** botoia eta aukeratu zure fitxategia. GPX eta KML estandarreko
trackak, ibilbideak eta waypointak onartzen dira.

Ibilbide bat esteka batetik ere karga dezakezu,
[§9.4](#94-parametrodun-urlak) atalean azaldutako parametroekin, edo beste
aplikazio batetik partekatu, aplikazio natiboa erabiltzen baduzu
([§6](#6-iphone-eta-androiderako-aplikazioan)).

### 2.2 Data eta ordua

Hautatu noiz egin nahi duzun ibilbidea. Sistemak bere kabuz egokitzen du ordua
15 minutuko tarteetara.

### 2.3 Abiadura

Idatzi zure batez besteko abiadura estimatua edo erabili aurrez ezarritako
balioetako bat: 5, 10, 12, 15 edo 20 km/h. Abiadura horretatik ateratzen da
puntu bakoitzean zein ordutan egongo zaren; beraz, hori da emaitza gehien
aldatzen duena.

### 2.4 Tartea

Aukeratu zenbat minuturo nahi duzun eguraldiaren informazioa ikusi: 15 edo 30
minuturo.

### 2.5 Hornitzailea

Aukeratu erabili nahi duzun hornitzailea edo hornitzaile-katea.
[§4](#4-eguraldi-hornitzaileak) atalean daude azalduta. Aukeratu duzunak huts
egiten badu zer gertatzen den [§9.3](#93-ordezko-hornitzaile-adimendunak)
atalean dago.

### 2.6 Hornitzaileak alderatzeko modua

Hautatu **Alderatu** hornitzaileen goitibeherako zerrendan hornitzaileen arteko
desberdintasunak ebaluatzeko ibilbide berean eta ordu berean.

- Open-Meteo eta AROME taula arruntak bezala irakurtzen ditu, lehen 5 orduetako
  ordu-laurdeneko datuak barne.
- Hornitzaile batek erantzuten ez badu, abisuak zeinek huts egin duen esaten du,
  errore orokor bat erakutsi beharrean.

### 2.7 Datak alderatzeko modua

Alderatu ibilbide beraren iragarpena bi data edo ordu desberdinetan.

- Sakatu dataren ondoko **⇄** modu honetan sartzeko.
- Ezarri A data eta B data; bigarren data lehenengoaren azpian agertzen da.
- Sakatu **⟲** taula eguneratzeko.
- Taulak 4 errenkada erakusten ditu: A dataren tarteak, A dataren laburpena, B
  dataren tarteak, B dataren laburpena.
- **Ez da automatikoki berriro kalkulatzen.** Edozein parametro aldatzen baduzu,
  ⟲ sakatu behar duzu berriro.

---

## 3. Ibilbideak beste webgune batzuetatik kargatu (userscriptak)

Proiektuak Tampermonkey-rako bi userscript aukerazko ditu. Ez dira beharrezkoak
MeteoRide erabiltzeko; beste webgune batzuetan planifikatzen dutenentzako
lasterbideak dira. Instalatzeko argibideak
[USERSCRIPTS.md](USERSCRIPTS.md) fitxategian daude.

- **Komoot / Bikemap / Hammerhead → MeteoRide**: ikusten ari zaren ibilbidea
  zuzenean MeteoRiden irekitzen duen botoi bat gehitzen du. Komooten GPXa
  deskargatzea **Premium** kontu batekin bakarrik dago erabilgarri; hura gabe
  scriptak ezin du fitxategia lortu.
- **MeteoRide → Hammerhead**: uneko GPXa Hammerheadera
  (dashboard.hammerhead.io) esportatzen duen botoi bat gehitzen du MeteoRiden.
  Scriptak GPX gordina zuk konfiguratutako share-server batera igotzen du eta
  URL hori inportatzeko eskatzen dio Hammerheadi.

---

## 4. Eguraldi-hornitzaileak

| Hornitzailea | API gakoa | Horizontea | Estaldura |
|---|---|---|---|
| Open-Meteo | Ez | 14 egun | Mundu osoa |
| OpenWeather | Bai (doako maila) | 4 egun | Mundu osoa |
| AROME-HD | Ez | 36 ordu | Europaren zati bat |

- **Open-Meteo**: doakoa, gakorik gabe, mundu osoa hartzen du, 14 egun arte.
  Open-Meteok bere eredurik onena aukeratzen du zure trackaren eremuaren
  arabera. Edozein egoeratarako gomendatua, eta aproposa epe luzeko
  planifikaziorako eta Europatik kanpoko ibilbideetarako.
- **OpenWeather**: API gakoa behar du, 4 egun arte. Denbora errealeko datu
  bikainak ditu, eta **eguraldi-abisu ofizialak argitaratzen dituen hornitzaile
  bakarra da** ([§11](#11-eguraldi-abisu-ofizialak)). Aproposa berehalako
  irteeretarako eta hiriguneetarako.
- **AROME-HD**: MeteoFranceren bereizmen handiko eredua (~1-2 km), Open-Meteo
  bidez eta gakorik gabe eskuratua. Europan bakarrik dago erabilgarri
  (gutxi gorabehera 39-52°N, 10.5°M-16.5°E) eta 36 orduko epean. Eremu edo epe
  horretatik kanpo, Open-Meteok kokaleku horretarako duen eredurik onenera
  aldatzen da zuzenean, ezer arraroa adierazi gabe: daturik badago oraindik.
  Bikaina haizerako eta epe laburreko prezipitaziorako Frantzian eta inguruko
  herrialdeetan.

### Hornitzaile-kateak

Kateek hainbat hornitzaileren indarguneak konbinatzen dituzte taula beraren
barruan:

- **OpenWeather → AROME-HD → Open-Meteo**: OpenWeather-en denbora errealeko
  datuak lehen ordurako, AROMEren tokiko zehaztasun handia hurrengo 47
  orduetarako, eta Open-Meteo iragarpenaren gainerakorako. OpenWeather-en gakoa
  behar du; hura gabe aukera desgaituta agertzen da hautatzailean.

Aukeratu behar duzunaren arabera: denbora errealeko zehaztasuna (OpenWeather),
tokiko zehaztasuna (AROME-HD) edo epe luzeko planifikazioa (Open-Meteo).

---

## 5. Nabigatzailean erabili

Web-aplikazioak edozein nabigatzaile berritan funtzionatzen du, ordenagailuan
zein mugikorrean, <https://app.meteoride.cc> helbidean. Ez dago ezer instalatu
beharrik.

iPhone edo Androiderako aplikaziorako, instalatu App Storetik edo GitHubeko
APKarekin; urratsak [`docs/INSTALL.md`](INSTALL.md) fitxategian daude
(ingelesez).

---

## 6. iPhone eta Androiderako aplikazioan

Hau aplikazio natiboaren barruan bakarrik dago: nabigatzaile batek egin ezin
dituen gauzak dira.

### 6.1 Bidali ibilbidea beste aplikazio batera

Ibilbide bat kargatuta dagoenean, goiko barrako **📤** botoiak sistemaren
partekatzeko orria irekitzen du GPXa erantsita. Handik zure GPS gailura
(Hammerhead, Wahoo), Fitxategiak aplikaziora, posta elektronikora edo nahi
duzun lekura doa. Fitxategia ez da inoiz gailutik ateratzen: ez dago
tarteko zerbitzaririk.

### 6.2 Jaso ibilbide bat beste aplikazio batetik

Alderantziz ere bai: Komoot, Strava, Bikemap, Fitxategiak edo posta
elektronikoan, partekatu GPXa eta aukeratu **MeteoRide**. Aplikazioa ibilbidea
kargatuta duela irekitzen da. Berdin deskargatutako fitxategi batetik "Ireki
MeteoRiden" erabiliz.

MeteoRide partekatzeko orrian lehen aldian agertzen ez bada, berrabiarazi
telefonoa: sistemak denbora pixka bat behar du aplikazioa helburu gisa
erregistratzeko.

### 6.3 Abisuak ibilbideko eguraldia aldatzen bada

Iragarpena orduak lehenago egindako aurreikuspena da. Ibilbide bat
kalkulatzen duzunean, aplikazioak hura zaintzen jarraitzen du eta abisatu
egiten dizu kanpoan zauden orduetarako okertzen bada:

- Lehor zegoen eta euria egingo du, edo euria zaparrada bihurtzen da.
- Lasai zegoen eta haize moderatua edo indartsua egingo du, edo 43 km/h
  inguruko boladak edo handiagoak.
- Zure irteerarekin bat egiten duen abisu ofizial bat ematen da. Horrek
  OpenWeather-en gakoa eta abisu ofizialak aktibatuta izatea behar du.

Aldaketa bakoitza behin bakarrik abisatzen da; gero gehiago okertzen bada,
berriro abisatzen du. Hobekuntzak ez dira abisatzen, ezta dagoeneko igaro
dituzun zatiak ere. Zaintza ibilbidearen azken puntutik ordubetera amaitzen da.

**Ezarpenak → Abisuak → "Abisatu ibilbideko eguraldia aldatzen bada"** atalean
aktibatu eta desaktibatzen da, hasieratik aktibatuta dago, eta etengailuaren
azpian aplikazioak zein ibilbide zaintzen ari den eta noiz arte esaten dizu.

**Garrantzitsua:** egiaztapena sistema eragileak egiten du nahi duenean, ez
aplikazioak. iPhonen *Atzeko planoko eguneratzea* aktibatuta egon behar da
MeteoRiderako (Ezarpenak → Orokorra; iPhonean, gaztelaniaz: Ajustes → General →
Actualización en segundo plano), eta bateria aurrezteko moduak eteten du.
Androiden, fabrikatzaile batzuek atzeko planoko zereginak hiltzen dituzte beren
bateria-kudeatzailearekin. Sistemak egingo ez badu, aplikazioak berak esaten
dizu etengailuaren azpian, zaintzen ari zarela sinetsarazi beharrean.

### 6.4 Estaldurarik gabe

Eguraldia ezin da asmatu, baina dagoeneko deskargatutakoa ez da botatzen:

- Aplikazioa irekitzean azken ibilbidea bere taularekin agertzen da berriro,
  ezer kargatu beharrik gabe.
- Iragarpena zaharra bada erakusten jarraitzen da, zenbat ordu dituen
  adierazita. Hamabi ordu dituenean uzten dio erakusteari.
- Maparen hondoak konexioa behar du. Ikusi dituzun lauzak maparen
  zerbitzariak uzten duen denboran bakarrik gordetzen dira (OpenStreetMap-en
  baldintzek konexiorik gabeko erabilera debekatzen dute); beraz, estaldurarik
  gabe hondoa hutsik ager daiteke; mapak hala adierazten du, eta ibilbidea eta
  taula berdin ikusten dira.
- Daturik ez badago, hala esaten du: ez da pantaila huts bat geratzen
  azalpenik gabe.

**📴** botoiak kargatuta duzun ibilbidearen iragarpena gordetzen du eta
cachearen ezabatze automatikotik babesten du. Sakatu ezazu etxean, irten
aurretik.

### 6.5 Mapa eta ezarpenak

- Ibilbiderik kargatuta ez dagoenean, mapa zauden lekuan irekitzen da,
  Bartzelonan beharrean.
- Aplikazioa telefonoaren hizkuntzan abiarazten da, zuk eskuz bat aukeratu
  arte.
- Unitateak, hizkuntza, zure API gakoa eta azken ibilbideak barneko
  nabigatzailetik kanpo gordetzen dira, WebKitek gordetzen duen moduan: ez dira
  galtzen sistemak lekua askatzen badu, eta iPhonen hor jarraitzen dute
  aplikazioa berriro irekitzean. Lehen ez.
- Mapak zu bilatzen duen lehen aldian, sistemak kokapen-baimena eskatzen du
  MeteoRideren izenean.
- Telefonoa bertikalean geratzen da, biratzean pantaila hausten delako. iPada
  biratu egiten da.

---

## 7. Ezarpenak

### 7.1 API gakoak

OpenWeather-ek bakarrik behar du gakoa, eta hornitzaile hori edo abisu ofizialak
erabili nahi badituzu bakarrik. Doan lortzen da
[openweathermap.org/api](https://openweathermap.org/api) helbidean (One Call API).

Eremuaren ondoan **🔍 Egiaztatu** botoi bat dago: aplikazioak eskaera sinple
bat egiten du eta egoera ondoan erakusten du (baliozkoa / baliogabea / kuota /
HTTP kodea). Erabili etxetik irten aurretik gakoa sortu berri baduzu;
OpenWeather-ek denbora pixka bat behar du gakoak aktibatzeko.

### 7.2 Abisu ez-kritikoak

**Erakutsi abisu ez-kritikoak** kontrol-laukiak jakinarazpenen xehetasun-maila
kontrolatzen du. Aktibatuta, informazio-bandak ikusiko dituzu ordezko
hornitzaile bat erabiltzen denean horizontearen, kuotaren edo API erroreen
ondorioz. Desaktibatuta, errore kritikoak bakarrik erakusten dira.

### 7.3 Unitateak

- **Haizea:** km/h, m/s, mph
- **Tenperatura:** °C, °F
- **Distantzia:** km, mi
- **Euria:** mm, in

### 7.4 Hizkuntzak

Aplikazioa gaztelaniaz, ingelesez, katalanez, galegoz, euskaraz, frantsesez,
alemanez, italieraz eta portugesez dago. Aukeratutako hizkuntzak interfazea eta
mezuak aldatzen ditu. Aplikazio natiboan, zuk eskuz bat aukeratu arte
telefonoarena erabiltzen da.

### 7.5 Debug botoia

**Ezarpenak → Erakutsi debug botoia** aukerak 🐞 botoia pizten du. Desaktibatuta
dator. Arazo bat jakinaraztean informazioa eransteko balio du.

---

## 8. Datuak interpretatzen

### 8.1 Eguraldi-taula

Taulak informazioa orduz ordu erakusten du:

- **Lehen errenkada:** ordua eta metatutako distantzia.
- **Bigarren errenkada:** eguraldi-ikonoak, hornitzaile-aldaketaren
  adierazleekin dagokionean.
- **Tenperatura:** Celsius edo Fahrenheit gradutan.
- **Haizea:** abiadura + norabide-gezia; boladak parentesi artean.
- **Euria:** kopurua mm/h-tan **pedalean ariko zaren ordurako** (probabilitatea
  parentesi artean). Ez da urratsaren minutu zehatzetik hurbilen dagoen
  neurketa, zati hori egiten ariko zaren ordu osoarena baizik.
- **Hezetasuna:** hezetasun erlatiboaren ehunekoa.
- **Hodei-estaldura:** hodeiek estalitakoaren ehunekoa.
- **Argitasuna:** eguraldi-ikurraren ondoko barra bertikala, bigarren
  errenkadan. Tarte horretan dagoen argiaren %0-100 adierazten du.
- **UV:** indize ultramorea (zenbaki osoa), "Hodeiak / UV" errenkada konbinatuan.

### 8.2 Hornitzaile-aldaketaren adierazleak

Datu-iturria ibilbidean zehar aldatzen denean, etiketa laburtu bat ikusiko duzu
zutabe horretako datuen gainean:

- **OPM** — Open-Meteo
- **ARM** — AROME-HD
- **OPW** — OpenWeather

Modu arruntean, hornitzaileak alderatzean eta datak alderatzean agertzen dira,
eta zehazki adierazten dute zein hornitzailek ematen dituen datuak denbora-tarte
bakoitzean. Bereziki erabilgarriak dira kateekin, hainbat iturri konbinatzen
baitira.

### 8.3 Mapa

- **Gezi urdinak:** haize ahula (<12 km/h)
- **Gezi gorriak:** haize indartsua (30-50 km/h)
- **Gezi moreak:** haize oso indartsua (>50 km/h)
- **Tantak 💧:** espero den prezipitazioa
- **Markatzaile berdeak/gorriak:** ibilbidearen hasiera eta amaiera

---

## 9. Funtzio aurreratuak

### 9.1 Taula horizontalki mugitzea

Taula interaktiboa da eta ukipen-pantailetara egokituta dago:

- Arrastatu taula horizontalki edo erabili saguaren gurpila zutabeak mugitzeko
  (keinuak eta *drag-to-scroll*).
- Egin klik edozein zutabetan —edo edozein gelaxkatan, zutabe hori hautatzeko—
  eta errenkada eta mapa nabarmenduko dira.
- Mapa hautatutako puntuan zentratzen da haize-gezi batean edo zutabean klik
  egiten baduzu.
- Azkenaurreko zutabea azkenetik 5 minutu baino gutxiagora badago, aplikazioak
  ezkutatu egiten du bikoizketa bisualak saihesteko.
- ⇆ ikono txikiak mugitzean zutabe gehiago daudela adierazten du.

### 9.2 Eguzki-informazioa

Aplikazioak automatikoki erakusten ditu:

- Eguzkiaren irteera- eta sartze-orduak.
- Ilunabar zibila, "c" letrarekin markatuta.
- Benetako argitasunaren kalkulua orduaren eta baldintzen arabera.

### 9.3 Ordezko hornitzaile adimendunak

MeteoRidek automatikoki kudeatzen ditu:

- Open-Meteora aldatzea, **eragindako urratsetarako bakarrik**, zure
  hornitzaileak bere denbora-horizontea gainditzen badu, behin eta berriz huts
  egiten badu edo puntu horretarako daturik ez badu.
- Berriro saiatzea aldi baterako erroreak daudenean.
- Abisu labur bat goiburuan hori gertatzen denean, Ezarpenetan abisu
  ez-kritikoak aktibatuta uzten badituzu ([§7.2](#72-abisu-ez-kritikoak)).

Eskaera bakoitzak epe bat du: **15 segundo** zerbitzaria erantzuten hasteko eta
**beste 15 segundo** daturik jaso gabe deskargatzen ari den bitartean.
Hornitzaile bat isilik geratzen bada, ez zaio berriro galdetzen kalkulu horretan
bertan: gainerako urratsak zuzenean ordezko hornitzaileari eskatzen zaizkio,
epea behin eta berriz agortu arte itxaron beharrean.

### 9.4 Parametrodun URLak

MeteoRide ibilbidea eta parametroak jarrita dituela ireki dezakezu:

- `?gpx_url=https://example.com/route.gpx`
- `?datetime=2024-03-15T10:00`
- `?speed=25`

Konbina daitezke. Nabigatzaileak zuzenean URL horretatik deskargatzen du GPXa:
MeteoRidek ez du inora igotzen.

### 9.5 Azken ibilbideak

MeteoRidek kargatu dituzun azken GPX ibilbideak lokalki gordetzen ditu,
fitxategia berriro igo gabe berreskura ditzazun.

- **Nola erabili:** 📁 botoiaren ondoan zure azken ibilbideen goitibeherako
  zerrenda bat dago. Hautatu bat eta orain igoko bazenu bezala kargatuko da.
- **Muga:** azken **5** ibilbideak gordetzen dira. Lehendik gordeta zegoen
  ibilbide bat berriro kargatzen baduzu, zerrendaren goialdera igotzen da,
  bikoiztu beharrean.
- **Gomendatutako tamaina:** GPX bakoitzeko **750 KB** inguru gehienez. Zurea
  nabarmen handiagoa bada, moztu ezazu edo ostatatu eta kargatu `?gpx_url=`
  bidez.
- **Pribatutasuna:** GPXak zure nabigatzailean gordetzen dira IndexedDB bidez
  (edo localStorage ordezko gisa). Ez dira inoiz zure gailutik kanpo partekatzen.
- **Eraginkortasuna:** memorian oinarrizko informazioa bakarrik gordetzen da
  (izena, tamaina eta data); eduki osoa ibilbidea hautatzen duzunean bakarrik
  irakurtzen da.

### 9.6 Cache lokala eta errendimendua

Hornitzaileen erantzunak `localStorage`-n gordetzen dira **30 minutu**
inguruz urrats/ordu bakoitzeko. Horrek maiz egindako birkargak azkartzen ditu
eta erabilera-mugak dituzten APIei egindako eskaerak murrizten ditu. Bere kabuz
iraungitzen da: ez dago eskuz ezer ezabatu beharrik.

---

## 10. Mugak eta aholkuak

### Mugak

- **Denbora-horizontea:** Open-Meteo 14 egun, OpenWeather 4 egun, AROME-HD
  36 ordu.
- **Zehaztasuna:** iragarpenak nabarmen ez hain fidagarriak dira 3.-4. egunetik
  aurrera.
- **Doako APIak:** Open-Meteok ez du gakorik behar eta ez du muga praktikorik;
  OpenWeather-ek doako maila bat eskaintzen du, baina gakoek hileko
  erabilera-mugak izan ditzakete.
- **MeteoRidek ez du ibilbidea editatzen.** GPX/KML fitxategia irakurri bakarrik
  egiten du.

### Jardunbide egokiak

- Erabili gehienez 100-200 km-ko ibilbideak errendimendu hobea izateko.
- Planifikatu 1-2 egun lehenago zehaztasun handiagoa izateko.
- Konbinatu hainbat iturritako informazioa erabaki garrantzitsuetarako.
- Izan beti B plan bat baldintza txarretarako.
- Eraman euritako arropa, probabilitatea txikia izan arren.

---

## 11. Eguraldi-abisu ofizialak

MeteoRidek estatuko zerbitzu meteorologikoek argitaratutako abisu eta alerta
ofizialak erakuts ditzake, OpenWeather-en `alerts` arrayan agertzen direnean.

Aktibatzeko: idatzi zure **OpenWeather API gakoa** Ezarpenetan eta markatu
**Erakutsi eguraldi-abisu ofizialak** kontrol-laukia.

- **Erabilgarritasuna:** OpenWeather-en gakoa behar du, argitaratzen dituen
  hornitzaile bakarra baita. Gakoa konfiguratuta, MeteoRidek abisuak egiaztatzen
  ditu OpenWeather hornitzaile nagusi gisa hautatu ez baduzu ere. Gakorik gabe,
  kontrol-laukia desgaituta agertzen da eta zergatik azaltzen du.
- **Ikusgarritasuna:** abisu bat detektatzen denean informazio-txartel bat
  agertzen da, 15 segundora berez ezkutatzen dena. Gainera, **⚠️** adierazle
  iraunkor bat geratzen da, detektatutako abisu guztiak berriro irekitzeko.
- **Laginketa eta eraginkortasuna:** APIrako deiak murrizteko, ibilbidean
  zeharreko puntuen lagin adierazgarri bat egiaztatzen da (urratsen 2/3 inguru,
  gutxienez 3). Erantzunak lokalki gordetzen dira cachean ~1 orduz.
- **Denbora-bateragarritasuna:** ibilbidearen dagokion zatiaren denbora-leihoarekin
  bat egiten duen aldia (start/end) duten abisuak bakarrik hartzen dira kontuan,
  urratsaren inguruan ±1 orduko tolerantziarekin.

> **Ohar garrantzitsua.** Abisu hauek informazio gehigarri gisa bakarrik
> ematen dira. Ez fidatu soilik haietaz segurtasun-erabakietarako. Kontsultatu
> beti zure herrialdeko zerbitzu meteorologiko ofiziala edo agintari eskudunak
> baldintza txarrek eragin diezaioketen jarduera bat egin aurretik.
> OpenWeather-ek akatsak edo atzerapenak izan ditzake, edo tokiko abisu
> zehatzak ez jaso; MeteoRidek ez ditu jakinarazpen ofizialak ordezten.

---

## 12. Arazoen konponbidea

| Sintoma | Zer begiratu |
|---|---|
| GPX/KML fitxategia ez da kargatzen | Egiaztatu fitxategiak track baliozkoak dituela. |
| Ez dago eguraldiaren daturik | Egiaztatu zure API gakoa 🔍 Egiaztatu botoiarekin, edo aldatu Open-Meteora, ez baitu gakorik behar. |
| Data tartetik kanpo dago | Murriztu denbora-horizontea: hornitzaile bakoitzak berea du ([§4](#4-eguraldi-hornitzaileak)). |
| Taula hutsik dago | Ziurtatu ibilbidea urrats bat gutxienez egiteko bezain luzea dela. |
| Partekatutako ibilbidea ez da aplikaziora iristen | Berrabiarazi telefonoa lehen aldian ([§6.2](#62-jaso-ibilbide-bat-beste-aplikazio-batetik)). |
| Eguraldi-aldaketaren abisuak ez dira iristen | Begiratu aplikazioak etengailuaren azpian zer esaten duen ([§6.3](#63-abisuak-ibilbideko-eguraldia-aldatzen-bada)). |

Arazo bat jakinarazteko, piztu debug botoia ([§7.5](#75-debug-botoia)) eta
adierazi zure gailua eta bertsioa, laguntza-orriaren behealdean agertzen dena.

---

## 13. Pribatutasuna eta datuak

Politika bera —hornitzaile bakoitzak zer jasotzen duen, zenbat denboran gordetzen
duen eta gailuan geratzen den guztia nola ezabatu— hemen dago:
[webgunearena](https://app.meteoride.cc/privacy-web-eu.html),
[iOSekoa](https://app.meteoride.cc/privacy-ios-eu.html) eta
[Androidekoa](https://app.meteoride.cc/privacy-android-eu.html) — plataforma
bakoitzeko bat, denda bakoitzari ematen zaiona hori delako, eta aplikazioak
webgunea baino itxiagoak dira. Atal hau laburpena da; zuzen egon behar duena
politika da.

**MeteoRide osorik zure gailuan dabil.** Ezarpen, hobespen eta datu guztiak
zure gailuan bakarrik gordetzen dira: webgunean, nabigatzailean (localStorage
eta IndexedDB), eta aplikazioan sistemaren biltegiratze propioan ere bai, iOSek
ezarpenak ezabatu ezin ditzan.

Salbuespen bakarra webgunea da: MeteoRide → Hammerhead aukerazko userscripta
erabiltzen baduzu (3. atala) ibilbide bat Hammerheadera bidaltzeko, GPX hori
Cloudflarera igotzen da, scriptak berez erabiltzen duen share-serverrera,
Hammerheadek esteka batetik inporta dezan. Fitxategia MeteoRidetik zuzenean
irekitzen baduzu ez da ezer bidaltzen, lokalki prozesatzen delako, eta
aplikazio natiboek ez dute inoiz hori egiten. Nolanahi ere, igotako GPXa
automatikoki ezabatzen da gehienez bi minutuko epean.

- **Erregistrorik gabe:** ez duzu konturik sortu behar ezta datu pertsonalik
  eman ere.
- **Kontrol osoa:** webgunean, ezabatu gunearen datuak nabigatzailearen
  ezarpenetatik; aplikazioan, desinstalatu (iPhone) edo ezabatu haren
  biltegiratzea (Android). Zure plataformaren politikak azaltzen du zer
  gertatzen den babeskopiekin.
- **Kode irekia:** iturburu-kode osoa GitHub-en ikuska dezakezu.

### Eguraldi-hornitzaileekin partekatutako datuak

Iragarpenak lortzeko, MeteoRidek hau bakarrik partekatzen du:

- Zure ibilbideko puntuen **koordenatu geografikoak**.
- Iragarpena behar duzun **data eta orduak**.
- **Zure API gakoa**, OpenWeather erabiltzen baduzu.

Eguraldi-hornitzaileek (Open-Meteo, OpenWeather) beren pribatutasun-politikak
dituzte. MeteoRidek behar dituzun datuak eskatzeko bitartekari gisa bakarrik
jarduten du.

### API gakoari buruz

Gakoa zure gailuaren biltegiratze lokalean gordetzen da, **zifratu gabe**. Horrek
esan nahi du, hipotetikoki, zure gailurako sarbidea duen hirugarren batek edo
zure nabigatzailean exekutatzen ari den beste script batek eskura dezakeela.
Gako mota honekin arriskua txikia da, baina gomendagarria da baimen minimoak
dituen doako gako bat erabiltzea. Bestela, gakorik ez erabiltzea eta gakorik
behar ez duten hornitzaileez (Open-Meteo, AROME-HD) fidatzea aukera dezakezu.

### Zer gordetzen den lokalki

- Unitateen eta hizkuntzaren ezarpenak.
- API gakoak, zifratu gabe.
- Abiadura- eta tarte-hobespenak.
- Eguraldi-datuen aldi baterako cachea (~30 minutu).
- Kargatutako azken 5 GPX ibilbideak.
- Aplikazio natiboan, gainera, ikusi dituzun maparen lauzak, bakoitza bere
  zerbitzariak emandako iraungitze-dataraino.

Pribatutasun-berme zorrotzagoak behar badituzu, MeteoRide osorik lokalki exekuta
dezakezu (`index.html` irekiz partekatzeko/igotzeko funtzioak erabili gabe) edo
zure share-server propioa hedatu, zuk erabakitako sarbide-politikekin
([DEPLOY.md](DEPLOY.md)).

---

## 14. Lizentzia eta kredituak

[Lockevod](https://github.com/lockevod)-ek garatua.

### Lizentzia

Proiektu hau **MIT lizentziapean** dago, eta horrek esan nahi du:

- Aplikazioa libreki erabil dezakezu.
- Iturburu-kodea alda dezakezu.
- Zure bertsio propioa bana dezakezu.
- Erabilera pertsonal eta komertzialerako.
- Egilea eta MIT lizentzia aipatu behar dituzu.

### Teknologiak eta zerbitzuak

- **Mapak:** OpenStreetMap eta bere laguntzaileak.
- **Eguraldi-datuak:** Open-Meteo, OpenWeather.
- **Eguraldi-ikonoak:** Erik Flowersen Weather Icons.
- **Liburutegiak:** Leaflet.js, SunCalc, GPX parser.
- **Aplikazio natiboa:** Capacitor (iOS / Android).
- **Ostatatzea:** Cloudflare Pages (web bertsioa bakarrik).
- **Scriptak:** Tampermonkey.

### Markak eta erantzukizuna

Bikemap, Komoot, OpenWeatherMaps, Openmeteo eta Hammerhead marka erregistratuak
dira. Lizentzia jabedun zehatzak izan ditzakete; mesedez, kode hau edo
argitaratutako web aplikazioa erabiltzen baduzu, bete egin behar dituzu.

Kode hau eta web aplikazioa «zero trust» motako segurtasuna kontuan hartuta
diseinatu dira, baina ez dira kode edo zerbitzu komertzial bat. Kodea eta web
aplikazioa dauden-daudenean ematen dira, inolako bermerik eta erantzukizunik
gabe. Hori onartzen duzu biltegi hau deskargatzen baduzu, kodea erabiltzen
baduzu edo web aplikazioa erabiltzen baduzu.

Aplikazio honi buruzko informazio eguneratua beti dago
[GitHub](https://github.com/lockevod/MeteoRide)-en. Aplikazio hau erabiltzen
baduzu, orri horretako informazio eguneratu, erantzukizun eta murrizketa
guztiak onartzen dituzu.

### Erantzukizunaren mugapena

MeteoRide planifikaziorako tresna bat da. Eguraldi-datuak estimazioak dira eta
baliteke guztiz zehatzak ez izatea. Erabili beti zure irizpidea eta egiaztatu
baldintzak irten aurretik. Garatzailea ez da informazio honetan oinarritutako
erabakien erantzule.

---

## 15. Laguntza eta ekarpenak

### Jakinarazi arazoak

- Ireki issue bat
  [GitHub biltegian](https://github.com/lockevod/MeteoRide/issues).
- Aktibatu debug botoia (🐞) **Ezarpenak → Erakutsi debug botoia** atalean:
  desaktibatuta dator.
- Adierazi zure gailua eta bertsioa, laguntza-orriaren behealdean agertzen
  dena.

### Lagundu proiektuari

- Egin biltegiaren fork bat GitHub-en.
- Jakinarazi akatsak edo proposatu hobekuntzak.
- Itzuli hizkuntza berrietara.
- Hobetu dokumentazioa.

Eguraldia azkar alda daiteke. Erabili MeteoRide gida gisa, baina izan malgua eta
ibili seguru zure irteeretan.
