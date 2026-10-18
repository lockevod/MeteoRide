# Guia d'usuari de MeteoRide

L'ajuda que portes dins de l'app respon al «què faig». Aquesta guia respon al
«per què» i al «què passa si». Aquí hi ha el detall complet: els límits de cada
proveïdor, què desa l'app i on, com es comporta sense cobertura i totes les
receptes d'instal·lació.

Versión en español: [GUIA.md](GUIA.md) · English version: [GUIDE.md](GUIDE.md) · Ajuda de l'app:
[help_ca.html](https://app.meteoride.cc/help_ca.html)

---

## 1. Què és MeteoRide

MeteoRide és una aplicació per a ciclistes —al web i com a app per a iPhone i
Android— que carrega rutes GPX/KML i mostra la previsió al llarg del recorregut.

L'app calcula els passos de la ruta a partir de la velocitat de ciclisme que
triïs i demana a un o diversos proveïdors meteorològics la temperatura, el vent,
la precipitació, la humitat, la nuvolositat, la lluminositat i l'índex UV per a
cadascun d'aquests passos. Inclou alternatives automàtiques perquè tinguis dades
encara que un proveïdor falli, i permet comparar previsions de fonts diferents o
de dues dates diferents.

MeteoRide no edita la ruta: només la llegeix.

---

## 2. Primers passos

### 2.1 Carregar una ruta GPX/KML

Prem el botó **📁** i tria el fitxer. S'admeten traces, rutes i waypoints
estàndard de GPX i KML.

També pots carregar una ruta des d'un enllaç amb els paràmetres descrits a
[§9.4](#94-url-amb-paràmetres), o compartir-la des d'una altra app si fas servir
l'app nativa ([§6](#6-a-lapp-diphone-i-android)).

### 2.2 Data i hora

Selecciona quan penses sortir. El sistema ajusta automàticament l'hora a
intervals de 15 minuts.

### 2.3 Velocitat

Introdueix la teva velocitat mitjana estimada o fes servir una de les
predefinides: 5, 10, 12, 15 o 20 km/h. D'aquesta velocitat surt l'hora a la qual
seràs a cada punt, així que és el que més canvia el resultat.

### 2.4 Interval

Tria cada quant vols informació meteorològica: cada 15 o 30 minuts.

### 2.5 Proveïdor

Tria el proveïdor o la cadena de proveïdors que vols fer servir. Estan descrits
a [§4](#4-proveïdors-meteorològics). Què passa si el que has triat falla és a
[§9.3](#93-alternatives-intelligents).

### 2.6 Mode Comparar proveïdors (Comp.)

Marca **Comp.** per avaluar les diferències entre proveïdors sobre la mateixa
ruta i la mateixa hora.

- Llegeix Open-Meteo i AROME exactament igual que la taula normal, incloses les
  dades de quart d'hora dins de les primeres 5 hores.
- Si un proveïdor no respon, l'avís diu quin ha fallat en lloc de mostrar un
  error genèric.

### 2.7 Mode Comparar dates

Compara la previsió de la mateixa ruta en dues dates o hores diferents.

- Selecciona **Comparar dates** al desplegable de proveïdors per entrar en
  aquest mode.
- Configura la data A i la data B amb els controls de data/hora que apareixen.
  Els botons només amb icones despleguen la segona data.
- Prem **🔄 Comparar** per actualitzar la taula.
- La taula mostra 4 files: intervals de la data A, resum de la data A,
  intervals de la data B, resum de la data B.
- **No es recalcula automàticament.** Si canvies qualsevol control, has de
  tornar a prémer Comparar.

---

## 3. Carregar rutes des d'altres webs (userscripts)

El projecte inclou dos userscripts opcionals de Tampermonkey. No calen per fer
servir MeteoRide; són dreceres per a qui planifica en altres webs. Les
instruccions d'instal·lació són a [USERSCRIPTS.md](USERSCRIPTS.md).

- **Komoot / Bikemap / Hammerhead → MeteoRide**: afegeix un botó que obre la
  ruta que estàs veient directament a MeteoRide. A Komoot, la descàrrega del GPX
  només està disponible amb un compte **Premium**; sense, l'script no pot
  obtenir el fitxer.
- **MeteoRide → Hammerhead**: afegeix un botó a MeteoRide que exporta el GPX
  actual a Hammerhead (dashboard.hammerhead.io). L'script puja el GPX en brut a
  un share-server que configures tu i demana a Hammerhead que importi aquesta
  URL.

---

## 4. Proveïdors meteorològics

| Proveïdor | Clau API | Horitzó | Cobertura |
|---|---|---|---|
| Open-Meteo | No | 14 dies | Global |
| OpenWeather | Sí (gratuïta) | 4 dies | Global |
| AROME-HD | No | 36 hores | Part d'Europa |

- **Open-Meteo**: gratuït, sense clau, cobertura global, fins a 14 dies.
  Open-Meteo tria el seu millor model per a la zona de la teva traça.
  Recomanat per a qualsevol situació, i ideal per planificar a llarg termini i
  per a rutes fora d'Europa.
- **OpenWeather**: necessita clau API, fins a 4 dies. Dades excel·lents en temps
  real, i és **l'únic proveïdor que publica alertes meteorològiques oficials**
  ([§11](#11-alertes-meteorològiques-oficials)). El millor per a sortides
  immediates i zones urbanes.
- **AROME-HD**: model d'alta resolució (~1-2 km) de MeteoFrance, accessible a
  través d'Open-Meteo i sense clau. Només disponible per a Europa
  (aprox. 39-52°N, 10.5°O-16.5°E) i dins de 36 hores. Fora d'aquesta zona o
  d'aquest termini passa directament al millor model que Open-Meteo tingui per a
  aquella ubicació, sense res estrany a avisar: continua havent-hi dades.
  Superior per al vent i la precipitació a curt termini a França i països
  propers.

### Cadenes de proveïdors

Les cadenes combinen els punts forts de diversos proveïdors dins de la mateixa
taula:

- **OpenWeather → AROME-HD → Open-Meteo**: dades en temps real d'OpenWeather per
  a la primera hora, precisió hiperlocal d'AROME per a les 47 hores següents, i
  Open-Meteo per a la resta de la previsió. Necessita una clau d'OpenWeather;
  sense, l'opció surt desactivada al selector.

Tria segons el que necessitis: precisió en temps real (OpenWeather), precisió
local (AROME-HD) o planificació a llarg termini (Open-Meteo).

---

## 5. Instal·lar com a app web (PWA)

El web de MeteoRide es pot instal·lar com a aplicació web progressiva (PWA) per
tenir una experiència semblant a la d'una app nativa. Necessites el web
desplegat en un servidor, o fer servir <https://app.meteoride.cc>.

Si el que vols és l'app nativa d'iPhone o Android, no necessites res d'això:
instal·la-la des de la botiga.

Aquests mateixos passos, i les altres maneres de tenir MeteoRide, també són a
[`docs/INSTALL.md`](INSTALL.md) (en anglès).

**Android**

1. Obre MeteoRide a Chrome.
2. Toca el menú (tres punts) a la part superior dreta.
3. Selecciona «Afegir a la pantalla d'inici».
4. Confirma tocant «Afegir».

**iOS (iPhone/iPad)**

1. Obre MeteoRide a Safari.
2. Toca el botó Compartir (quadrat amb fletxa).
3. Selecciona «Afegir a la pantalla d'inici».
4. Toca «Afegir» a la part superior dreta.

**Chrome a l'ordinador**

1. Obre MeteoRide a Chrome.
2. Fes clic a la icona d'instal·lar de la barra d'adreces o al menú.
3. Fes clic a «Instal·lar».

**Edge a l'ordinador**

1. Obre MeteoRide a Edge.
2. Fes clic a la icona d'instal·lar de la barra d'adreces.
3. Fes clic a «Instal·lar».

**Safari al Mac**

1. Obre MeteoRide a Safari.
2. Ves a Fitxer > Afegir al Dock.
3. O fes clic al botó Compartir i selecciona «Afegir al Dock».

---

## 6. A l'app d'iPhone i Android

Això només existeix dins de l'app nativa: són coses que un navegador no pot fer.

### 6.1 Enviar la ruta a una altra app

Amb una ruta carregada, el botó **📤** de la barra superior obre el full de
compartir del sistema amb el GPX adjunt. Des d'allà va al teu ciclocomputador
(Hammerhead, Wahoo), a Fitxers, al correu o on vulguis. El fitxer no surt mai
del dispositiu: no hi ha cap servidor intermedi, a diferència de la drecera
d'iOS que necessita el web.

### 6.2 Rebre una ruta des d'una altra app

També a l'inrevés: a Komoot, Strava, Bikemap, Fitxers o el correu, comparteix el
GPX i tria **MeteoRide**. L'app s'obre amb la ruta ja carregada. El mateix amb
«Obrir a MeteoRide» des d'un fitxer descarregat.

Si MeteoRide no apareix al full de compartir la primera vegada, reinicia el
telèfon: el sistema triga una mica a registrar l'app com a destinació.

### 6.3 Avisos si canvia el temps de la teva ruta

Una previsió és una estimació feta amb hores d'antelació. Quan calcules una
ruta, l'app la continua vigilant i t'avisa si empitjora per a les hores que
seràs fora:

- Feia sec i apareix pluja, o la pluja passa a ser forta.
- Hi havia calma i apareix vent moderat o fort, o ratxes a partir d'uns
  43 km/h.
- S'emet un avís oficial que coincideix amb la teva sortida. Això necessita una
  clau d'OpenWeather i les alertes oficials activades.

Cada canvi s'avisa una sola vegada; si després empitjora més, torna a avisar.
Les millores no s'avisen, i els trams que ja has fet tampoc. La vigilància acaba
una hora després de l'últim punt de la ruta.

S'activa i es desactiva a **Configuració → Alertes → «Avisa'm si canvia el temps
de la ruta»**, activat per defecte, on una línia a sota diu quina ruta s'està
vigilant i fins quan.

**Bo de saber:** la comprovació la fa el sistema operatiu quan li sembla, no
l'app. A l'iPhone cal tenir activada l'Actualització en segon pla per a
MeteoRide (Configuració → General), i el mode de baix consum la suspèn. A
Android, alguns fabricants maten les tasques en segon pla amb el seu propi
gestor de bateria. Quan el sistema no l'executarà, l'app ho diu sota
l'interruptor en lloc de deixar-te creure que t'està vigilant.

### 6.4 Sense cobertura

El temps no es pot inventar, però el que ja s'ha descarregat no es llença:

- En obrir l'app torna l'última ruta amb la seva taula, sense haver de carregar
  res.
- Una previsió antiga es continua mostrant, amb una etiqueta que diu quantes
  hores té. Deixa de fer-ho a les dotze.
- El fons del mapa necessita connexió. Les tessel·les que has mirat només es
  guarden el temps que permet el servidor del mapa (les condicions
  d'OpenStreetMap prohibeixen l'ús sense connexió), així que sense cobertura el
  fons pot quedar en blanc; el mapa ho indica, i la ruta i la taula es continuen
  veient.
- Quan no hi ha cap dada, ho diu en lloc de deixar una pantalla buida sense cap
  explicació.

El botó **📴** desa la previsió de la ruta que tens carregada i la protegeix de
la neteja automàtica de la memòria cau. Prem-lo a casa abans de sortir.

### 6.5 Mapa i configuració

- Sense cap ruta carregada, el mapa s'obre on ets en lloc de a Barcelona.
- L'app arrenca en l'idioma del telèfon fins que en triïs un a mà.
- Les unitats, l'idioma, la teva clau API, les rutes recents i les tessel·les
  que ja has mirat es desen fora del navegador intern, d'una manera que WebKit sí
  que conserva: no es perden quan el sistema allibera espai i a l'iPhone
  continuen allà quan tornes a obrir l'app. Abans no.
- La primera vegada que el mapa et busca, el sistema demana el permís
  d'ubicació en nom de MeteoRide.
- El telèfon es queda en vertical, perquè en girar-lo es trenca la pantalla.
  L'iPad sí que gira.

---

## 7. Configuració

### 7.1 Claus API

Només OpenWeather necessita clau, i només si vols aquest proveïdor o les alertes
oficials. S'obté gratis a
[openweathermap.org/api](https://openweathermap.org/api) (One Call API).

Al costat del camp hi ha un botó **🔍 Comprovar**: l'app fa una petició senzilla
i mostra l'estat al costat (vàlida / no vàlida / quota / codi HTTP). Fes-lo
servir abans de sortir de casa si acabes de crear la clau; OpenWeather triga una
estona a activar-les.

### 7.2 Avisos no crítics

La casella **Mostrar avisos no crítics** controla la quantitat de notificacions.
Activada, veuràs bàners informatius quan es facin servir alternatives per límits
d'horitzó, quota o errors d'API. Desactivada, només es mostren els errors
crítics.

### 7.3 Unitats

- **Vent:** km/h, m/s, mph
- **Temperatura:** °C, °F
- **Distància:** km, mi
- **Precipitació:** mm, in

### 7.4 Idiomes

L'aplicació està en castellà, anglès, català, gallec, basc, francès, alemany,
italià i portuguès. L'idioma triat canvia la interfície i els missatges. A l'app
nativa, fins que en triïs un a mà es fa servir el del telèfon.

### 7.5 Botó de debug

**Configuració → Mostrar el botó de debug** activa el botó 🐞. De sèrie està
desactivat. Serveix per adjuntar informació quan informes d'un problema.

---

## 8. Interpretar les dades

### 8.1 La taula meteorològica

La taula mostra la informació hora a hora:

- **Primera fila:** hora i distància acumulada.
- **Segona fila:** icones del temps, amb indicadors de canvi de proveïdor quan
  correspongui.
- **Temperatura:** en graus Celsius o Fahrenheit.
- **Vent:** velocitat + fletxa de direcció; les ratxes entre parèntesis.
- **Pluja:** quantitat en mm/h **de l'hora en què estaràs pedalant**
  (probabilitat entre parèntesis). No és la lectura més propera al minut exacte
  del pas, sinó la de l'hora sencera en què faràs aquell tram.
- **Humitat:** percentatge d'humitat relativa.
- **Nuvolositat:** percentatge de cobertura de núvols.
- **Lluminositat:** una barra vertical al costat de la icona del temps, a la
  segona fila. Representa el 0-100% de llum disponible en aquell interval.
- **UV:** índex ultraviolat (nombre enter), a la fila combinada «Núvols / UV».

### 8.2 Indicadors de canvi de proveïdor

Quan la font de dades canvia durant la ruta, veuràs una etiqueta abreujada
damunt de les dades d'aquella columna:

- **OPM** — Open-Meteo
- **ARM** — AROME-HD
- **OPW** — OpenWeather

Apareixen en el mode normal, en comparar proveïdors i en comparar dates, i
marquen exactament quin proveïdor dona les dades a cada segment de temps. Són
especialment útils amb les cadenes, on es combinen diverses fonts.

### 8.3 El mapa

- **Fletxes blaves:** vent fluix (<12 km/h)
- **Fletxes vermelles:** vent fort (30-50 km/h)
- **Fletxes liles:** vent molt fort (>50 km/h)
- **Gotes 💧:** precipitació prevista
- **Marcadors verd/vermell:** inici i final de la ruta

---

## 9. Funcions avançades

### 9.1 Desplaçament horitzontal de la taula

La taula és interactiva i està pensada per a pantalles tàctils:

- Arrossega la taula horitzontalment o fes servir la roda del ratolí per
  desplaçar les columnes (gestos i *drag-to-scroll*).
- Fes clic a qualsevol columna —o a qualsevol cel·la, per seleccionar aquella
  columna— i es destaquen la fila i el mapa.
- El mapa es recentra en el punt seleccionat si fas clic en una fletxa de vent o
  en la columna.
- Si la penúltima columna queda a menys de 5 minuts de l'última, l'app l'amaga
  per evitar duplicats visuals.
- La petita icona ⇆ indica que hi ha més columnes en desplaçar-te.

### 9.2 Informació solar

L'app mostra automàticament:

- L'hora de sortida i de posta del sol.
- El crepuscle civil, marcat amb «c».
- La lluminositat calculada segons l'hora i les condicions.

### 9.3 Alternatives intel·ligents

MeteoRide gestiona automàticament:

- El canvi a Open-Meteo, **només per als passos afectats**, si el teu proveïdor
  supera el seu horitzó, falla repetidament o no té dades per a aquell punt.
- Els reintents quan hi ha errors temporals.
- Un avís breu a la capçalera quan passa això, si deixes activats els avisos no
  crítics a Configuració ([§7.2](#72-avisos-no-crítics)).

Cada petició té un termini: **15 segons** perquè el servidor comenci a respondre
i **15 segons més** sense rebre dades mentre es descarrega. A un proveïdor que
deixa de respondre no se li torna a preguntar en aquest mateix càlcul: els
passos que queden van directament a l'alternativa en lloc d'esperar que esgoti
el termini una vegada i una altra.

### 9.4 URL amb paràmetres

Pots obrir MeteoRide amb la ruta i els paràmetres ja posats:

- `?gpx_url=https://example.com/route.gpx`
- `?datetime=2024-03-15T10:00`
- `?speed=25`

Es poden combinar. El navegador descarrega el GPX directament d'aquesta URL:
MeteoRide no el puja enlloc.

### 9.5 Rutes recents

MeteoRide desa localment els últims GPX que has carregat perquè els puguis
recuperar sense tornar a pujar el fitxer.

- **Com fer-ho servir:** al costat del botó 📁 hi ha un desplegable amb les teves
  rutes recents. Tria'n una i es carrega exactament com si l'acabessis de pujar.
- **Límit:** es desen les **5** últimes rutes. Si tornes a carregar una ruta que
  ja estava desada, puja al capdamunt de la llista en lloc de duplicar-se.
- **Mida recomanada:** fins a uns **750 KB** per GPX. Si el teu és força més
  gran, retalla'l o allotja'l i carrega'l amb `?gpx_url=`.
- **Privadesa:** els GPX es desen al teu navegador amb IndexedDB (o
  localStorage com a alternativa). No es comparteixen mai fora del dispositiu.
- **Eficiència:** a la memòria només es manté la informació bàsica (nom, mida i
  data); el contingut complet només es llegeix quan selecciones la ruta.

### 9.6 Memòria cau local i rendiment

Les respostes dels proveïdors es desen a `localStorage` durant uns
**30 minuts** per pas/hora. Això accelera les recàrregues freqüents i redueix les
peticions a API amb límits d'ús. Caduca sola: no cal esborrar res a mà.

---

## 10. Limitacions i consells

### Limitacions

- **Horitzó temporal:** Open-Meteo 14 dies, OpenWeather 4 dies, AROME-HD
  36 hores.
- **Precisió:** les previsions són força menys fiables a partir del dia 3-4.
- **API gratuïtes:** Open-Meteo no necessita clau i no té cap límit pràctic;
  OpenWeather ofereix una modalitat gratuïta, però les claus poden tenir límits
  d'ús mensuals.
- **MeteoRide no edita la ruta.** Només llegeix el GPX/KML.

### Bones pràctiques

- Fes servir rutes de 100-200 km com a màxim per a un millor rendiment.
- Planifica amb 1-2 dies d'antelació per tenir més precisió.
- Combina informació de diverses fonts per a les decisions importants.
- Tingues sempre un pla B per a condicions adverses.
- Porta roba de pluja encara que la probabilitat sigui baixa.

---

## 11. Alertes meteorològiques oficials

MeteoRide pot mostrar els avisos i les alertes oficials que publiquen els serveis
meteorològics nacionals, quan apareixen a l'array `alerts` d'OpenWeather.

Per activar-les: introdueix la teva **OpenWeather API Key** a Configuració i
marca **Mostrar alertes meteorològiques oficials**.

- **Disponibilitat:** necessita una clau d'OpenWeather, perquè és l'únic
  proveïdor que les publica. Amb la clau configurada, MeteoRide comprova les
  alertes encara que OpenWeather no sigui el teu proveïdor principal. Sense
  clau, la casella està desactivada i diu per què.
- **Visibilitat:** quan es detecta una alerta apareix una targeta informativa
  que s'amaga sola al cap de 15 segons. Queda un indicador **⚠️** persistent a
  la interfície perquè puguis tornar a obrir totes les alertes detectades.
- **Mostreig i eficiència:** per limitar les crides a l'API es comprova una
  mostra representativa de punts al llarg de la ruta (aprox. 2/3 dels passos,
  mínim 3). Les respostes d'alertes es desen a la memòria cau local durant
  ~1 hora.
- **Finestra temporal:** només es tenen en compte les alertes el període de les
  quals (start/end) coincideix amb la finestra temporal del tram corresponent
  de la ruta, amb una tolerància de ±1 hora al voltant del pas.

> **Avís important.** Aquestes alertes es donen només com a informació
> addicional. No hi confiïs exclusivament per a decisions de seguretat.
> Consulta sempre el servei meteorològic oficial del teu país o les autoritats
> competents abans de fer una activitat que es pugui veure afectada per
> condicions adverses. OpenWeather pot contenir errors o retards, o ometre avisos
> locals específics; MeteoRide no substitueix les comunicacions oficials.

---

## 12. Resolució de problemes

| Símptoma | Què cal mirar |
|---|---|
| El GPX/KML no es carrega | Comprova que el fitxer conté traces vàlides. |
| No hi ha dades meteorològiques | Comprova la clau API amb 🔍 Comprovar, o canvia a Open-Meteo, que no necessita clau. |
| Data fora de rang | Redueix l'horitzó temporal: cada proveïdor té el seu ([§4](#4-proveïdors-meteorològics)). |
| Taula buida | Assegura't que la ruta és prou llarga per a un pas com a mínim. |
| Una ruta compartida no arriba a l'app | Reinicia el telèfon la primera vegada ([§6.2](#62-rebre-una-ruta-des-duna-altra-app)). |
| No arriben els avisos de canvi de temps | Llegeix el que diu l'app sota l'interruptor ([§6.3](#63-avisos-si-canvia-el-temps-de-la-teva-ruta)). |

Per informar d'un problema, activa el botó de debug ([§7.5](#75-botó-de-debug)) i
indica el teu dispositiu i la versió, que surt al peu de la pàgina d'ajuda.

---

## 13. Privadesa i dades

La política en si — què rep cada proveïdor, quant de temps ho conserva i com
esborrar tot el que queda al dispositiu — és
[la del web](https://app.meteoride.cc/privacy-web-ca.html),
[la d'iOS](https://app.meteoride.cc/privacy-ios-ca.html) i
[la d'Android](https://app.meteoride.cc/privacy-android-ca.html) — una per plataforma, que
és el que es dona a cada botiga, i les apps són més tancades que el web. Aquesta
secció és el resum; la que ha d'estar bé és la política.

**MeteoRide funciona completament al teu dispositiu.** Tota la configuració, les
preferències i les dades es desen només al teu navegador, amb localStorage i
IndexedDB.

L'única excepció és el web: si fas servir les Dreceres d'iOS per compartir un
GPX, aquest fitxer es puja a Cloudflare. És inevitable perquè les Dreceres d'iOS
només accepten POST. Si obres el fitxer directament des de MeteoRide no es puja
res, perquè es processa en local, i l'app nativa no ho necessita gens. En
qualsevol cas, el GPX pujat s'esborra automàticament en dos minuts com a màxim.

- **Sense compte:** no cal crear cap compte ni donar dades personals.
- **Control total:** pots esborrar totes les dades desades des de la
  configuració del navegador.
- **Codi obert:** pots inspeccionar tot el codi font a GitHub.

### Dades compartides amb els proveïdors meteorològics

Per obtenir les previsions, MeteoRide només comparteix:

- Les **coordenades geogràfiques** dels punts de la teva ruta.
- Les **dates i hores** per a les quals necessites la previsió.
- **La teva clau API**, si fas servir OpenWeather.

Els proveïdors meteorològics (Open-Meteo, OpenWeather) tenen les seves pròpies
polítiques de privadesa. MeteoRide només actua com a client que demana les dades
de previsió que necessites.

### Sobre la clau API

La clau es desa a l'emmagatzematge local del teu dispositiu, **sense xifrar**.
Això vol dir que, hipotèticament, hi podria accedir un tercer amb accés al teu
dispositiu, o un altre script que s'executi al teu navegador. El risc amb aquest
tipus de claus és baix, però es recomana fer servir una clau gratuïta amb els
mínims permisos. També pots prescindir de claus i fer servir els proveïdors que
no en necessiten (Open-Meteo, AROME-HD).

### Què es desa localment

- La configuració d'unitats i idioma.
- Les claus API, sense xifrar.
- Les preferències de velocitat i interval.
- Una memòria cau temporal de dades meteorològiques (~30 minuts).
- Les 5 últimes rutes GPX carregades.
- A l'app nativa, també les tessel·les del mapa que has mirat, cadascuna fins a
  la caducitat que li va donar el seu servidor.

Si necessites garanties de privadesa més estrictes, pots executar MeteoRide
completament en local (obrint `index.html` sense fer servir les funcions de
compartir/pujar) o desplegar el teu propi share-server amb les polítiques
d'accés que decideixis ([DEPLOY.md](DEPLOY.md)).

---

## 14. Llicència i crèdits

Desenvolupat per [Lockevod](https://github.com/lockevod).

### Llicència

Aquest projecte té la **llicència MIT**, que vol dir que:

- Pots fer servir l'aplicació lliurement.
- Pots modificar el codi font.
- Pots distribuir la teva pròpia versió.
- Per a ús personal i comercial.
- Has d'informar de l'autor i de la llicència MIT.

### Tecnologies i serveis

- **Mapes:** OpenStreetMap i els seus col·laboradors.
- **Dades meteorològiques:** Open-Meteo, OpenWeather.
- **Icones meteorològiques:** Weather Icons d'Erik Flowers.
- **Biblioteques:** Leaflet.js, SunCalc, GPX parser.
- **App nativa:** Capacitor (iOS / Android).
- **Allotjament:** Cloudflare Pages (només la versió web).
- **Scripts:** Tampermonkey.

### Marques i responsabilitat

Bikemap, Komoot, OpenWeatherMaps, Openmeteo i Hammerhead són marques
registrades. Poden tenir llicències propietàries específiques; si fas servir
aquest codi o l'aplicació web publicada, les has de complir.

Aquest codi i l'aplicació web estan dissenyats pensant en una seguretat de tipus
«zero trust», però no són codi ni un servei comercial. El codi i l'aplicació web
s'ofereixen tal com són, sense cap garantia ni responsabilitat. Ho acceptes si
descarregues aquest repositori, fas servir el codi o fas servir l'aplicació web.

La informació actualitzada sobre aquesta app és sempre a
[GitHub](https://github.com/lockevod/MeteoRide). Si fas servir aquesta app,
acceptes tota la informació actualitzada, les responsabilitats i les
restriccions d'aquella pàgina.

### Exempció de responsabilitat

MeteoRide és una eina de planificació. Les dades meteorològiques són estimacions
i poden no ser del tot precises. Fes servir sempre el teu criteri i comprova les
condicions abans de sortir. El desenvolupador no es fa responsable de les
decisions basades en aquesta informació.

---

## 15. Suport i contribucions

### Informar de problemes

- Obre una incidència al
  [repositori de GitHub](https://github.com/lockevod/MeteoRide/issues).
- Activa el botó de debug (🐞) a **Configuració → Mostrar el botó de debug**: de
  sèrie està desactivat.
- Indica el teu dispositiu i la versió, que surt al peu de la pàgina d'ajuda.

### Contribuir

- Fes un fork del repositori a GitHub.
- Informa d'errors o suggereix millores.
- Tradueix a nous idiomes.
- Millora la documentació.

El temps pot canviar de pressa. Fes servir MeteoRide com a guia, però sigues
flexible i prudent a les teves sortides.
