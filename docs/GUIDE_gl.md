# Guía de usuario de MeteoRide

A axuda que levas dentro da app responde a «que fago». Esta guía responde a
«por que» e «que pasa se». Aquí está o detalle completo: os límites de cada
provedor, o que garda a app e onde, como se comporta sen cobertura e todas as
receitas de instalación.

Versión en castelán: [GUIA.md](GUIA.md) · English version: [GUIDE.md](GUIDE.md) · Axuda da app:
[help_gl.html](https://app.meteoride.cc/help_gl.html)

---

## 1. Que é MeteoRide

MeteoRide é unha aplicación para ciclistas —na web e como app de iPhone e
Android— que carga rutas GPX/KML e amosa a previsión ao longo do percorrido.

A app calcula os pasos da ruta a partir da velocidade de ciclismo que escollas
e pídelle a un ou varios provedores meteorolóxicos a temperatura, o vento, a
precipitación, a humidade, a nubosidade, a luminosidade e o índice UV para cada
un deses pasos. Inclúe alternativas automáticas para que haxa datos aínda que
un provedor falle, e permite comparar previsións de distintas fontes ou de dúas
datas distintas.

MeteoRide non edita a ruta: só a le.

---

## 2. Primeiros pasos

### 2.1 Cargar unha ruta GPX/KML

Preme o botón **📁** e escolle o teu ficheiro. Admítense tracks, rutas e
waypoints estándar de GPX e KML.

Tamén podes cargar unha ruta desde unha ligazón cos parámetros descritos en
[§9.4](#94-url-con-parámetros), ou compartila desde outra app se usas a app
nativa ([§6](#6-na-app-de-iphone-e-android)).

### 2.2 Data e hora

Escolle cando pensas facer a ruta. O sistema axusta a hora automaticamente a
intervalos de 15 minutos.

### 2.3 Velocidade

Introduce a túa velocidade media estimada ou usa unha das predefinidas: 5, 10,
12, 15 ou 20 km/h. Desa velocidade sae a hora á que estarás en cada punto, así
que é o que máis cambia o resultado.

### 2.4 Intervalo

Escolle cada canto queres ver información meteorolóxica: cada 15 ou 30 minutos.

### 2.5 Provedor

Escolle o provedor ou a cadea de provedores que queres usar. Están descritos en
[§4](#4-provedores-meteorolóxicos). Que ocorre se falla o que escolliches está
en [§9.3](#93-alternativas-intelixentes).

### 2.6 Modo Comparar provedores

Escolle **Comparar** no despregable de provedores para avaliar as diferenzas
entre provedores sobre a mesma ruta e a mesma hora.

- Le Open-Meteo e AROME exactamente igual ca a táboa normal, incluídos os datos
  de cuarto de hora dentro das primeiras 5 horas.
- Se un provedor non responde, o aviso di cal fallou en vez de amosar un erro
  xenérico.

### 2.7 Modo Comparar datas

Compara a previsión da mesma ruta en dúas datas ou horas distintas.

- Preme **⇄** xunto á data para entrar neste modo.
- Configura a Data A e a Data B; a segunda data aparece debaixo da primeira.
- Preme **⟲** para actualizar a táboa.
- A táboa amosa 4 filas: intervalos da Data A, resumo da Data A, intervalos da
  Data B, resumo da Data B.
- **Non hai recálculo automático.** Se cambias calquera control tes que premer
  ⟲ outra vez.

---

## 3. Cargar rutas desde outras webs (userscripts)

O proxecto inclúe dous userscripts opcionais de Tampermonkey. Non fan falta
para usar MeteoRide; son atallos para quen planifica noutras webs. As
instrucións de instalación están en [USERSCRIPTS.md](USERSCRIPTS.md).

- **Komoot / Bikemap / Hammerhead → MeteoRide**: engade un botón que abre a
  ruta que estás a ver directamente en MeteoRide. En Komoot a descarga do GPX só
  está dispoñible cunha conta **Premium**; sen ela o script non pode obter o
  ficheiro.
- **MeteoRide → Hammerhead**: engade un botón en MeteoRide que exporta o GPX
  actual a Hammerhead (dashboard.hammerhead.io). O script sobe o GPX en bruto a
  un share-server que configuras ti e pídelle a Hammerhead que importe esa URL.

---

## 4. Provedores meteorolóxicos

| Provedor | Clave API | Horizonte | Cobertura |
|---|---|---|---|
| Open-Meteo | Non | 14 días | Global |
| OpenWeather | Si (gratuíta) | 4 días | Global |
| AROME-HD | Non | 36 horas | Parte de Europa |

- **Open-Meteo**: gratuíto, sen clave, cobertura global, ata 14 días. Open-Meteo
  escolle o seu mellor modelo segundo a zona do teu track. Recomendado para
  calquera situación, e ideal para planificar a longo prazo e para rutas fóra
  de Europa.
- **OpenWeather**: require clave API, ata 4 días. Excelentes datos en tempo
  real, e é **o único provedor que publica alertas meteorolóxicas oficiais**
  ([§11](#11-alertas-meteorolóxicas-oficiais)). Ideal para saídas inmediatas e
  zonas urbanas.
- **AROME-HD**: modelo de alta resolución (~1-2 km) de MeteoFrance, accesible a
  través de Open-Meteo e sen clave. Só dispoñible para Europa
  (aprox. 39-52°N, 10.5°O-16.5°L) e dentro de 36 horas. Fóra desa zona ou dese
  prazo pasa directamente ao mellor modelo que Open-Meteo teña para esa
  localización, sen nada raro que avisar: segue habendo datos. Superior para o
  vento e a precipitación a curto prazo en Francia e nos países próximos.

### Cadeas de provedores

As cadeas combinan os puntos fortes de varios provedores dentro da mesma táboa:

- **OpenWeather → AROME-HD → Open-Meteo**: datos en tempo real de OpenWeather
  para a primeira hora, precisión hiperlocal de AROME para as 47 horas
  seguintes, e Open-Meteo para o resto da previsión. Require clave de
  OpenWeather; sen ela a opción aparece desactivada no selector.

Escolle segundo o que precises: precisión en tempo real (OpenWeather), precisión
local (AROME-HD) ou planificación a longo prazo (Open-Meteo).

---

## 5. Usala no navegador

A app web funciona en calquera navegador actual, no ordenador ou no móbil, en
<https://app.meteoride.cc>. Non hai nada que instalar.

Para a app de iPhone ou Android, instálaa desde a App Store ou co APK de GitHub;
os pasos están en [`docs/INSTALL.md`](INSTALL.md) (en inglés).

---

## 6. Na app de iPhone e Android

Isto só existe dentro da app nativa: son cousas que un navegador non pode facer.

### 6.1 Enviar a ruta a outra app

Cunha ruta cargada, o botón **📤** da barra superior abre a folla de compartir
do sistema co GPX anexo. Desde aí vai ao teu ciclocomputador (Hammerhead,
Wahoo), a Ficheiros, ao correo ou a onde queiras. O ficheiro non sae do
dispositivo en ningún momento: non hai servidor intermedio, a diferenza do
atallo de iOS que precisa a web.

### 6.2 Recibir unha ruta desde outra app

Tamén ao revés: en Komoot, Strava, Bikemap, Ficheiros ou o correo, comparte o
GPX e escolle **MeteoRide**. A app ábrese coa ruta xa cargada. Igual con «Abrir
en MeteoRide» desde un ficheiro descargado.

Se MeteoRide non aparece na folla de compartir a primeira vez, reinicia o
teléfono: o sistema tarda un pouco en rexistrar a app como destino.

### 6.3 Avisos se cambia o tempo da túa ruta

Unha previsión é unha estimación feita con horas de antelación. Cando calculas
unha ruta, a app segue vixiándoa e avísate se empeora para as horas en que vas
estar fóra:

- Estaba seco e aparece chuvia, ou a chuvia pasa a ser forte.
- Había calma e aparece vento moderado ou forte, ou refachos a partir duns
  43 km/h.
- Emítese un aviso oficial que coincide coa túa saída. Isto precisa unha clave
  de OpenWeather e ter activadas as alertas oficiais.

Cada cambio avísase unha soa vez; se despois empeora máis, volve avisar. As
melloras non se avisan, nin tampouco os tramos que xa percorriches. A
vixilancia remata unha hora despois do último punto da ruta.

Actívase e desactívase en **Axustes → Alertas → «Avisarme se cambia o tempo na
ruta»**, activado de inicio; debaixo, unha liña indica que ruta se está a
vixiar e ata cando.

**Convén sabelo:** a comprobación faina o sistema operativo cando lle parece,
non a app. No iPhone cómpre ter activada a *Actualización en segundo plano*
para MeteoRide (Axustes → Xeral; no iPhone, en castelán: Ajustes → General →
Actualización en segundo plano), e o modo de baixo consumo suspéndea. En
Android, algúns fabricantes matan as tarefas en segundo plano co seu propio
xestor de batería. Cando o sistema non a vai executar, a app dio debaixo do
interruptor en vez de deixarte crer que te está a vixiar.

### 6.4 Sen cobertura

O tempo non se pode inventar, pero o que xa se descargou non se tira:

- Ao abrir a app volve a última ruta coa súa táboa, sen cargar nada.
- Unha previsión antiga segue amosándose, marcada coas horas que ten. Deixa de
  facelo ás doce.
- O fondo do mapa precisa conexión. As teselas que miraches gárdanse só o tempo
  que permite o servidor do mapa (as condicións de OpenStreetMap prohiben o uso
  sen conexión), así que sen cobertura o fondo pode quedar en branco; o mapa
  indícao, e a ruta e a táboa seguen víndose.
- Cando non hai ningún dato, dio en vez de deixar unha pantalla baleira sen
  explicación.

O botón **📴** garda a previsión da ruta que teñas cargada e protéxea do borrado
automático da caché. Prémeo na casa antes de saír.

### 6.5 Mapa e axustes

- Sen ruta cargada, o mapa ábrese onde estás en lugar de en Barcelona.
- A app arranca no idioma do teléfono ata que escollas un a man.
- As unidades, o idioma, a túa clave API, as rutas recentes e as teselas que xa
  miraches gárdanse fóra do navegador interno, dunha forma que WebKit si
  conserva: non se perden cando o sistema libera espazo e no iPhone seguen aí
  ao volver abrir a app. Antes non era así.
- A primeira vez que o mapa te busca, o sistema pide o permiso de localización
  en nome de MeteoRide.
- O teléfono queda en vertical, porque ao xiralo rompe a disposición da
  pantalla. O iPad si xira.

---

## 7. Axustes

### 7.1 Claves API

Só OpenWeather precisa clave, e só se queres ese provedor ou as alertas
oficiais. Obtense de balde en
[openweathermap.org/api](https://openweathermap.org/api) (One Call API).

Xunto ao campo hai un botón **🔍 Comprobar**: a app fai unha petición simple e
amosa o estado ao lado (válida / non válida / cota / código HTTP). Úsao antes
de saír da casa se acabas de crear a clave; OpenWeather tarda un anaco en
activalas.

### 7.2 Avisos non críticos

A caixa **Amosar avisos non críticos** controla canto informan as
notificacións. Activada, verás faixas informativas cando se usen alternativas
por límites de horizonte, cota ou erros da API. Desactivada, só se amosan os
erros críticos.

### 7.3 Unidades

- **Vento:** km/h, m/s, mph
- **Temperatura:** °C, °F
- **Distancia:** km, mi
- **Precipitación:** mm, in

### 7.4 Idiomas

A aplicación está en castelán, inglés, catalán, galego, éuscaro, francés,
alemán, italiano e portugués. O idioma escollido cambia a interface e as
mensaxes. Na app nativa, ata que escollas un a man úsase o do teléfono.

### 7.5 Botón de debug

**Axustes → Amosar o botón de debug** activa o botón 🐞. Vén desactivado. Serve
para anexar información cando informas dun problema.

---

## 8. Interpretar os datos

### 8.1 A táboa meteorolóxica

A táboa amosa a información hora a hora:

- **Primeira fila:** hora e distancia acumulada.
- **Segunda fila:** iconas do tempo, con indicadores de cambio de provedor
  cando corresponda.
- **Temperatura:** en graos Celsius ou Fahrenheit.
- **Vento:** velocidade + frecha de dirección; os refachos entre parénteses.
- **Chuvia:** cantidade en mm/h **da hora na que vas pedalear** (probabilidade
  entre parénteses). Non é a lectura máis próxima ao minuto exacto do paso,
  senón a da hora completa durante a que vas percorrer ese tramo.
- **Humidade:** porcentaxe de humidade relativa.
- **Nubosidade:** porcentaxe de cobertura de nubes.
- **Luminosidade:** unha barra vertical xunto á icona do tempo, na segunda
  fila. Representa o 0-100% da luz dispoñible nese intervalo.
- **UV:** índice ultravioleta (número enteiro), na fila combinada «Nubes / UV».

### 8.2 Indicadores de cambio de provedor

Cando a fonte dos datos cambia durante a ruta verás unha etiqueta abreviada
enriba dos datos desa columna:

- **OPM** — Open-Meteo
- **ARM** — AROME-HD
- **OPW** — OpenWeather

Aparecen no modo normal, en comparar provedores e en comparar datas, e marcan
exactamente que provedor fornece os datos en cada segmento de tempo. Son
especialmente útiles coas cadeas, onde se combinan varias fontes.

### 8.3 O mapa

- **Frechas azuis:** vento suave (<12 km/h)
- **Frechas vermellas:** vento forte (30-50 km/h)
- **Frechas violetas:** vento moi forte (>50 km/h)
- **Pingas 💧:** precipitación prevista
- **Marcadores verde/vermello:** inicio e fin da ruta

---

## 9. Funcións avanzadas

### 9.1 Desprazamento horizontal da táboa

A táboa é interactiva e está adaptada a pantallas táctiles:

- Arrastra a táboa en horizontal ou usa a roda do rato para desprazar as
  columnas (xestos e *drag-to-scroll*).
- Fai clic en calquera columna —ou en calquera cela, para escoller esa
  columna— e destacaranse a fila e o mapa.
- O mapa céntrase no punto escollido se fas clic nunha frecha de vento ou na
  columna.
- Se a penúltima columna queda a menos de 5 minutos da última, a app agóchaa
  para evitar duplicados visuais.
- A pequena icona ⇆ indica que hai máis columnas dispoñibles ao desprazarte.

### 9.2 Información solar

A app amosa automaticamente:

- A hora da saída e da posta do sol.
- O crepúsculo civil, marcado con «c».
- A luminosidade calculada segundo a hora e as condicións.

### 9.3 Alternativas intelixentes

MeteoRide encárgase automaticamente de:

- Pasar a Open-Meteo, **só nos pasos afectados**, se o teu provedor supera o
  seu horizonte temporal, falla repetidamente ou non ten datos para ese punto.
- Reintentar cando hai erros temporais.
- Un aviso breve na cabeceira cando isto ocorre, se deixas activados os avisos
  non críticos en Axustes ([§7.2](#72-avisos-non-críticos)).

Cada petición ten un prazo: **15 segundos** para que o servidor empece a
responder e **outros 15 segundos** sen recibir datos mentres descarga. A un
provedor que deixa de responder non se lle volve preguntar nese mesmo cálculo:
os pasos restantes van directamente á alternativa en vez de agardar a que
esgote o prazo unha e outra vez.

### 9.4 URL con parámetros

Podes abrir MeteoRide coa ruta e os parámetros xa postos:

- `?gpx_url=https://example.com/route.gpx`
- `?datetime=2024-03-15T10:00`
- `?speed=25`

Pódense combinar. O navegador descarga o GPX directamente desa URL: MeteoRide
non o sobe a ningures.

### 9.5 Rutas recentes

MeteoRide garda localmente os últimos ficheiros GPX que cargaches para que
poidas recuperalos sen subir de novo o ficheiro.

- **Como usalo:** xunto ao botón 📁 hai un despregable coas túas rutas
  recentes. Escolle unha e cargarase exactamente coma se a acabases de subir.
- **Límite:** gárdanse as últimas **5** rutas. Se volves cargar unha ruta que
  xa estaba gardada, sobe ao principio da lista en vez de duplicarse.
- **Tamaño recomendado:** ata uns **750 KB** por GPX. Se o teu é bastante
  maior, recórtao ou alóxao nun servidor e cárgao con `?gpx_url=`.
- **Privacidade:** os GPX gárdanse no teu navegador con IndexedDB (ou
  localStorage como alternativa). Nunca se comparten fóra do teu dispositivo.
- **Eficiencia:** na memoria só se mantén a información básica (nome, tamaño e
  data); o contido completo só se le cando escolles a ruta.

### 9.6 Caché local e rendemento

As respostas dos provedores gárdanse en `localStorage` durante uns
**30 minutos** por paso/hora. Isto acelera as recargas frecuentes e reduce as
peticións ás API con límites de uso. Caduca soa: non hai nada que borrar a man.

---

## 10. Limitacións e consellos

### Limitacións

- **Horizonte temporal:** Open-Meteo 14 días, OpenWeather 4 días, AROME-HD
  36 horas.
- **Precisión:** as previsións son bastante menos fiables a partir do día 3-4.
- **API gratuítas:** Open-Meteo non require clave nin ten un límite práctico;
  OpenWeather ofrece unha modalidade gratuíta, pero as claves poden ter límites
  de uso mensuais.
- **MeteoRide non edita a ruta.** Só le o GPX/KML.

### Boas prácticas

- Usa rutas de 100-200 km como moito para un mellor rendemento.
- Planifica con 1-2 días de antelación para ter máis precisión.
- Combina información de varias fontes para as decisións importantes.
- Ten sempre un plan B para as condicións adversas.
- Leva roupa de chuvia aínda que a probabilidade sexa baixa.

---

## 11. Alertas meteorolóxicas oficiais

MeteoRide pode amosar os avisos e alertas oficiais que publican os servizos
meteorolóxicos nacionais, cando aparecen no array `alerts` de OpenWeather.

Para activalas: introduce a túa **clave API de OpenWeather** en Axustes e marca
**Amosar alertas meteorolóxicas oficiais**.

- **Dispoñibilidade:** require unha clave de OpenWeather, porque é o único
  provedor que as publica. Coa clave configurada, MeteoRide busca alertas aínda
  que OpenWeather non sexa o teu provedor principal. Sen clave, a caixa aparece
  desactivada e explica por que.
- **Visibilidade:** cando se detecta unha alerta aparece unha tarxeta
  informativa que se agocha soa aos 15 segundos. Queda ademais un indicador
  permanente **⚠️** que permite volver abrir todas as alertas detectadas.
- **Mostraxe e eficiencia:** para limitar as chamadas á API compróbase unha
  mostra representativa de puntos ao longo da ruta (aprox. 2/3 dos pasos,
  mínimo 3). As respostas das alertas gárdanse na caché local durante ~1 hora.
- **Ventá temporal:** só se teñen en conta as alertas cuxo período
  (inicio/fin) coincide coa ventá temporal do tramo correspondente da ruta,
  cunha tolerancia de ±1 hora arredor do paso.

> **Aviso importante.** Estas alertas ofrécense só como información. Non
> confíes unicamente nelas para tomar decisións de seguridade. Consulta sempre
> o servizo meteorolóxico oficial do teu país ou as autoridades competentes
> antes de facer unha actividade que poida verse afectada por condicións
> adversas. OpenWeather pode conter erros ou atrasos, ou omitir avisos locais
> específicos; MeteoRide non substitúe as comunicacións oficiais.

---

## 12. Solución de problemas

| Síntoma | Que revisar |
|---|---|
| O GPX/KML non carga | Comproba que o ficheiro contén tracks válidos. |
| Sen datos meteorolóxicos | Comproba a túa clave API con 🔍 Comprobar, ou cambia a Open-Meteo, que non precisa clave. |
| Data fóra de rango | Reduce o horizonte temporal: cada provedor ten o seu ([§4](#4-provedores-meteorolóxicos)). |
| Táboa baleira | Asegúrate de que a ruta é o bastante longa para polo menos un paso. |
| Unha ruta compartida non chega á app | Reinicia o teléfono a primeira vez ([§6.2](#62-recibir-unha-ruta-desde-outra-app)). |
| Non chegan os avisos de cambio de tempo | Le o que di a app debaixo do interruptor ([§6.3](#63-avisos-se-cambia-o-tempo-da-túa-ruta)). |

Para informar dun problema, activa o botón de debug ([§7.5](#75-botón-de-debug))
e indica o teu dispositivo e a versión, que aparece ao pé da páxina de axuda.

---

## 13. Privacidade e datos

A política en si —que recibe cada provedor, canto tempo o garda e como borrar
todo o que queda no dispositivo— é
[a da web](https://app.meteoride.cc/privacy-web-gl.html),
[a de iOS](https://app.meteoride.cc/privacy-ios-gl.html) e
[a de Android](https://app.meteoride.cc/privacy-android-gl.html): unha por plataforma,
que é a que se lle dá ao formulario de cada tenda, e as apps son máis pechadas
ca a web. Esta sección é o resumo; o que ten que estar ben é a política.

**MeteoRide funciona completamente no teu dispositivo.** Todos os axustes, as
preferencias e os datos gárdanse só no teu dispositivo: na web, no navegador
(localStorage e IndexedDB), e na app tamén no almacenamento propio do sistema,
para que iOS non poida borrar os axustes.

A única excepción é a web: se usas os Atallos de iOS para compartir un GPX, ese
ficheiro sóbese a Cloudflare. É imprescindible porque os Atallos de iOS só
admiten POST. Se abres o ficheiro directamente desde MeteoRide non se sobe
nada, porque se procesa en local, e a app nativa non precisa isto en absoluto.
En calquera caso, o GPX subido bórrase automaticamente nun prazo máximo de dous
minutos.

- **Sen rexistro:** non precisas crear unha conta nin dar datos persoais.
- **Control total:** na web, borra os datos do sitio desde os axustes do teu
  navegador; na app, desinstálaa (iPhone) ou borra o seu almacenamento
  (Android). A política da túa plataforma explica que pasa coas copias de
  seguridade.
- **Código aberto:** podes revisar todo o código fonte en GitHub.

### Datos compartidos cos provedores meteorolóxicos

Para obter as previsións, MeteoRide só comparte:

- As **coordenadas xeográficas** dos puntos da túa ruta.
- As **datas e horas** para as que precisas a previsión.
- **A túa clave API**, se usas OpenWeather.

Os provedores meteorolóxicos (Open-Meteo, OpenWeather) teñen as súas propias
políticas de privacidade. MeteoRide só actúa como un cliente que pide os datos
de previsión que precisas.

### Sobre a clave API

A clave gárdase no almacenamento local do teu dispositivo, **sen cifrar**. Iso
significa que, hipoteticamente, podería acceder a ela un terceiro con acceso ao
teu dispositivo ou outro script que se execute no teu navegador. O risco con
este tipo de claves é baixo, pero recoméndase usar unha clave gratuíta con
permisos mínimos. Como alternativa, podes non usar claves e confiar nos
provedores que non as requiren (Open-Meteo, AROME-HD).

### Que se garda localmente

- Os axustes de unidades e idioma.
- As claves API, sen cifrar.
- As preferencias de velocidade e intervalos.
- A caché temporal de datos meteorolóxicos (~30 minutos).
- As últimas 5 rutas GPX cargadas.
- Na app nativa, ademais, as teselas do mapa que miraches, cada unha ata a
  caducidade que lle deu o seu servidor.

Se precisas garantías de privacidade máis estritas, podes executar MeteoRide
completamente en local (abrindo `index.html` sen usar as funcións de
compartir/subir) ou despregar o teu propio share-server coas políticas de
acceso que decidas ([DEPLOY.md](DEPLOY.md)).

---

## 14. Licenza e créditos

Desenvolvido por [Lockevod](https://github.com/lockevod).

### Licenza

Este proxecto está baixo a **Licenza MIT**, o que significa que:

- Podes usar a aplicación libremente.
- Podes modificar o código fonte.
- Podes distribuír a túa propia versión.
- Para uso persoal e comercial.
- Tes que informar do autor e da licenza MIT.

### Tecnoloxías e servizos

- **Mapas:** OpenStreetMap e os seus colaboradores.
- **Datos meteorolóxicos:** Open-Meteo, OpenWeather.
- **Iconas meteorolóxicas:** Weather Icons de Erik Flowers.
- **Bibliotecas:** Leaflet.js, SunCalc, GPX parser.
- **App nativa:** Capacitor (iOS / Android).
- **Aloxamento:** Cloudflare Pages (só a versión web).
- **Scripts:** Tampermonkey.

### Marcas e responsabilidade

Bikemap, Komoot, OpenWeatherMaps, Openmeteo e Hammerhead son marcas rexistradas.
Poden ter licenzas propietarias específicas; se usas este código ou a
aplicación web publicada, debes cumprilas.

Este código e a aplicación web están deseñados pensando nunha seguridade de
tipo «zero trust», pero non son un código nin un servizo comerciais. O código e
a aplicación web ofrécense tal cal, sen ningunha garantía nin responsabilidade.
Acéptalo se descargas este repositorio, usas o código ou usas a aplicación web.

A información actualizada sobre esta aplicación está sempre en
[GitHub](https://github.com/lockevod/MeteoRide). Se usas esta aplicación,
aceptas toda a información actualizada, as responsabilidades e as restricións
desa páxina.

### Exención de responsabilidade

MeteoRide é unha ferramenta de planificación. Os datos meteorolóxicos son
estimacións e poden non ser completamente precisos. Usa sempre o teu criterio
e comproba as condicións antes de saír. O desenvolvedor non se fai responsable
das decisións baseadas nesta información.

---

## 15. Soporte e contribucións

### Informar de problemas

- Abre unha incidencia no
  [repositorio de GitHub](https://github.com/lockevod/MeteoRide/issues).
- Activa o botón de debug (🐞) en **Axustes → Amosar o botón de debug**: vén
  desactivado.
- Indica o teu dispositivo e a versión, que aparece ao pé da páxina de axuda.

### Contribuír

- Fai un fork do repositorio en GitHub.
- Informa de erros ou suxire melloras.
- Traduce a novos idiomas.
- Mellora a documentación.

O tempo pode cambiar rápido. Usa MeteoRide como guía, pero sé flexible e vai
con coidado nas túas saídas.
