# MeteoRide — memoria de traspaso (app nativa iOS/Android)

Documento para retomar el trabajo con otra persona o asistente. Resume qué se ha
hecho, por qué, qué está verificado y qué no, y qué queda. El detalle técnico y las
decisiones de diseño están en `AGENTS.md` (leerlo entero antes de tocar código);
los pasos de Xcode en `docs/IOS.md`; Android en `docs/ANDROID.md`.

## 1. Qué es esto

MeteoRide es una web app (vanilla JS, sin bundler) que pinta el tiempo previsto a lo
largo de una ruta GPX en función de la hora de salida y la velocidad. Vive en
`public/` y se sirve en Cloudflare Pages (`functions/` para `/share`). El trabajo de
esta rama la convierte además en app nativa iOS y Android con **Capacitor 8.5.2**,
sin segundo código: el mismo `public/` va dentro de la app.

- Rama: `main`. Todo lo de abajo está fusionado ahí (PR #1, `baf7f8e`, 16/09/2026);
  la rama `native-ios-capacitor` ya no existe.
- Commits firmados como `Enderthor <58392928+lockevod@users.noreply.github.com>`,
  sin líneas de atribución de ningún asistente. Mantenerlo así.
- Proyecto móvil: `mobile/`. `mobile/ios/` **no está en git** (se genera con
  `npm run add:ios` y se configura a mano, sección 5). `mobile/android/` sí está.

## 2. Cómo construir y probar

```bash
cd mobile
npm install                 # aplica también un parche a un plugin (sección 4)
npm test                    # build de www + tests Node + Playwright
npm run ios                 # build + cap sync + abre Xcode
npm run android             # build + cap sync + abre Android Studio
```

- El build (`scripts/build-www.mjs`) copia `public/` a `www/`, vendoriza las
  librerías de CDN desde `node_modules`, mete una CSP en `<meta>`, quita SEO y el
  enlace de donación, ensambla el runner de segundo plano y **falla** si queda alguna
  referencia remota o el enlace de donación.
- Playwright necesita Chromium; en máquinas sin descarga: `CHROMIUM_PATH=/ruta/chromium`.
- `npm test` reconstruye `www`; `npx playwright test` a secas **no**. Nunca dos suites
  a la vez (comparten puerto 4173 y `www/`).
- Cada test se ha comprobado con mutación (se rompe el código y el test falla). Si se
  añade uno, hacer lo mismo.

## 3. Qué hay hecho (funcional)

| Capacidad | Dónde | Estado |
|---|---|---|
| Shell nativo: barra de estado, splash, enlaces externos al navegador, botón atrás Android, safe areas | `public/scripts/native.js`, `public/style.css` (`html.cw-native`) | probado en Chromium; iOS visto en simulador por el autor |
| Recibir GPX/KML desde otras apps (share sheet, "Abrir en") | iOS: `mobile/native/ios/**` (`CFBundleDocumentTypes` + `SceneDelegate` + App Group + plugin; **sin share extension**, ver §10). Android: `mobile/android/.../MainActivity.java`, `MeteoRideShareStore.java`, `MeteoRideSharePlugin.java`, intent filters | JS probado; Swift **nunca compilado**; Java compila contra stubs |
| Enviar la ruta cargada a otra app (Hammerhead, Files…) | botón 📤 en `native.js` (Filesystem CACHE + Share) | probado |
| Ajustes persistentes fuera del web view | `cwSettings` espejado a Preferences; restore al arrancar | probado |
| Sin cobertura: último pronóstico (≤12 h) etiquetado, ruta restaurada al abrir, botón 📴 que fija la caché, teselas vistas guardadas hasta su caducidad (IndexedDB, política de OSM), aviso "mapa sin conexión", mensajes de proveedor caído | `public/scripts/utils.js`, `tile-cache.js`, `native.js` | probado; CORS de teselas OSM **sin verificar en dispositivo** |
| Mapa centrado en la posición del móvil si no hay ruta | `native.js` `centreOnUser` | probado |
| **Alertas de ruta** en segundo plano (lluvia nueva, viento, avisos oficiales) con toggle | ver sección 4 | JS y runner probados en Node; nativo sin ejecutar |
| Seguridad: CSP web y app, sanitizado de GPX, `/share` endurecido, sin enlace de pago en la app | `public/_headers`, `functions/`, `gpx-share.js`, build | probado |

## 4. Alertas de ruta (lo último y lo más delicado)

Flujo: al calcular un pronóstico, `app.js` emite `cw:forecast`; `native.js` construye
un "watch" (hasta 12 puntos con hora y km, ventana de la salida, idioma, clave OW si
hay) y **siembra la línea base con la misma petición a Open-Meteo que hará el runner**
(comparar la tabla de otro proveedor daría falsos cambios). Lo guarda en el runner
con `BackgroundRunner.dispatchEvent('saveWatch')`. El sistema ejecuta `checkWatch`
(`mobile/runners/watch.js` + `public/scripts/watch-rules.js`, ensamblados en
`www/runners/watch.js`) cada ~30 min cuando quiere; si un paso sube de nivel
(seco→lluvia ≥0,3 mm/h, lluvia→fuerte ≥3; calma→moderado ≥20 km/h, →fuerte ≥35 o
rachas ≥55, con margen) o aparece un aviso oficial de OpenWeather sobre la salida,
lanza **una** notificación. La base avanza tras avisar; las mejoras no se avisan;
pasos ya recorridos se ignoran; silencio hasta 24 h antes de la salida.

Piezas nativas que necesita y su estado:
- `@capacitor/background-runner@3.0.0` y `@capacitor/local-notifications@8.3.1`
  instalados; `capacitor.config.json` → `plugins.BackgroundRunner`
  (`label: cc.meteoride.app.watch`, `src: runners/watch.js`, `event: checkWatch`,
  `interval: 30`, `repeat`, `autoStart`).
- **Parche a plugin en `postinstall`** (`mobile/scripts/patch-background-runner.mjs`):
  iOS no soportaba `interruptionLevel` (time-sensitive) y Android parseaba
  `scheduleAt` como hora local. Idempotente; **falla el `npm install`** si la fuente
  del plugin cambia, a propósito. Si se actualiza el plugin, revisar el script.
- iOS: Background Modes (fetch + processing), `BGTaskSchedulerPermittedIdentifiers`,
  dos líneas en `AppDelegate` (`mobile/native/ios/AppDelegate.swift`),
  capability *Time Sensitive Notifications*. Nada de esto está aplicado aún en el
  proyecto Xcode del autor (paso 6 de `docs/IOS.md`).
- Android: `POST_NOTIFICATIONS` en manifest, `flatDir` del motor JS en
  `app/build.gradle`, canal de alta importancia creado desde la app. Listo.
- El plugin propio `MeteoRideShare` expone `backgroundRefreshStatus()` para avisar
  bajo el toggle si el SO no va a ejecutar la tarea (Background App Refresh apagado
  en iOS; optimización de batería en Android).
- Límites reales: iOS decide cuándo ejecuta (el intervalo es una petición); el
  **simulador nunca ejecuta tareas en segundo plano**; modo de bajo consumo las
  suspende. `docs/IOS.md` tiene el comando lldb para forzar una ejecución.

## 5. Estado del proyecto Xcode del autor

Los pasos 1–9 de `docs/IOS.md` ya están hechos en el Mac del autor y el proyecto
**compila y arranca en el simulador**. Lo que confirmaron los logs del simulador:

- `MeteoRideViewController` registra el plugin propio (`MeteoRideShare consumePending`
  aparece en los logs), así que el `SceneDelegate` está puesto.
- El App Group `group.cc.meteoride.app` funciona (antes de añadirlo los logs decían
  `App Group ... unavailable`).
- Team de firma: solo hay "(Personal Team)" disponible en el desplegable pese a tener
  cuenta de desarrollador de pago; con eso basta para simulador y para App Groups.
- `Minimum Deployments` se bajó a **iOS 16** (Xcode proponía 26.5 por defecto).
- `ShareViewController.swift` se añadió por referencia ("Reference files in place"),
  no copiado. **Obsoleto**: la extensión se retiró el 18/09 y el fichero está borrado
  (ver §10). El criterio de referenciar en vez de copiar sigue valiendo para los fuentes
  que quedan.

Queda del lado del autor: probar en iPhone real (las tareas en segundo plano **nunca**
se ejecutan en el simulador) y firma de release de Android.

## 6. Verificado / no verificado

Verificado aquí, al cerrar la ronda de correcciones: **755 tests** (524 de Playwright sobre el bundle real con la
red cortada, respuestas de proveedor simuladas y el bridge nativo simulado, 262 en cada motor, Chromium y WebKit,
con uno que se salta en WebKit porque siembra un registro antiguo que ese motor no puede guardar; 231 de Node: reglas,
coordinador de rutas, extracción, runner ensamblado con KV/notificaciones/fetch simulados, iconos,
nombres de plugin y traducciones); Java
compilado contra stubs; nombres de API de Capacitor 8.5.2 cotejados con las fuentes de
`node_modules` (`CAPBridgedPlugin`, `registerPluginInstance`, `capacitorDidLoad`,
`SceneDelegateProxy`, `BackgroundRunnerPlugin.registerBackgroundTask`); `cap sync
android` ejecutado y los gradle generados commiteados.

Verificado por el autor en su Mac: el Swift **compila** (plugin, view controller,
share extension —retirada después, ver §10—, parche del plugin, `backgroundRefreshStatus`), la app arranca en el
simulador, carga un GPX desde Archivos, calcula previsión y muestra el toggle de
alertas con su aviso de límites del sistema.

Verificado aquí en la tarea 12 (firma de release), con SDK de Android disponible en
esta máquina (`~/Library/Android/sdk`, JDK 21 en
`~/.gradle/jdks/eclipse_adoptium-21-aarch64-os_x.2`): `assembleRelease` con las cuatro
`ANDROID_KEYSTORE_*` apuntando a un keystore de prueba generado en el scratchpad
produce `app-release.apk` firmado (`apksigner verify --print-certs` lo confirma); sin
esas variables ni `keystore.properties`, produce `app-release-unsigned.apk` sin firmar
y el aviso por consola. Sigue siendo la única vez que se ha compilado Android más allá
de `cap sync` en este entorno; todo lo demás de la app (UI, ciclo de vida, background
runner) sigue sin probarse aquí.

**No verificado** (no hay Xcode en el entorno de desarrollo, y el autor
aún no ha probado en dispositivo físico):
- La tarea en segundo plano en dispositivo real (iOS y Android). En el simulador de
  iOS BGTaskScheduler **no se ejecuta nunca**, así que ninguna alerta ha llegado aún
  por la vía real; lo único probado es la lógica pura y el runner con stubs.
- Que OpenStreetMap permita leer teselas con `fetch` desde `capacitor://localhost`
  (si no, el mapa funciona igual pero sin caché; hay fallback).
- La CSP `<meta>` de la app solo se ha validado en Chromium, no en WKWebView.
- Nada de la app en sí (UI, ciclo de vida, background runner) se ha compilado ni
  ejecutado en Android más allá de `cap sync`; el único build real hecho aquí es el de
  la tarea 12, solo para probar la firma de release (ver arriba).

## 7. Trabajo abierto / ideas

La lista completa está en `AGENTS.md → Open work`; esto es lo que hay que tener
presente para la app nativa:

- Probar en iPhone y Android **físicos**: las tareas en segundo plano no se ejecutan
  en el simulador, así que ninguna alerta ha llegado aún por la vía real.
- Firma de release de Android ya configurada (`app/build.gradle` lee
  `ANDROID_KEYSTORE_*` o `mobile/android/keystore.properties`, ver `docs/ANDROID.md`);
  falta que el autor apunte una de las dos fuentes a su propio keystore.
- La suite corre ya en Chromium y WebKit (`npm test`, tarea 11 + cierre de la
  tarea 9/10), pero solo en el WebKit de escritorio de Playwright; sigue sin
  probarse en un iPhone físico.
- `.github/workflows/tests.yml` (tarea 13) ejecuta `npm test` (Chromium y WebKit) en
  cada PR y en cada push a `main`, sin secretos. El resultado se
  lee en la lista de checks del PR o en la pestaña Actions: un run en rojo señala qué
  test falló, igual que en local.
- Ideas, no pendientes: tip jar (en iOS solo como compra in-app), conexión con Strava
  vía OAuth (Komoot y Hammerhead no tienen API pública), notificación en primer plano
  al reabrir la app.

## 8. Cómo retomar

Desde cualquier máquina con el repo clonado:

```bash
git clone https://github.com/lockevod/meteoride.git      # o git pull si ya lo tienes
cd meteoride
git checkout main
cd mobile && npm install                                 # postinstall parchea el runner
```

Prompt sugerido para un asistente:

> Estoy en el repo MeteoRide, rama `main`. Lee `AGENTS.md`,
> `docs/HANDOFF.md` y `docs/REVIEW-2026-09-14.md` antes de tocar nada.
> Convenciones: commits como Enderthor, **sin ninguna atribución de IA** (ni
> `Co-Authored-By`, ni menciones en comentarios ni en el mensaje), cada test con
> comprobación por mutación (rompe el código y confirma que el test falla), `npm test`
> desde `mobile/` antes de cada commit, y **nunca dos suites a la vez** (comparten el
> puerto 4173 y `www/`). La memoria de decisiones está en `AGENTS.md`; actualízala
> cuando cambies algo que un lector no deduciría del código. Lo pendiente está en la
> sección 9 de `docs/HANDOFF.md`, y la lista completa de lo que falta y de los límites
> aceptados, en la sección 10.

## 9. Lo pendiente: los seis hallazgos de la revisión

`docs/REVIEW-2026-09-14.md` es una revisión externa de seis hallazgos. Se ejecutó su
propio script de reproducción contra el HEAD de esta rama (`be77884`) y **los tres
reproducibles salen exactamente como dice la revisión**:

```
H1: renders [["B"],["B","A"]]
H2: prepare_offline_done
H6: 2600011 bytes aceptados, HTTP 201
```

No hay desacuerdo sustancial con ninguno de los seis. Dos son de código añadido en
este trabajo nativo (H2 y H6) y en H6 además había un comentario que afirmaba una
protección que el código no da.

| # | Dónde | Qué pasa |
|---|-------|----------|
| **H1** (alta, preexistente) | `fetchWeatherForSteps` en `app.js`, que reseteaba, escribía y pintaba `weatherData` | Dos cálculos solapados corrompen el `weatherData` global: el segundo resetea mientras el primero sigue escribiendo, y gana quien termine el último. Toca también las alertas, porque el evento `cw:forecast` (lo emite `publish` en `app.js` y lo escucha `native.js`) consume ese mismo global. Visto al arreglar H2: en la suite, **una sola carga de ruta** deja cada paso tres veces en `weatherData`, intercalado; no hace falta cambiar parámetros deprisa. Causa: `bindUIEvents` e `initUI` escuchaban los dos `#gpxFile` e `initUI` se ejecutaba dos veces (al cargar `ui.js` y en DOMContentLoaded desde `app.js`), así que cada fichero lanzaba tres cálculos. **Corregido ese disparador** (un listener, `initUI` con guarda, test en `smoke.spec.mjs`); **Corregida también la carrera**: cada ejecución de `fetchWeatherForSteps` toma un número (`forecastRun`, que la fase 3 sustituye por `requestId` y `computationId`), acumula en local y solo la última publica tabla, avisos, alertas y `cw:forecast`, y suelta su reclamación del indicador (`forecast:<id>`); `mobile/tests/forecast-runs.test.mjs`. `compare.js` escribía `weatherData` sin número hasta la fase 4, que le da identidad propia (`comparisonId`). |
| **H2** (alta, código propio) | `native.js:344-358` | `prepareForOffline` coge **todas** las claves de caché frescas, sean de esta ruta o no, ignora el booleano que devuelve `pinCacheKeys` y luego dice "{n} puntos" contando entradas de caché. Siempre informa de éxito. **Corregido**: reconstruye las claves de los pasos pintados con `makeCacheKey` y distingue nada, completo, parcial ("n de total") y fallo al fijar; cuatro tests en `smoke.spec.mjs`. |
| **H3** (media) | `app.js:993-1007` | La caché de OpenWeather guarda el JSON completo por cada hora: ~49 escrituras del mismo objeto. **Corregido**: la clave de OpenWeather es solo ubicación y unidades (`makeCacheKey`), una escritura por respuesta y la extracción elige la hora por `dt`; las claves antiguas se borran al arrancar. Con `route.gpx` y el stub de los tests, de 147 escrituras y 900 522 caracteres serializados a 3 y 18 378; tres tests en `smoke.spec.mjs`. |
| **H4** (media) | bucle de proveedores | Secuencial y sin timeout de aplicación: un proveedor lento cuelga toda la previsión. **Corregido** (decisión del autor tras medir): la envoltura de `fetch` abandona una petición a los 15 s sin que el servidor empiece a responder o a los 15 s seguidos sin datos al leer el cuerpo (`readText` con `getReader()`); una descarga lenta que sigue recibiendo no se corta. El plazo es por servidor: el que no responde no se vuelve a pedir en ese cálculo o comparación, y el aviso nombra al proveedor. Da igual que el servidor no llegue a responder o que el cuerpo se calle a mitad: el paso sigue el mismo camino. Un paso abandonado solo pasa a otro servidor (OpenWeather → Open-Meteo, nunca AROME); AROME y Open-Meteo comparten servidor, así que esos pasos no piden nada, pero sí usan la respuesta de Open-Meteo que ya esté en caché para ese paso. La petición que completa AROME desde el modelo estándar es de mejor esfuerzo y no abandona ningún servidor. Un cálculo o comparación sustituido aborta sus peticiones sin contarlo como fallo. Doce tests nuevos y uno ampliado en `smoke.spec.mjs`, y uno adaptado en `forecast-runs.test.mjs`. |
| **H5** (media) | `utils.js:34-58` | Los avisos de proveedor usan un temporizador de 1,5 s que nunca se reinicia, así que un aviso nuevo puede desaparecer al instante. **Corregido en la fase 2**: cada cálculo anota en su propio registro (`cwRecorder`) y el aviso se decide al publicar con `decideNotice`; `mobile/tests/forecast-runs.test.mjs` y `mobile/tests/forecast-outcome.test.mjs`. |
| **H6** (media, seguridad, código propio) | `functions/share.js:20-60` | El límite de tamaño compara `raw.length` (unidades UTF-16, no bytes) y lo hace **después** de leer el cuerpo entero en memoria. Con multibyte pasan ~2,6 MB. **Corregido**: el cuerpo se lee con tope de bytes antes de parsear (`readCapped`), texto y multipart; `mobile/tests/share.test.mjs`. |

**Orden propuesto** (decisión del autor pendiente; la conversación se quedó
exactamente aquí):

1. **H2 + H6** — pequeños, aislados, de código propio, y los dos engañan hoy al
   usuario (uno dice que la ruta está lista sin conexión cuando puede no estarlo, el
   otro documenta una protección inexistente).
2. **H1** — identidad de ejecución en `fetchWeatherForSteps`: solo la ejecución en
   curso puede publicar tabla, marcadores, avisos y el evento `cw:forecast`. Es un
   refactor de verdad del corazón del cálculo.
3. **H5** — resolver con el estado de ejecución de H1, no con más temporizadores.
4. **H4** — timeouts atados a esa misma identidad, preservando los fallbacks.
5. **H3** — formato de caché, con cuidado en la migración de las claves fijadas para
   uso sin conexión; medir antes de afirmar mejoras.

**Repasos de lo ya corregido:**

- **H1**: el test «picking a route file computes its forecast once» cuenta las
  peticiones de ruta (`cw.requestRoute`) y los cálculos lanzados (`cwLaunchComputation`)
  por fichero elegido; hasta la fase 3 contaba `reloadFull` y `fetchWeatherForSteps`. Mirar solo
  `weatherData` ya no cazaba lanzamientos duplicados, porque ahora publica solo el último.
- **H1**: con `initUI` ejecutándose una sola vez, al cargar `ui.js`, el botón de rutas
  recientes podía pintarse antes de `loadSettings` y quedarse en inglés.
  `applyTranslations` lo vuelve a etiquetar; test en `smoke.spec.mjs`.
- **H6**: `/share` decodifica con `TextDecoder` estricto y responde 400 a lo que no es
  UTF-8 (2,5 MB de `0xFF` se guardaban como 7,5 MB), y un `cancel` que falla ya no
  convierte el 413 en 500. Tests nuevos para el margen multipart y el `Content-Length`.
- **H2**: los fallbacks a Open-Meteo servidos desde caché (MeteoBlue, OpenWeather y
  AROME con error) etiquetaban el paso con `cached2.provider`, que no existe; el paso
  quedaba sin proveedor, la tabla leía el JSON con el formato equivocado y la
  preparación sin cobertura construía claves inexistentes. Ahora llevan `prov2`;
  `mobile/tests/forecast-runs.test.mjs`.
- **Fuera de la revisión**: abrir una ruta reciente que no era la primera borraba el GPX
  de todas las rutas recientes (`idbSaveAll` vaciaba el almacén y reescribía la caché, que
  solo tiene metadatos) y el arranque sin cobertura ya no tenía qué restaurar. Ahora solo
  se reescribe el registro abierto con otro `timestamp`; test en `smoke.spec.mjs`.

### Rediseño del ciclo de vida: fase 1 (reglas y extracción)

Diseño en `docs/superpowers/specs/2026-09-14-route-lifecycle-and-offline-design.md` y plan en
`docs/superpowers/plans/2026-09-14-fase-1-reglas-y-extraccion.md`. Ninguno de los dos está
en git: `docs/superpowers/` está en el `.gitignore` global del autor. La extracción por
proveedor, la elección de la línea de la ruta y la fusión de AROME están en
`public/scripts/forecast-rules.js`, con tres correcciones intencionadas: el primer cuarto de
`minutely_15`, las horas según `utc_offset_seconds` y la fusión alineada por hora. La
corrección de `utc_offset_seconds` cubría solo la tabla; `public/scripts/compare.js` elegía las
horas de Open-Meteo con `window.cw.findClosestIndex` en la zona del teléfono hasta la fase 4, que
lo pasa a `cwForecastRules.nearestIndex`.

La fase 2 (registro, foto y publicación) tiene su plan en
`docs/superpowers/plans/2026-09-14-fase-2-registro-foto-publicacion.md`, también fuera de
git. Cada cálculo anota lo que ven sus peticiones en su propio registro, lee sus ajustes una
vez y termina en una foto con pasos, alertas oficiales y resultado; solo `publish()` la lleva
a pantalla, y el aviso sale de `decideNotice`, sin temporizadores (H5). Con ella se corrigen
la casilla «mostrar alertas», que nunca dejaba fuera los avisos, y la unidad con que se lee
al repintar una respuesta de OpenWeather cacheada. Hasta la fase 4, comparar no daba avisos de
proveedor y `revalidateWeatherAlerts` mostraba alertas por su cuenta.

La fase 3 (coordinador de rutas para fichero y recientes) tiene su plan en
`docs/superpowers/plans/2026-09-14-fase-3-coordinador-rutas.md`, también fuera de git. Toda
ruta pasa por `cw.requestRoute` (`public/scripts/route-requests.js`): toma su `requestId` antes
de cualquier espera, se lee, se parsea fuera del mapa y solo se confirma si tiene una línea que
seguir; una petición sustituida no toca nada y una que falla avisa y deja la ruta que había.
Cada cálculo lleva `computationId` y solo publica el último de la ruta confirmada
(`forecastRun` desaparece). Los ajustes cambiados durante una lectura se aplican en el único
cálculo que lanza la confirmación; idioma y avisos detallados repintan sin recalcular. El
indicador de carga funciona por reclamaciones, así que comparar ya no lo apaga a mitad de un
cálculo. Recientes importa en cola, con nombre único (`Ruta (2).gpx`) y en una sola
transacción, sin respaldo en `localStorage` al escribir. La restauración al arrancar pide su
ruta antes de esperar a recientes: una ruta compartida que llega durante esa espera gana, y
ahora tiene test. Quedaban para la fase 4 comparar, `revalidateWeatherAlerts` y desarmar la alerta
de ruta al confirmar otra (hechos en la fase 4); para la fase 5, cada entrada de fuera con su fuente (hecho en la
fase 5, abajo). Detalle en
`AGENTS.md`, «Route requests». Las fases 4 a 7 tendrán cada una su plan cuando empiecen.

La fase 4 (consumidores) tiene su plan en
`docs/superpowers/plans/2026-09-15-fase-4-consumidores.md`, también fuera de git. Comparar, la
alerta de ruta y las alertas oficiales trabajan sobre la foto publicada (`cw.currentSnapshot()`) y
comprueban su vigencia antes de cada efecto. Comparar se lanza una sola vez, al publicar o al
elegirlo, con su propio `comparisonId`: una comparación sustituida no pinta ni escribe
`weatherData` ni guarda sus filas, avisa con su propio registro y lee las horas de Open-Meteo y
AROME en la zona de la ruta. La alerta de ruta arma desde la foto, guarda y desarma en una cola
serial, conserva lo ya avisado al rearmar la misma ruta con la misma salida y se desarma al
confirmar otra. Desaparecen `revalidateWeatherAlerts` y el alias `window.reloadFull`. Detalle en
`AGENTS.md`, «Consumers of the snapshot».

La fase 5 (rutas que llegan de fuera) tiene su plan en
`docs/superpowers/plans/2026-09-15-fase-5-rutas-de-fuera.md`, también fuera de git. Toda ruta que
llega de fuera entra por `cwReceiveRoute` (`gpx-share.js`), que pide su ruta al coordinador en la
misma llamada: la descarga de `?gpx_url=` y `shared_id` y la espera al mapa van dentro de la
lectura de la petición, con su plazo, así que una ruta elegida mientras tanto gana. Las
compartidas (buzón nativo, service worker, `sessionStorage` y `shared_id`) se importan en recientes
al llegar su texto, aunque la petición termine sustituida; un enlace y un mensaje, solo al
confirmarse. El buzón del service worker tiene un único lector, que lee y borra en la misma
transacción. El arranque nativo restaura sin esperar a vaciar el buzón, y una compartida que sale
después gana por identidad. `postMessage` responde con el resultado de su petición (`status`), no
al llegar. Desaparecen `whenAppReady`, `loadSharedGPX`, el segundo oyente del service worker y la
conversión de KML del inyector. Detalle en `AGENTS.md`, «Routes from outside».

La fase 6 (hora y uso sin cobertura) tiene su plan en
`docs/superpowers/plans/2026-09-15-fase-6-hora-y-sin-cobertura.md`, también fuera de git. La hora
de salida nunca queda antes de ahora. La regla (`cwApplyStartRule`: la elegida si va por delante,
si no ahora redondeado al cuarto siguiente) corre en tres momentos:
- tras cada `loadSettings`;
- al leer los ajustes de un cálculo;
- al volver a la app, que además recalcula si la salida cambió o la foto en pantalla tiene más de
  30 min.

El campo se guarda al cambiarlo y el arranque ya no lo pisa. La foto lleva salida y velocidad, y la
segmentación lee de los ajustes del cálculo. Preparar guarda la foto publicada en IndexedDB, sin
identidades ni claves, y cuenta los puntos que una reproducción podrá mostrar con cualquier salida a
3 h o menos.

La foto preparada se recoloca a la hora real (`replay()`, un cálculo con sus identidades) en dos
casos:
- sin cobertura;
- cuando un cálculo termina sin ningún paso utilizable.

El aviso dice su antigüedad. Al arrancar se abre la ruta preparada dentro del margen; fuera de él se
borra. Con una foto reproducida y sin cobertura:
- un ajuste que no es la hora avisa y mantiene la foto;
- una hora fuera del margen deja la tabla sin datos.

Comparar no se lanza sobre una foto reproducida. Desaparece `warnIfStartTimeHasPassed`. Detalle en
`AGENTS.md`, «Behaving like an app rather than a page» y «Preparing and replaying».

### Revisión adversarial de las correcciones (852f61a..8b6e3fb)

Una segunda revisión adversarial, aparte de los seis hallazgos de
`docs/REVIEW-2026-09-14.md`, encontró y corrigió siete cosas más en siete tareas (ver
`.superpowers/sdd/2026-09-14-correcciones-revision-adversarial/`): una ruta KML compartida
solo se acepta convertida cuando produce track/ruta/waypoint (antes, un GPX mal nombrado
`.kml` se convertía en un GPX vacío) y `geojsonToGpx` ya entiende `GeometryCollection`; un
cálculo de previsión sustituido deja de escribir caché y de pedir avisos independientes tras
el reemplazo, y un cuerpo de respuesta ilegible cuenta como fallo; Open-Meteo y AROME piden
`start_date`/`end_date` en vez de `start=`, que se ignoraba; OpenWeather cae a `daily` más
allá de una hora de su última hora horaria en vez de releer una hora lejana; la base de las
alertas de ruta pasa a ser por magnitud (lluvia y viento con sus rachas, cada una la suya) y
una magnitud sin base cuenta como nivel 0 en vez de saltarse ese punto; y los dos buzones de
rutas compartidas llevan secuencia en el nombre de fichero, con Android ignorando además los
intents relanzados desde Recientes. Detalle completo en `AGENTS.md`.

Queda para fases posteriores, documentado pero no corregido en esta revisión: identidad por
petición en `fetchWeatherForSteps` (hecha en la fase 3, abajo); `compare.js` y `revalidateWeatherAlerts`, que
no pasaban por el registro por cálculo ni por `decideNotice` (hecho en la fase 4); y el orden del
arranque y la importación duradera (hechos en la fase 5, en JavaScript). Quedan como límites
aceptados (§10), porque la fase 5 no cambia los buzones nativos: Android puede perder una ruta
compartida si el proceso muere entre marcar el intent como gestionado y escribir el fichero
en el buzón, e iOS lee un fichero abierto con «Abrir en» de forma síncrona en el hilo
principal en vez de en un hilo aparte, como ya hace Android.

Una revisión adversarial de Codex dirigida sobre 852f61a..87c56c4 cerró seis de sus siete
hallazgos originales; el que queda, el sexto —Android pierde la importación si el proceso
muere a mitad—, queda como límite aceptado (§10). Además encontró estos cuatro, corregidos en esta
tanda: el buzón de iOS no entregaba una ruta con salto de línea en el
nombre; el dato diario de OpenWeather podía elegir el día anterior justo en la medianoche
local; una temperatura diaria de 0°C se perdía; y dos imprecisiones de `AGENTS.md` sobre la
decodificación UTF-8 de iOS y el efecto secundario del guardián de Recientes en Android.

## 10. Lista viva de lo que falta y de los límites aceptados

Una sola lista con todo lo que queda por hacer, lo que se ha decidido no arreglar y lo que no
se ha comprobado. Se actualiza al cerrar cada fase, para poder hacer el resumen final desde aquí
sin reconstruirlo de los ledgers (que no están en git). La infraestructura y las ideas siguen
en `AGENTS.md → Open work`. Última actualización: revisión externa de publicación del 17/09/2026
(Codex), de la que se han cerrado cuatro hallazgos y queda abierto lo que se lista abajo.

### Pendiente por fase del rediseño

- **Fase 7 — retirada y documentación.**
  - Hecho: fuera `pinCacheKeys` y `cachedWeatherKeys`; `cw_offline_pinned` se borra una vez al
    arrancar y el vaciado por cuota trata igual todas las entradas de caché.
  - Hecho: repaso final de `AGENTS.md` y de este documento contra el código (recuentos de tests y
    cobertura de la suite al día). El rediseño no tiene más fases pendientes.
  - Hecho (tarea 13): `.github/workflows/tests.yml` ejecuta la suite completa en cada PR
    y en cada push a `main`; ver §7.

### Hallazgos de la revisión del 14/09 aún abiertos

- Ninguno: los seis están corregidos (§9).

### Revisión externa de publicación del 17/09 (Codex): qué queda abierto

Nueve hallazgos. Cerrados F1 (faltaban los manifiestos de privacidad de iOS), F2 (no había
política de privacidad publicable, y los documentos de tienda recomendaban declarar «no se
recopilan datos»), F4 (el drenado entregaba diez de once rutas), F6 (el filtro `ACTION_VIEW`
era más estrecho que el de compartir), F8 (Atrás salía de la app con el panel de configuración
abierto) y F9 (nombres de bandeja iOS que podían colisionar entre la app y la extensión).

Sobre F1, y esto conviene recordarlo: el informe recomendaba `C617.1` y `CA92.1`, yo lo
«corregí» a `DDA9.1` y `54BD.1` a partir de una extracción mal emparejada de la página de
Apple, y la revisión adversarial de Codex lo cazó. Leída la documentación JSON por
estructura, los códigos buenos son los del informe: `C617.1` (metadatos de ficheros del
contenedor de la app o del App Group) y `CA92.1` (*user defaults* solo de la app).
`54BD.1` es información del teclado activo y no pinta nada aquí. El test lleva ahora la
tabla real por categoría y falla ante un código de otra categoría. Comprobado con un
archive sin firmar: los dos manifiestos aparecían con los códigos buenos en la raíz de
`App.app` y de `ShareExtension.appex`. La extensión se retiró después (§10), así que
queda uno.

Siguen abiertos:

- **Los formularios de tienda, que son manuales.** Las tres políticas (`public/privacy-ios.html`, `-android`, `-web`) ya dicen qué
  declarar y `docs/IOS.md` y `docs/ANDROID.md` lo traducen a cada ficha, pero App Privacy
  y Data Safety hay que rellenarlos en las consolas. No se ha inspeccionado lo que haya
  declarado allí ahora mismo.
- **La regla de rate limiting de Cloudflare.** `functions/share.js` ya trae un freno por
  IP contado en la caché de Cloudflare, con su techo escrito en el código: la caché es
  por centro de datos y la cuenta no es atómica. El techo global es una regla de rate
  limiting o WAF sobre `/share` en el panel, que no vive en este repositorio (no hay
  `wrangler.toml`) y que nadie puede verificar desde aquí.
- **Nada de esto se ha probado en un dispositivo.** Lo que sigue pendiente de F3, F5 y F7
  no es código sino medida: matar el proceso durante una importación lenta y comprobar
  que la ruta se recupera y no se duplica; medir en un iPhone que la lectura fuera del
  hilo principal quita de verdad el riesgo de watchdog; y pasar VoiceOver y TalkBack por
  encima de los controles ya agrandados. Los stubs de Playwright no prueban el puente
  nativo, y el simulador no ejecuta tareas en segundo plano.
- **Un fichero que no es una ruta se rechaza en silencio.** Ampliar `ACTION_VIEW` a
  `application/octet-stream` hace que MeteoRide aparezca en «Abrir con» para casi
  cualquier fichero desconocido. Lo que no es una ruta se lee, se reconoce y se descarta
  en `MeteoRideShareStore.ingest`, pero solo con un `Log.w`: desde fuera, la app se abre
  y no hace nada. Falta decírselo al usuario (un aviso, o un evento `sharedRouteRejected`
  que el `native.js` convierta en un `setNotice`). No es una regresión —el filtro de
  compartir ya aceptaba ese tipo— pero esta ampliación lo hace mucho más visible.
### Segunda re-revisión de publicación (17/09, sobre 4cd5788)

Siete hallazgos, todos ciertos. Seis se cerraron en `5915437` y **R4 quedó a medias**:
las filas de recientes pasaron a ser botones de 44px, pero los controles de zoom del mapa
(30×30) y los selectores de intervalo y velocidad (32px de ancho) se quedaron cortos, como
señaló la verificación posterior sobre ese commit. Cerrado después: se subieron cinco
controles —los dos de zoom, la brújula y los dos selectores— y el test mide seis, con el
de recentrar incluido, que ya estaba a 44 por `.icon-btn`.

Cada regla se comprobó **por su propia mutación**, no por bloques, y esa distinción pagó:
quitar un bloque entero solo demuestra que *alguno* de sus controles está cubierto. Así
salieron dos cosas que se habrían colado — el botón de recentrar estaba en el CSS y fuera
del test, y una vez medido resultó que su regla era redundante, así que se retiró; y la
brújula, 26×26 justo al lado del zoom que acababa de crecer, no la vio nadie hasta barrer
todos los controles visibles y medirlos.

Tras ese barrido no quedó ningún control interactivo por debajo de 44px en la pantalla del
mapa — y eso resultó ser demasiado: ver «El suelo táctil: dos rondas de más y una
corrección», más abajo, donde todo baja a un único suelo de 28px. Las dos
excepciones son los enlaces de atribución (autoría y OpenStreetMap, 31×8 y 50×8): son el
texto legal que exige la política de teselas de OSM, no controles, y agrandarlos taparía
mapa sin que nadie los busque con el pulgar. Dos de los siete merecen recordarse:

- **R1 era una regresión introducida por el propio arreglo anterior.** `revokeWatchKey`
  leía `alertsKey`, que es un campo del *snapshot*, no de lo que `saveSettings` persiste
  (`apiKeyOW` + `showWeatherAlerts`). Resultado: cualquier guardado de ajustes —cambiar
  el botón de debug, por ejemplo— borraba la clave del vigilante armado y dejaba sin
  avisos oficiales en segundo plano, con el campo y los dos interruptores aparentemente
  puestos. El test unitario lo avalaba porque le daba un JSON escrito a mano con el
  nombre supuesto. Ahora se prueba por el formulario real, más un test de contrato que
  lee los nombres de `utils.js`.
- **R2 no se arreglaba invalidando los armados en vuelo**, que fue el primer intento. La
  clave vuelve desde un armado *nuevo* construido sobre un snapshot antiguo, y eso no lo
  cancela ningún token. `saveWatch` reconcilia ahora contra el formulario vivo. El primer
  test de esa carrera miraba la entrada del armado de preparación y por eso daba el fallo
  hubiera o no hubiera fallo: sus mutaciones tampoco probaban nada.

Los otros cinco: contraste 1,10:1 en la etiqueta de cargar fichero (R3), filas de
recientes de 28px y sin semántica de botón ni teclado (R4), Atrás salía con el menú de
recientes abierto (R5), permisos persistentes de URI que no se liberaban tras importar
(R6) y una contradicción en `docs/IOS.md` sobre la ficha de Apple (R7).

Sigue abierto de esa revisión: la atomicidad del contador de `/share` —documentada en el
código y cubierta por la regla WAF que falta— y todo lo que solo se puede comprobar en un
dispositivo.

### El suelo táctil: dos rondas de más y una corrección (17/09)

La primera ronda puso **44px a todo** lo que se pudiera tocar en la app. Visto en el
teléfono, el resultado era malo en tres sitios a la vez: el panel de controles ocupaba
306px de una pantalla de 664 —casi la mitad de la app gastada en un formulario que se
rellena una vez—, los botones de zoom y de recentrar del mapa se convertían en losas, y
con el botón de debug visible la barra de cabecera se ensanchaba tanto que «MeteoRide»
se envolvía debajo de su propio logo (53px de cabecera pasaban a 74).

La segunda ronda lo partió en dos escalones, 44 para el mapa y 36 para el panel. Seguía
siendo demasiado grande, y no arreglaba la cabecera.

Lo que hay ahora: **un solo suelo de 28px y nada más tocado**. En la práctica mueve dos
cosas y solo dos —los selectores de 22px y la brújula de 26— y deja como estaban el par
de zoom (30), el recentrar (30), el conmutador de comparar (28), el botón de cargar (28)
y los controles de ajustes (28-30). La app vuelve a parecerse a la web, que es de lo que
se trataba.

Sobre los 28px conviene ser exacto, porque es fácil venderlo como más de lo que es: **es
una decisión de usabilidad, no un certificado**. Lo comprobable es que 28 supera el
umbral de tamaño que sí es normativo —WCAG 2.2 AA, criterio 2.5.8: 24×24 px CSS; los
44×44 son el 2.5.5, que es AAA—. Los 44pt de Apple son recomendación de las HIG y los
48dp de Google son recomendación de Material: ninguno es un motivo de rechazo enumerado,
pero cumplir un criterio de tamaño **tampoco demuestra que ninguna tienda lo acepte**.
Nadie ha probado un rechazo por 28px, y nadie ha probado lo contrario.

#### Lo que aprendieron los tests

- **El techo importa tanto como el suelo.** Ninguna de las dos rondas anteriores tenía
  nada que fallara al subir los tamaños. Ahora ningún control del panel puede pasar de
  32px, y ese barrido alcanza controles que ninguna lista enumera.
- **Un número de píxeles para el panel entero no sirve.** Los dos proyectos de Playwright
  ni siquiera miden lo mismo —Pixel 7 da 412×839 y iPhone 14 da 390×664— y `.params` hace
  `flex-wrap` con etiquetas `nowrap`, así que 22px de ancho cambian una fila entera: los
  mismos estilos daban 104px en Chromium y 152px en WebKit. Un número calibrado en uno es
  un flake o es letra muerta en el otro, y con el idioma pasa igual.
- **La cabecera no la vigilaba nadie.** Todos los tests medían controles sueltos, nunca la
  barra donde viven. Hay uno nuevo, a 320px y en español, que comprueba que el título
  queda **a la derecha** del logo. La versión vertical de esa comprobación no valía nada:
  el logo es lo bastante alto como para solaparse con el nombre aunque el nombre haya
  caído a una segunda línea, y pasaba tan contenta con la cabecera a 74px.
- **`.recent-routes-button` vive dentro del panel**, al lado del botón de carga. Se había
  quedado en 44 —era lo más alto de esa fila, así que cargar una ruta hacía crecer el
  panel— y ningún test lo veía, porque todos miden una instalación recién puesta, donde
  ese botón todavía no existe. El barrido del techo se repite con una ruta cargada.
- **Las filas del menú de recientes necesitan `#controlsPanel` en el selector.** El menú
  está dentro de `.params`, así que el suelo con ID le ganaba a la regla de 44px por
  especificidad y las filas salían a 28 con la regla ahí al lado aparentando funcionar.
  Se quedan en 44 a propósito: el menú es una capa por encima de la página, su altura no
  cuesta nada, y una lista que se recorre con el pulgar es justo donde se falla.

#### El botón de cargar fichero

El glifo de carpeta llevó un rato con la etiqueta «Cargar fichero» visible al lado, para
que lo único que hay que hacer en un mapa vacío tuviera nombre. Le nombraba y le costaba
una fila entera, en la app y en la web. El nombre sigue estando: el `<span>` lleva
`.sr-only`, y el control en el que aterriza de verdad un lector de pantalla es `#gpxFile`
—el input está fuera de pantalla con `opacity: 0`, no con `display:none`, así que sigue
en el árbol de accesibilidad y lo nombra su `<label for>`—. El `title` ya lleva
`data-i18n-title`, porque desde que no hay texto visible es la única pista que le queda a
un ratón.

El test se lo pregunta con `toHaveAccessibleName`. La primera versión contaba caracteres
de `textContent` y aceptaba cualquier rectángulo de 1px o menos: con `display:none`
devuelto al `<span>`, el texto seguía en `textContent`, el rectángulo pasaba a 0×0 y el
test pasaba mientras la regresión volvía. La mutación de `display:none` ahora falla en
los dos motores. La web tiene su propio guardián, que también faltaba: el `toBeHidden()`
anterior había que quitarlo —Playwright considera *visible* un elemento de 1×1
recortado— y no lo sustituía nada.

#### El mapa y los controles de Leaflet

El mapa tenía un techo de `62vh` heredado de la web, donde existe para que no se coma una
ventana de escritorio alta. En la app no hacía nada bueno: `main` ya es exactamente la
pantalla menos la cabecera y el mapa es el único hijo que crece, así que el techo solo
dejaba hueco —62vh de 874px son 542, el mapa tenía 614 para coger, y los otros 72 se
quedaban vacíos debajo—. Quitado: ahora coge la holgura cuando la hay y se la devuelve a
la tabla cuando se carga una ruta, que es para lo que están el `flex: 1.8` y el suelo de
150px. El test comprueba que no quedan más de 24px muertos bajo el mapa; con el techo
puesto otra vez, falla en WebKit (58px). En Chromium el proyecto es más ancho y el techo
no llega a morder, así que ahí no salta: una de las dos basta.

Debajo del mapa quedaban además dos cosas. Una, `@media (max-width: 900px) #map {
margin-bottom: 1rem }`: en la web separa el mapa de lo que venga después, y en la app no
viene nada —la tabla de previsión vive dentro de `#controlsPanel`, encima—, así que eran
16px de fondo de página contra el borde inferior. Dos, el `padding-bottom` de `main`, que
era el inset del indicador de inicio entero; ahora se le restan 8px por el mismo argumento
que en la cabecera. Lo que **no** se devuelve es el resto: los ~20pt de abajo son la zona
de gesto del sistema, y un mapa dibujado ahí es un mapa que cuesta arrastrar.

Ese `max()` de abajo, a diferencia del de la cabecera, **no se puede testear**: sin inset
la respuesta correcta es 0 y CSS recorta el negativo a 0 también, así que desde fuera no
se distinguen. Se escribió la aserción, pasaba en los dos casos, y se borró.

Los tres botones de las barras de Leaflet —el par de zoom y el de recentrar— quedan a
28×28 exactos. Eran content-box, así que los 28px de la web más 1px de borde a cada lado
los dibujaban a 30, y el de arriba a 31 porque además lleva el separador de la barra: el
par se veía desigual. **El de recentrar necesita `.leaflet-bar a` en el selector**: es un
`<a>` dentro de una barra de Leaflet, así que `.leaflet-touch .leaflet-bar a { width:
30px }` de la hoja de estilos de Leaflet le gana a un selector de dos clases. La primera
versión de la regla se leía perfectamente y no hacía nada, y una aserción que solo mira
el suelo se quedaba tan tranquila con los 30. Ahora hay techo además de suelo.

#### La cabecera y la isla

`env(safe-area-inset-top)` no reserva la isla: reserva toda la banda de la barra de
estado, y en un iPhone con Dynamic Island el borde inferior de la isla queda unos puntos
por encima de esa línea. Maquetar por debajo del inset entero dejaba la barra de
herramientas visiblemente descolgada. Ahora se le restan 8px, que cierran el hueco sin
llegar a la isla: la isla está centrada y mide unos 37pt, el título y los iconos están en
los dos extremos, y la fila sigue empezando por debajo.

Es `max(0.15rem, calc(env(...) - 0.5rem))` y no un `calc` a secas porque en un aparato sin
inset —Android sin muesca, y la página abierta en un navegador— la resta se va a negativo
y la cabecera se queda sin padding superior. **Es el único número de aquí que ningún test
cubre**: Playwright da el inset como 0, así que el caso interesante no se puede simular.
Lo que sí comprueba el test es que el respaldo aguanta, y quitar el `max()` lo tumba.

Dos precisiones que dejó la revisión externa, y conviene no perderlas:

- Respecto al código anterior la cabecera no sube lo que se le resta al inset, sino eso
  más los 0,15rem que antes se sumaban. Con el recorte actual de 4px son **6,4**.
- **El recorte de arriba bajó de 8px a 4.** 8 estaba pensado mirando solo la Dynamic
  Island. Un iPhone 12/13/14 da un inset de 47pt sobre un alojamiento de sensores que
  llega a 44: 47−8 mete los 5px de arriba de la fila dentro de esa banda, y la muesca
  está centrada, justo donde llega un título de esta longitud a 320px. Con 4 la isla se
  libra de sobra (59−4 = 55 contra un borde inferior de ~48) y la muesca se falla por
  1pt, que no lo ve nadie.
- Ni arriba ni abajo hay **nada medido en un dispositivo**. El razonamiento sobre la
  geometría de la isla es geometría, no una captura; la fórmula de abajo tampoco garantiza
  conservar los ~20pt del gesto del sistema en todos los aparatos (con un inset de 24px y
  `1rem = 16px` deja 16). Se aplica a **todos** los nativos, no solo a los que tienen
  isla. El revisor externo recomendaba conservar el inset entero hasta tener medidas; se
  mantiene el recorte porque es lo que se pidió expresamente y dos veces, pero queda dicho
  que está sin verificar en hardware.

#### Plegar los controles (app, 17/09)

Con una ruta cargada el panel lleva el nombre de la ruta, la tarjeta de resumen y la tabla
de previsión, y el mapa está clavado en su suelo de 150px con ~130px de controles encima.
Ahora esos controles se pliegan a una tira de una línea que sigue diciendo a qué están
puestos: `09/17, 23:45 · 12 km/h · 15 min · OpenMeteo`. No se esconde información, se
resume — la tira nombra el proveedor y la hora de salida, que son las dos cosas por las que
volverías a abrirla. Medido: el bloque de parámetros pasa de ~130px a 32px.

La fila del botón de cargar y el menú de recientes se queda **fuera** del pliegue y comparte
línea con la tira: cambiar de ruta es lo único que merece hacerse desde un panel plegado y
no cuesta nada dejarlo ahí.

**El disparo es lo que importa y el obvio era el malo.** «Al cargar la ruta» pliega justo
cuando todavía se está ajustando la hora — lo dijo el autor antes de que se escribiera una
línea. Cargar una ruta solo **arma** el pliegue; lo que lo dispara es el primer toque en el
mapa o en la tabla, que es el momento de haber dejado de configurar y haberse puesto a
mirar. Una vez por ruta, y volver a abrirlo a mano lo desarma hasta que se cargue otra
ruta distinta — de ahí que se compare `snapshot.route.fingerprint` y no se rearme en cada
`cw:forecast`.

Está construido en `native.js`, no en `index.html`: la web no cambia en nada, no tiene el
problema y no quiere la solución. Un `<button>` con `aria-expanded`, no un `<details>`,
porque el `<details>` habría obligado a reestructurar el HTML compartido; el triángulo lo
dibuja el CSS con `::before` para que el nombre accesible sean los valores y no «triángulo
negro apuntando a la derecha, 17/09».

Cuatro cosas que el CSS y los tests aprendieron por las malas:

- **`display: none !important`.** `.provider-row` lleva `style="display:flex"` en el
  marcado, y un estilo en línea gana a cualquier selector sin `!important`. Sin él la fila
  del proveedor se quedaba en pantalla mientras todo lo demás se plegaba, y un test que
  solo mirase si la clase estaba puesta pasaba tan contento.
- **`flex: 1 1 0` y no `1 1 auto`.** Con `auto` la tira pide el ancho de su texto, y un
  contenedor con `flex-wrap` prefiere envolver antes que encogerla: la tira se llevaba la
  línea entera y empujaba abajo la fila de carga. El pliegue ahorraba una fila y gastaba
  otra.
- **Se afirma que encoge el bloque de controles, no que crece el mapa.** Con una previsión
  larga el sitio se lo queda la tabla y el mapa sigue en su suelo de 150px — que es la
  maquetación funcionando— y en el más bajo de los dos viewports de test «el mapa creció»
  era falso mientras el pliegue hacía exactamente su trabajo.
- **Rearmar en cada `cw:forecast` pasa todo lo demás.** La mutación que lo probó no la
  cazaba ninguna aserción hasta que se añadió el caso concreto: reabrir a mano, cambiar el
  intervalo, mirar el mapa — y se había vuelto a plegar solo.

#### El fallo que este trabajo introdujo y casi se publica

La primera versión de la tira pedía el idioma con `window.loadSettings()`. **`loadSettings`
no es un getter**: recorre una lista de campos y hace `el.value = s[id]` (`utils.js:528`)
para la velocidad, la fecha, el intervalo y el proveedor, y además no devuelve nada, así
que leerle `.language` lanza un `TypeError` que el `try/catch` se tragaba. Como la tira se
refresca en cada `input`, **cada pulsación en la casilla de velocidad restauraba el valor
guardado**: la edición se deshacía mientras se escribía, sin un solo mensaje en consola.

Merece la pena por cómo estuvo a punto de colarse. Los tests fallaban por esto y se
interpretó al revés: se dio por hecho que era la app pisando sus propias ediciones al
restaurar los ajustes, se ajustaron los tests para no chocar con ello y **se escribió en
este documento como un comportamiento anterior, sin corregir**. Lo era todo menos eso.
Comprobado después del arreglo: dos ediciones seguidas —preselección de velocidad y luego
intervalo— se quedan las dos puestas.

La lección de test: hacía falta que hubiera una velocidad **guardada** para que el fallo
mordiera, porque `loadSettings` solo reescribe un campo si hay algo almacenado para él.
Sobre un perfil recién hecho la versión rota parecía correcta, y la primera versión del
test nuevo pasaba con el fallo puesto.

Lo encontró la revisión adversarial externa, no la propia.

#### Otras cuatro de la misma revisión

- **La tira mentía con la velocidad.** Etiquetaba `mph` si en ajustes había millas, sin
  convertir el número. La casilla está en km/h haga lo que haga ese ajuste —`app.js:713`
  la lee tal cual y divide kilómetros entre ella—, así que el resumen atribuía al cálculo
  una velocidad un 61% mayor que la usada. Ahora dice `km/h` siempre, que es lo que el
  número es. El test lo comprueba con millas elegidas.
- **Una ruta nueva heredaba el pliegue de la anterior.** Armar no era suficiente: la clase
  se quedaba donde estaba, así que la ruta siguiente empezaba con los controles ocultos y
  el único flujo que esto existe para proteger —cargar ruta y luego cambiar la hora—
  arrancaba detrás de un toque que nadie había pedido. Ahora un fingerprint distinto
  despliega además de armar.
- **El pliegue se disparaba con el foco dentro.** Tocar el mapa es también como se cierra
  el teclado del móvil, y plegar entonces se lleva por delante el campo que se estaba
  editando, con el elemento enfocado dentro de un subárbol que pasa a `display: none`.
  Ahora el disparo se salta si `document.activeElement` está dentro del panel: el primer
  toque cierra el teclado, el segundo pliega.
- **El disparo de la tabla no lo probaba nadie.** Los dos listeners se enganchan en el
  arranque y todos los tests tocaban `#map`, así que `['#map', '.wtc-wrap']` podía perder
  su segunda entrada sin que nada se quejara. Hay un test por cada mitad.

`aria-controls` apuntaba a `#controlsPanel` entero, que incluye el nombre de la ruta, la
tarjeta de resumen y la tabla —nada de lo cual controla ese botón—. Ahora apunta a las
filas, que llevan un id puesto desde `native.js`.

#### Una tercera vuelta de revisión, y lo que dejó

La revisión Claude sobre el mismo diff encontró los mismos cuatro fallos que la externa
—ya corregidos cuando llegó— y además **siete mutaciones que pasaban todos los tests**.
Todas caen ahora:

1. **Borrar el bloque que formatea la fecha.** Nada leía la hora en la tira, siendo la
   mitad de la razón por la que existe.
2. **Clavar `aria-expanded` en `"true"`.** A un lector de pantalla se le decía que los
   controles estaban abiertos mientras estaban en `display: none`.
3. **Devolver `aria-controls` a `controlsPanel`.** El arreglo recién hecho no lo vigilaba
   nadie.
4. **Quitar el `aria-label`.** Y aquí había un error de bulto en el comentario: el
   contenido generado por `::before` **sí** entra en el nombre accesible (algoritmo
   accname, paso 2F). Lo que mantiene el triángulo fuera no es el CSS, es el `aria-label`.
   Y la aserción que decía vigilarlo leía `textContent`, que nunca puede contener
   contenido de un pseudoelemento: pasaba siempre. Ahora se comprueba el nombre accesible
   de verdad, con `toHaveAccessibleName`. De paso, el `aria-label` usaba `', '` donde el
   texto visible usa `' · '`, lo que incumple WCAG 2.5.3 (Label in Name): el texto visible
   tiene que estar dentro del nombre accesible o el control por voz no lo encuentra.
5. **Quitar el recorte del título de la cabecera.** Comparar rectángulos no lo ve: el
   texto desbordado se pinta fuera de su caja mientras la caja conserva su ancho, y
   `html.cw-native` es `overflow: hidden`, así que la página tampoco crece. Se mide el
   recorte en sí, con una aserción previa que comprueba que a 320px el nombre de verdad no
   cabe — si no, no estaría probando nada.
6. **Quitar el `summarise()` final.** Los valores se escriben en los controles por código
   al arrancar, y asignar `el.value` no dispara `change` ni `input`: sin esa llamada la
   tira estaba en blanco hasta la primera edición. Todas las demás aserciones ocurrían
   después de una edición, así que ninguna se enteraba.
7. **`flex: 1 1 100%` → `0 0 auto` en el estado abierto.** Solo se había mutado la mitad
   plegada de ese par de reglas.

Dos cosas que el CSS prometía y no hacía, también suyas:

- **`text-overflow: ellipsis` sobre un contenedor flex no hace nada.** `.params-strip` es
  un `display: flex`, así que su texto es un ítem flex anónimo y se cortaba a hueso a
  mitad de carácter. El texto vive ahora en un `<span>` que sí es un contenedor de bloque.
- **`min-width: 0` en la tira plegada estaba muerto**: `#controlsPanel .params button` lo
  fija en 28px desde un selector más específico. Retirado.

Y dos aclaraciones que no cambian código:

- **El disparo no siempre es el primer toque.** Un `select` o un campo de fecha conservan
  el foco después de usarse, así que el toque que cierra el teclado se lo come la guarda
  de foco y pliega el siguiente. Es lo que se quiere; el texto que decía «el primer
  toque» estaba mal y está corregido.
- **Tocar los controles de Leaflet también pliega.** `disableClickPropagation` engancha
  `mousedown touchstart dblclick contextmenu`, no `pointerdown`, así que el zoom, la
  brújula, el recentrar y los enlaces de atribución burbujean hasta `#map`. Se deja así:
  todos ellos son mirar el mapa.

#### La web sí cambió, aunque a mejor

El requisito era «la web no se toca» y conviene no dejarlo implícito: `index.html:261`
cambia `display:none` por `.sr-only` en la etiqueta del botón de carga, así que el nombre
accesible de `#gpxFile` pasa de `📁` a `📁 Cargar fichero` **también en la web**, y el
`data-i18n-title` traduce allí el tooltip. La maquetación no se mueve —hay una aserción de
≤1×1 px que lo comprueba— y los dos cambios son mejoras, pero son cambios.

#### La tabla vacía bajo el aviso (18/09)

Cuando el proveedor no contesta, la app publica igualmente: el aviso forma parte de lo que
publica. Pero **también montaba la tabla**. Reproducido a 390px: cinco filas de guiones,
una tarjeta de resumen que decía `Temp: - Viento: - Lluvia: -`, y 270px de pantalla
quitados al mapa —de 268px a 202— para enseñar que no se sabe nada. El aviso ya lo dice en
una línea.

El arreglo está en el único sitio donde tenía que estar: `renderWeatherTable` **ya** tenía
una salida temprana para «no hay ruta ni datos» que limpia la tabla y el resumen, y lo que
faltaba era una condición más. `anyReading(weatherData)` es la misma noción que el
`usableSteps` que decide el aviso (`forecast-rules.js`), una etapa más tarde: cuando se
pinta la tabla los payloads ya son campos. Se mantienen en paralelo a propósito — una
tabla de guiones debajo de «el proveedor no responde» son los dos contradiciéndose sobre
si hay previsión.

**Datos parciales siguen pintando.** Esto no es «esconde la tabla si algo falla»: un paso
contestado es una previsión, y los huecos que tenga al lado se ven. Solo desaparece la
tabla que no tiene nada. Hay un test por cada mitad y la mutación `some` → `every` tumba el
segundo.

Tres cosas que costaron una vuelta cada una:

- **El resumen hay que quitarlo, no vaciarlo.** `.compact-summary` lleva borde y relleno
  propios; vaciado queda una caja en blanco sin nada que decir.
- **El test tiene que empezar con una tabla de verdad en pantalla.** Arrancando sin
  cobertura no se construye nunca ninguna, así que afirmar que no está no afirma nada: la
  mutación de vaciar-en-vez-de-quitar pasaba. Ahora carga una ruta que funciona y **luego**
  se cae el proveedor.
- **Y tiene que ser otra ruta, no otro intervalo.** Las respuestas de la misma ruta están
  en caché, así que recalcularla se sirve de ahí y con toda la razón no dice nada. Lo que
  llega de verdad al proveedor es un sitio donde la app no ha estado.

#### Lo que la revisión adversarial le encontró al arreglo

Las dos revisiones —Claude y Codex, por separado— dieron con los mismos tres problemas, y
los tres eran consecuencia directa de quitar la tabla. Quitar la única cosa que había en
pantalla obliga a que lo que queda hable, y no siempre hablaba.

- **Se podía quedar una pantalla sin tabla y sin motivo.** `decideNotice` solo explicaba
  una tabla vacía cuando había habido fallos de transporte (`!usableSteps &&
  transportFailures > 0`), y hay maneras de terminar sin lecturas **sin que falle ninguna
  petición**: un 200 que llega con `hourly.time` y los valores a null —un modelo truncado,
  una fusión que dejó huecos—, o una salida fuera del horizonte, donde ni se pide nada.
  Había hasta un test unitario afirmando que ese caso devuelve `null`. Con la tabla de
  guiones eso era defendible: las columnas vacías eran el mensaje. Sin ella es una ruta en
  el mapa y ninguna explicación. Ahora **toda** forma de acabar sin lecturas dice algo, con
  una cadena nueva (`no_forecast_data`), y el horizonte se dice tanto si `noticeAll` está
  puesto como si no. Medido después: una salida a 20 días no llega siquiera a ese camino,
  porque la app rechaza la fecha antes con su propio mensaje; la rama es cinturón y
  tirantes, y se prueba directamente en `forecast-outcome.test.mjs`.
- **En m/s y en mph el fallo seguía vivo.** `windToUnits` dividía y multiplicaba lo que le
  dieran, y `null / 3.6` es 0. Un paso sin viento salía con viento cero, así que
  `anyReading` lo daba por bueno y la tabla de guiones se dibujaba igual —el fallo
  original, intacto para quien no use km/h— mientras el aviso decía que el proveedor no
  responde. Y la celda ponía «0» en vez de «-», que es otra mentira sobre el mismo hueco.
  Corregido en la raíz: `windToUnits` devuelve null si no le dan un número.
- **El corte se llevaba por delante una comparación.** La salida temprana corre **antes**
  de `compareOwnsTable()`. En modo comparación la previsión ordinaria sigue llenando
  `weatherData` por detrás, así que una vacía llegaba a esa salida y borraba la comparación
  —buena— y su tarjeta de resumen. La comprobación de «sin lecturas» va ahora después de
  respetar quién es el dueño de la tabla.

Cinco tests nuevos, cinco mutaciones, las cinco caen: `windToUnits` devuelto a la coerción,
el aviso de resultado vacío quitado, el predicado reducido a solo temperatura, el orden de
la comparación invertido, y la salida temprana sin la condición. La del orden es de las que
convence: **la suite entera pasaba con ella puesta** antes de escribir el test.

#### Qué cuenta como previsión, decidido y en un solo sitio (18/09)

La primera versión preguntaba por temperatura **o** viento. La decisión del autor:
**temperatura, viento o lluvia** son los valores clave; la humedad no cuenta por sí sola.

La lluvia cuenta como cantidad **o** probabilidad, y la probabilidad es la mitad que
importa: `mergeAromeWithStandard` rellena `precipitation_probability`, `weathercode` y
`cloud_cover` desde la respuesta estándar de Open-Meteo sobre las horas de AROME, así que
la única forma real de acabar con lluvia y sin temperatura es que AROME no cubra esas horas
y la fusión sí traiga la probabilidad. Contar solo los milímetros habría dejado fuera
exactamente ese caso.

**Había cuatro copias de la pregunta y tres respuestas distintas.** `usableSteps` en
`forecast-rules.js`, `anyReading` en `app.js`, el recuento de `showComparisonNotice` y
—la peor— `hasAny` en `compare.js`, que pedía **solo temperatura**. Consecuencias medidas:

- Un proveedor que contesta con viento pero sin temperatura desaparecía entero de la
  comparación. Anterior a todo esto.
- Y al empezar a contar la lluvia para el aviso, apareció un agujero nuevo: `hasAny`
  tiraba las filas de solo lluvia, pero `showComparisonNotice` contaba sobre los datos
  **sin filtrar**, veía la lluvia y por tanto no decía nada. Reproducido: comparación con
  respuestas de solo lluvia = 1 fila, 20px, cero proveedores, **ningún aviso**. Justo el
  «en blanco y en silencio» que esta ronda existía para eliminar.

Ahora hay **una** función, `cwForecastRules.hasReading(step)`, exportada y usada por las
cuatro. Acepta las dos formas del paso —`wind` en el extracto crudo, `windSpeed` en el
procesado— porque la misma pregunta se hace en tres etapas distintas. Cuatro mutaciones,
las cuatro caen; la de `hasAny` **pasaba la suite entera** antes de escribir su test.

#### La regla, afinada después de dos revisiones (18/09)

La primera versión de `hasReading` contaba temperatura, viento, lluvia **o probabilidad**,
cualquiera de ellos con ser un número finito. Las dos revisiones la rompieron por los dos
extremos y la regla quedó así:

    temperatura o viento, siempre que estén — 0 °C y 0 km/h son lecturas
    lluvia, SOLO por encima de cero
    la probabilidad sola no cuenta

Los dos recortes son deliberados y los dos salieron de un contraejemplo concreto:

- **«0 mm» es la ausencia de lluvia, no una previsión.** Contándola, un paso sin
  temperatura, sin viento y con una hora seca bloqueaba la sustitución por una previsión
  preparada (`app.js:1209`) y hacía que el aviso sin cobertura dejara de decir que no había
  nada (`native.js:434`). El usuario perdía una previsión de verdad a cambio de una tabla
  de guiones.
- **Una probabilidad sin cantidad la tabla principal no sabe dibujarla**: `formatRainCell`
  devuelve «-» si no hay cantidad. Contándola se pintaba una fila entera de guiones, que es
  exactamente la pantalla que el guardián de la tabla vacía existe para evitar. La
  comparación sí la dibuja (`0.0 (80%)`), así que si algún día se quiere también en la
  tabla, esto y `formatRainCell` se mueven juntos o vuelven a contradecirse.

Y había una **quinta** copia: `hasData`, en `forecast-rules.js`, que decidía
`preparedCoverage` y pedía temperatura o viento. Ahora es `hasReading`.

Un intento fallido que conviene no repetir: la primera reacción al caso de la probabilidad
fue cambiar `Number(step.precipitation) === 0` por `step.precipitation === 0` en
`aromeCodeAndDay`, para que una probabilidad baja sobreviviera cuando no hay cantidad. Eso
**contradice una decisión deliberada con test propio** (`extraction.test.mjs`: la tabla y la
comparación discrepaban y se las hizo coincidir ahí). Revertido.

#### La comparación, mirada de verdad (18/09)

Se dio por rota y no lo estaba. La conclusión anterior —«con respuestas de solo lluvia la
comparación sigue saliendo vacía»— era un **plazo confundido con un defecto**: la aserción
corría antes de que la comparación repintara. Instrumentado con una espera larga, salían
tres filas, dos proveedores y los pasos con `precipitation: 2` y `precipProb: 80`. Queda
escrito porque es el mismo error que ya había costado un rato en el test que fallaba bajo
carga, y van dos.

Lo que sí estaba mal, y ahora tiene test:

- **`hasAny` pedía temperatura y nada más**, así que un proveedor con lluvia o viento y sin
  temperatura no entraba en la comparación. Con la definición compartida entra.
- **`buildCompareCell` pedía lo mismo**, así que una fila admitida se dibujaba entera a
  guiones. Medido con la regla vieja puesta: todas las celdas de previsión «-» mientras
  `.summary-cell` seguía diciendo `2mm (80%)`.
- **La fila de cadena (OW→AROME→Open-Meteo) estaba exenta del filtro**, admitida hubiera
  llegado algo a ella o no, y sin un comentario que dijera por qué. Lo que compraba eso era
  una columna de guiones: con clave configurada y OpenWeather callado, todos sus pasos
  vuelven en blanco y la fila se pintaba igual. Ahora obedece la misma regla que las otras
  tres.
- **El aviso contaba las filas que llegaron, no las pintadas.** Una comparación que sale
  vacía ya no sale además en silencio.

Tres avisos sobre los tests de aquí, los tres aprendidos con tests que no probaban nada:

- **Borrar la caché de la misma ruta no basta.** La comparación volvía con las temperaturas
  originales en las celdas. Hace falta una ruta que la app no haya visto nunca.
- **`#weatherTable td` incluye `.summary-cell`**, que se construye con su propio array y
  trae el número aunque todas las celdas de previsión sean guiones. Dos veces di por buena
  una mutación por esto. El selector lleva ahora `:not(.summary-cell)`.
- **«Tiene un porcentaje» no es «tiene datos».** OpenWeather contesta con temperatura,
  viento y un 5% de probabilidad, y por debajo del 10% la celda no lo imprime: una fila
  perfectamente buena sin ningún porcentaje. El invariante es que ninguna fila admitida sea
  todo guiones.

Un cambio queda **sin prueba** y se dice: el constructor de la cadena (`src.temp != null` →
`hasReading`). En el escenario del test la cadena resuelve a OpenWeather, que sí trae
temperatura, así que su puerta nunca ve un paso sin ella. Es la misma definición que el
resto y por eso se deja, pero ninguna mutación lo tumba.

#### Lo que quedó dicho antes de mirarlo, y era falso

La sección anterior de este documento decía que `compare.js` seguía sin pintar respuestas de
solo lluvia y que la causa estaba «más arriba». No lo estaba: estaba en las tres puertas de
arriba, y la impresión de que seguía roto venía de un test con el plazo corto. Corregido
arriba; se deja la nota para que nadie vuelva a partir de la afirmación equivocada.

#### El test que fallaba bajo carga: no era el código, era el arnés

`the map still works when storage is unavailable` fallaba en `expect(crashes).toEqual([])`.
Reproducido 2 de 3 veces con `--workers=16`, y 5 de 28 con `--repeat-each=14`; suelto, nunca.

No era una excepción de la aplicación. Lo que recogía el colector eran mensajes de WebKit
sobre peticiones que la propia suite aborta:

    "/api.open-meteo.com/v1/forecast?... due to access control checks."

WebKit los entrega como `pageerror`; Chromium no dice nada. Con la máquina cargada el
aborto cae dentro de la ventana en la que el test mira. Filtrado por la frase exacta de
WebKit —estrecho a propósito, una excepción de verdad tiene que seguir tumbando el test—
en `appCrash`, que usan tanto ese test como `watchForBreakage`. Con el filtro: 28 de 28.
Sin él: 5 fallos de 28.

Conviene recordar la conclusión general más que el caso: **medir antes de llamarlo flake**.
La primera vez que apareció se anotó como «flaky, sin explicar» y se siguió adelante; era
reproducible en dos minutos en cuanto se saturó la máquina a propósito.

#### La pantalla de arranque: era la de Capacitor (18/09)

El icono de la app era el correcto y, al pulsarlo, salían un par de segundos de **pantalla
blanca con el logo de Capacitor** —su cruz azul— antes de cargar el mapa. Las fechas lo
contaban solas: `AppIcon-512@2x.png` del 14/09 (lo escribe `npm run icons`),
`Splash.imageset/splash-*.png` y los `splash.png` de Android del 11/09, la plantilla
intacta. `install-icons.mjs` instalaba el **icono** en los dos proyectos y no tocaba —ni
mencionaba— la pantalla de arranque. El `backgroundColor: "#0B6297"` del
`capacitor.config.json` tampoco ayudaba: el marcador de posición es un PNG blanco a sangre
y tapa el fondo.

Ahora lo escribe el mismo script. `render(source, size)` pasa a ser una envoltura sobre
`renderOnto(source, ancho, alto, cover)`, que dibuja en un lienzo de cualquier forma con
`cover` diciendo qué fracción del **lado corto** ocupa el dibujo. El icono es ese mismo
render en cuadrado y a 1:1, así que sale byte a byte como salía —hay un test que lo compara
con el anterior precisamente para eso—. La pantalla de arranque usa 0,28: el marcador de
Capacitor era una veinteava parte, un logo perdido en un campo blanco, y llenar la pantalla
sería un muro de icono.

Los dos instaladores **leen los tamaños que trajo la plantilla** en vez de codificarlos, lo
mismo que el lado del icono lee `Contents.json`: iOS, los nombres del `Contents.json` del
imageset (tres ranuras, un cuadrado de 2732 que el sistema recorta); Android, la cabecera
de cada `splash.png` que ya existe, para devolver uno de la misma forma. Once ficheros, de
320×480 a 1920×1280, portrait y landscape, sin que el script tenga que saber qué es un
`drawable-land-xxxhdpi`.

Cuatro tests nuevos, tres mutaciones, las tres caen: ignorar `cover` (el dibujo llena la
pantalla), no centrar, y volver a un lienzo cuadrado.

Un detalle de sintaxis que costó un minuto y volverá a morder: escribir `drawable*/splash
.png` dentro de un comentario de bloque lo cierra ahí mismo.

#### Lo que no arregla esto

En español, a 402px, «Velocidad» no cabe en la misma línea que «Fecha»: son unos 11px de
más. **La web hace exactamente lo mismo** —medido, con y sin la clase `cw-native`—, así
que no lo causa nada de esto; es un problema de anchura en un idioma más largo que el
inglés, donde sí caben. Si hay que juntarlas habrá que estrechar el campo de fecha o
acortar la etiqueta, no tocar las alturas.

### Revisión adversarial de Codex (17/09): lo que queda de ella

Diez hallazgos. Cerrados: los códigos de razón de los manifiestos (yo los había «corregido»
mal, ver arriba), el anuncio iOS por fichero en vez de por lote, no dar el intent por
atendido si el registro durable no se pudo escribir, la ventana fija del limitador de
`/share`, el botón Volver de la política (le faltaba `?return=true`), los controles del
panel de configuración bajo el suelo táctil, y las tres afirmaciones de la política que el
código contradecía. Quedan estos, todos con su razón para quedarse:

- **Un fallo transitorio de lectura pierde la ruta para siempre.** `deliver` borra la
  entrada del registro tanto si la lectura fue bien como si falló, así que un
  `IOException` pasajero del proveedor gasta el único intento. Distinguir «fallo
  reintentable» de «rechazo definitivo» pide un contador de intentos en el registro, que
  cambia su formato y sus tests. Se decidió un intento para no reintentar en bucle una
  URI caducada en cada arranque; el término medio está sin hacer.
- **La entrega es «al menos una vez», no «exactamente una vez».** Si el proceso muere
  entre que `store()` publica el fichero en la bandeja y `forgetIntake` borra la entrada,
  el siguiente arranque la entrega otra vez. La ventana son microsegundos y lo contrario
  —borrar antes— pierde rutas, que es el fallo que todo esto viene a evitar.
- **El plugin `CapacitorHttp` puede hacer peticiones al margen de la CSP de la página.**
  Está registrado por Capacitor y construye su `URLSession` sin consultarla, así que la
  CSP no es una imposibilidad técnica para todo el proceso. Por eso las políticas dicen
  «estos tres son los únicos servicios a los que la app se conecta» —una afirmación sobre
  lo que hace— y no «no puede conectarse a ningún otro». No hay indicio de uso de ese
  camino aquí; es la redacción lo que se ajustó.
- **Copias de seguridad del sistema.** Android declara `allowBackup="true"` sin
  exclusiones, así que ajustes y ficheros —incluida la clave sin cifrar— pueden subir a
  la copia automática de Google; en iOS, UserDefaults entra en la copia del dispositivo.
  Las políticas ya lo dicen. Queda por decidir si conviene excluirlo con
  `dataExtractionRules`/`fullBackupContent`: excluir la clave significa excluir el blob
  de ajustes entero, así que el usuario perdería su configuración al restaurar.
- **El reclamo del registro de entrada no tiene test automático.** Lo que impide que una
  ruta se entregue dos veces es que `deliver` salte cualquier URI que `isPendingIntake` ya
  no encuentre. Las dos funciones necesitan `Context` y aquí no hay Robolectric, así que
  el primitivo del registro sí está probado (`ledger_aDeliveredUriCanNoLongerBeClaimed`)
  pero el punto de llamada solo está verificado leyéndolo. Un test instrumentado que
  encole un reintento y un intent con la misma URI cerraría el hueco.
- **`public/style.css` tiene reglas anidadas por accidente, y corregirlo no es poner una
  llave.** Corrección de lo que decía aquí antes: yo afirmé que el bloque de la línea 2106
  no cerraba y que se descartaban ~80 líneas. Es falso, y lo desmontó la re-revisión de
  Codex. El bloque **cierra en la 2179** y el `@media` de la 2076 cierra en la 2191. Lo
  que pasa es otra cosa: las reglas de 2113–2175 quedan **anidadas** dentro del selector
  de inputs/selects, y con CSS nesting eso es válido — se convierten en descendientes de
  esos controles, así que no alcanzan al botón de recientes ni a su menú, pero tampoco se
  tiran. Las de 2182–2190 son hermanas dentro del `@media` y funcionan.
  Y el arreglo no es añadir una llave tras la 2111: entonces la de la 2179 cerraría el
  `@media`, las reglas de 2182–2190 pasarían a ámbito global y la 2191 sobraría. Hay que
  decidir dónde pertenecen las declaraciones 2176–2178 y recolocar el cierre. Sigue sin
  tocarse: desanidarlo activaría sobre los elementos reales los estilos de recientes
  (altura 36px, hover/focus, tooltip, z-index, reglas de ocultación) que nadie ha visto
  aplicados. Merece su propio cambio, mirando la pantalla.
- **Las 19 alertas de Dependabot: ninguna alcanza al código que se envía (revisado el
  17/09/2026).** Son tres paquetes, no diecinueve problemas. `uuid` (1, media) entra por
  `@capacitor/cli` → `xcode`, herramienta de construcción que no se empaqueta. `minimist`
  (2, una crítica) y `xmldom` (16, una crítica) entran los dos por `togeojson@0.16.0`, que
  sí es dependencia de producción — pero lo que `build-www.mjs` empaqueta es el fichero
  de navegador de togeojson, 18 KB, y ahí `minimist` no aparece (es su CLI) y `xmldom`
  aparece **una sola vez, en una rama muerta**:

  ```js
  if (typeof XMLSerializer !== 'undefined') { serializer = new XMLSerializer(); }
  else if (typeof exports === 'object' && ... ) { serializer = new (require('xmldom')...); }
  ```

  En un WebView `XMLSerializer` siempre existe, así que se toma la primera rama. Y aunque
  no se tomara, en `mobile/www` no hay **ni un fichero** de xmldom ni de minimist, ni
  existe `require`. El parseo de KML lo hace `DOMParser` del navegador (`ui.js:311`), no
  xmldom. El runner de segundo plano y `functions/share.js` no usan togeojson.

  Conclusión: no son explotables ni en las apps ni en la web. Lo correcto es descartarlas
  en GitHub como «el código vulnerable no se usa», no actualizar a ciegas: `togeojson` se
  renombró a `@tmcw/togeojson` con otra API, y migrar por unas alertas que no aplican es
  cambiar código que funciona a cambio de nada. Si se migra algún día, que sea por otro
  motivo. Rehacer esta comprobación: `npm ls xmldom --all` y
  `grep -rn "xmldom\|minimist" mobile/www/`.
- **Los tests de Android no están en CI.** `.github/workflows/tests.yml` corre `npm test`
  en ubuntu; los JUnit del ledger se ejecutan a mano (ver `AGENTS.md`, que explica los dos
  flags de JDK que hacen falta en esta máquina).

Cerrados en esta ronda, además de los cinco de antes: **F3** (registro durable de entrada
en `incoming-routes.pending`, con reintento en cada arranque y sin duplicar lo entregado),
**F5** (la lectura de iOS sale del hilo principal y la llegada se anuncia con
`sharedRouteAvailable`, como en Android), **F7** (suelo táctil de 28px medido por tests, ver más
abajo, y nombre accesible para abrir ruta) y el freno de `/share`. Con los
cinco de la ronda anterior, los nueve hallazgos del informe quedan cerrados.

### La ayuda dentro de la app

Ya no es la de la web tal cual: las secciones son `<details>` escritos abiertos (la web
se lee igual que siempre, porque el `summary` no acepta clics; solo `help.js` las cierra
bajo `cw-native`), las recetas para instalar la PWA son `.web-only` y desaparecen dentro
de la app, y el texto se repasó contra el código en los dos idiomas.

- **Sin comprobar en aparato.** `env(safe-area-inset-top)` vale cero en los navegadores
  de la suite y Playwright no puede simular un inset, así que los tests solo afirman que
  la regla existe y que el `calc()` es válido —no que el botón de volver quede por debajo
  de la isla dinámica en un iPhone real—. El `viewport-fit=cover` del que depende lo
  añade `patchBundledHtml`, solo al paquete.
- **La paridad entre idiomas la sostiene un test de estructura**
  (`mobile/tests/help-pages.test.mjs`): mismas secciones en el mismo orden y mismo número
  de encabezados, párrafos y viñetas. Compara la forma, no la prosa: una traducción que
  diga otra cosa con el mismo número de viñetas pasaría.
- **Un `<summary>` sigue respondiendo al teclado en la web.** `pointer-events: none`
  (`help.html:168`) le quita el clic del ratón, pero no lo saca del orden de tabulación:
  con foco, Enter o Espacio siguen plegando la sección igual que dentro de la app. Es un
  lector de teclado o de pantalla, no el común con ratón al que apunta "la web se lee
  igual que siempre". No hay arreglo de una línea que no dependa de JavaScript también en
  la web (el `tabindex` no se puede condicionar solo con CSS), así que queda como límite
  aceptado en vez de tocarlo a ciegas.

### WebKit en Playwright: la causa de los 55 fallos, resuelta

Medido en la tarea 9 sin arreglar nada
(`.superpowers/sdd/2026-09-15-comparar-recientes-meteoblue/task-9-report.md`):
de 260 tests en `mobile-webkit` (`devices['iPhone 14']`, el motor que usa
WKWebView en iOS; se lanza aparte con `npm run test:webkit`, fuera de `npm
test`), 205 pasaban y 55 fallaban. La tarea 11 probó la causa directamente
(origen `http` real, navegadores lanzados a mano, no a través de la suite): en
WebKit, `put` de un `Blob` en IndexedDB falla con `UnknownError`; guardar
texto o un `ArrayBuffer` funciona. Eso explicaba 54 de los 55 fallos — recent
routes escribía la ruta como `Blob` (`meteoride_recent_routes_db`) y la caché
de teselas también (`cw_tiles`), así que en iPhone no se guardaba ninguna
ruta reciente ni se cacheaba ninguna tesela, y de ahí caía en cascada todo lo
que dependía de leerlas después; el fallo 55 era una carrera del propio test
(`page.route` contra `page.goto`), no una diferencia de la app.

Arreglado: recent routes guarda el GPX como texto (`content`, cadena) y la
caché de teselas guarda los bytes (`bytes`, un `ArrayBuffer`) junto con el
tipo; crear un `Blob` en memoria para pintar una tesela o para leer una ruta
sigue funcionando en WebKit, solo falla guardarlo. Un registro de una versión
anterior de Android o de la web sigue teniendo `blob` directamente y cada
lectura cae de vuelta a él, así que no hizo falta ninguna migración. Con eso,
`mobile-webkit` queda en 261/261 y se incorpora a la puerta por defecto:
`npm test` corre ahora los dos motores (`npm run test:webkit` sigue lanzando
WebKit solo).

### Límites aceptados (decididos, no se arreglan salvo que se pida)

- **Plazo de red (H4).** 15 s sin que el servidor empiece a responder o 15 s seguidos sin datos al leer
  el cuerpo. Quedan:
  - El plazo es por servidor, `api.open-meteo.com` (Open-Meteo y AROME) y `api.openweathermap.org`: el
    que no responde se espera una sola vez por cálculo, así que el peor caso son 30 s con los dos.
  - Un paso cuyo proveedor se abandona solo pide a otro servidor: OpenWeather pide Open-Meteo, que es
    global, y nunca AROME, diga lo que diga la cadena. Un paso de AROME o de Open-Meteo no pide nada,
    pero sí usa la respuesta de Open-Meteo que ya esté en caché para ese paso: la regla es no volver a
    esperar en ese servidor, no rechazar datos ya descargados. En la práctica eso solo rescata a un
    paso de AROME: para uno del Open-Meteo estándar la clave que se construye es la misma que acaba de
    fallar unas líneas antes, así que solo puede volver a fallar. Está escrito una vez para los dos
    porque la regla es la misma. Sin nada guardado, esos pasos y los siguientes se quedan sin datos.
    Ante un error HTTP la cadena no cambia.
  - Da igual que el servidor no llegue a responder o que el cuerpo se calle a mitad: el paso sigue el
    mismo camino. Antes, un cuerpo abandonado se saltaba el fallback y caía en el catch general del
    cálculo, así que ese paso se quedaba sin datos mientras los siguientes sí encontraban sustituto.
  - La petición que completa AROME desde el modelo estándar es de mejor esfuerzo: su fallo se lo traga
    un catch y no levanta ninguna bandera, así que tampoco abandona ningún servidor. Lleva una
    grabadora aparte (`bestEffortRecorder`) con la señal y el plazo del cálculo y las notas a ninguna
    parte, una por cálculo, así que un servidor callado ahí sigue costando una sola espera. Sin eso,
    una sola compleción callada dejaba sin datos el resto de una ruta que AROME estaba contestando
    bien, y pintaba que Open-Meteo no responde sobre una tabla pedida de AROME-HD.
  - Una petición a un servidor ya abandonado cuenta como fallo de ese paso, pero no dice nada de la
    conexión: no llega a salir del aparato, así que no marca el cálculo como sin cobertura, que es lo
    que haría que el aviso dejara de nombrar al proveedor.
  - Con un proveedor abandonado, el aviso de la tabla lo nombra en lugar de los avisos de fallback, clave
    u horizonte de ese cálculo, también con los avisos detallados apagados. Es lo decidido, no un límite.
  - **Comprobación en capas.** Que no salga ninguna petición al servidor abandonado lo sostienen dos
    cosas: el salto por servidor de la envoltura, que rechaza al momento, y la lectura solo de caché de
    `app.js`, que ni lo intenta. Quitar solo la segunda no cambia lo que se pide.
  - El cuerpo de una respuesta de error (el fragmento que la tabla anota en el registro) también se corta
    a los 15 s sin datos, pero no cuenta como plazo agotado ni deja de preguntar a ese proveedor.
  - **Un cuerpo que gotea no se corta nunca.** El plazo mide 15 s *seguidos* sin recibir nada, así que
    un servidor que manda un byte cada 14 s mantiene el cálculo en marcha indefinidamente. Es la otra
    cara de la regla decidida (una descarga lenta que sigue llegando no se corta) y es la única forma
    que queda de que un cálculo no termine nunca.
  - La consulta independiente de avisos oficiales tiene plazo y aborto con su propia grabadora, y
    comparte la lista de servidores abandonados del cálculo, así que no vuelve a esperar en uno que los
    pasos ya abandonaron. Si OpenWeather no contesta ahí, no se dice nada.
  - Las peticiones sin grabadora no reciben plazo de la envoltura. La línea base del aviso de ruta se
    pone ahora uno propio, total, de 15 s (`AbortSignal.timeout`): no es la regla de la envoltura, que
    mide silencio, así que una descarga lenta pero viva también se corta ahí; cuesta una línea base que
    el runner siembra en su primera vuelta. Así, la única petición a un proveedor que sigue sin ningún
    plazo es la prueba de la clave.
  - Sin medir fuera de Chromium con reloj falso: `AbortController` y `ReadableStream.getReader()` en
    WKWebView, y una red real lenta, no se han comprobado.

- **Umbral de clave de OpenWeather duplicado.** El primer plano usa `cwWatchRules.hasAlertsKey`
  directamente en los tres sitios que deciden si se puede pedir o mostrar algo con la clave
  (`app.js:3566`, `ui.js:249`, `ui.js:817`), igual que el runner en segundo plano; sin ninguna copia
  de refuerzo por en medio (las dos que había, una en `watch-rules.js` y otra en `app.js`, resultaron
  un riesgo mayor que el que evitaban — la de `ui.js` dependía del propio módulo cuyo fallo debía
  cubrir — y se han quitado). Quedan siete sitios con el literal `5`: la propia definición en
  `public/scripts/watch-rules.js` y seis más que no deciden eso mismo sino si conviene resolver a
  Open-Meteo o incluir OpenWeather en una comparación de proveedores — `app.js` (788, 817),
  `compare.js` (271, 434, 528, 928). Consolidarlos también es un refactor aparte, fuera de alcance
  aquí; el riesgo aceptado es que un cambio futuro del formato de clave de OpenWeather obligue a
  tocar siete sitios en vez de uno.

- **Temperatura en °F.** Resuelto en la fase 7: Open-Meteo y AROME se piden en °F con
  `temperature_unit=fahrenheit`, como OpenWeather con `units=imperial`. Queda una foto preparada
  antes del cambio con °F elegido, que muestra °C bajo °F hasta que caduca (3 h).
- **Caché de OpenWeather (H3).** Una entrada por ubicación y unidades, sin fecha ni hora. Quedan:
  - La clave no distingue si la respuesta se pidió con avisos o sin ellos, igual que antes; la tabla
    solo toma los avisos de una respuesta de red, y los busca aparte con `checkWeatherAlertsIndependent`.
  - Las cifras (147 → 3 escrituras, 900 522 → 18 378 caracteres para `route.gpx`) son con la respuesta
    sintética de los tests; no se ha medido una respuesta real de One Call ni tiempo, fluidez o batería.
  - Las claves con la forma antigua (acaban en la `Z` de la hora) se borran al arrancar, así que una
    respuesta de OpenWeather guardada por la versión anterior no se sirve sin conexión tras actualizar.
- **Fichero roto al arrancar.** Si al arrancar la app se elige un fichero roto antes de que termine
  la restauración, no se restaura la última ruta; el usuario ve el aviso del fallo.
- **Avisos que se pisan.** El aviso de una ruta que no se pudo abrir lo sustituye el aviso propio
  de un cálculo que publica después. Solo los avisos que decide `showNotice` (publicar, comparar,
  repintar) lo olvidan al sustituirlo o borrarlo. Un aviso puesto directamente con `setNotice`
  desde otra parte lo tapa sin olvidarlo, así que una comparación del mismo cálculo sin nada que
  decir deja ese otro aviso visible.
- **Transacción colgada.** Una transacción de IndexedDB que no termina nunca (por ejemplo, una
  apertura bloqueada) detiene la cola de recientes sin aviso: importaciones, subir al principio y
  la carga inicial.
- **Recientes.**
  - Guarda 5 rutas; las de más de 750 KB se muestran pero no se guardan.
  - Un KML guardado antes de la fase 5 quedó como `Nombre.gpx` con el texto ya convertido. Al
    reimportar ese mismo KML hoy (`Nombre.kml`, sin convertir), `idbImportRoute` reconoce el
    registro antiguo por una segunda comprobación: la huella de `cwKmlToGpxText(texto)` de hoy
    contra la huella guardada, ya que la conversión es determinista. Lo sube al principio con el
    nombre y el contenido de hoy en vez de duplicarlo. La caché de previsión y la huella de la
    alerta de ruta calculadas antes con el texto convertido siguen sin coincidir con las de una
    ruta abierta hoy desde ese `.kml`; eso es ajeno a recientes y no se toca aquí.
  - Un choque sobre un nombre largo que la versión anterior guardó sin recortar (la base entera más el
    sufijo) tampoco lo construye ya el recorrido de hoy, que recorta la base primero. Al reimportar esa
    misma ruta se busca ese nombre sin recortar y, si lo tiene un registro con la misma huella, se
    reutiliza su id: la ruta se queda donde estaba y pasa a llamarse con el nombre acotado, en vez de
    guardarse por duplicado. Otra ruta bajo ese nombre antiguo no se toca; solo la huella reclama.
  - `recentRouteName` (`ui.js`), que limpia el nombre antes de todo esto, sigue recortando a 64
    unidades UTF-16 y no a puntos de código, así que un nombre cuyo carácter 64 o 65 sea un emoji
    puede quedar guardado con media pareja suelta. `uniqueRouteName` sí recorta por punto de código.
- **Indicador en el primer arranque.** Sin rutas guardadas, el indicador de carga sigue encendido
  hasta 5 s mientras espera a recientes.
- **Rutas que llegan de fuera.**
  - Android pierde una ruta compartida si el proceso muere entre marcar el intent como gestionado
    y escribir el fichero en el buzón. La importación duradera empieza cuando la ruta llega a
    JavaScript; los buzones nativos quedan fuera (spec §2).
  - El contador de secuencia del buzón de iOS no es único entre procesos: dos rutas guardadas en el
    mismo milisegundo por la extensión y por la app pueden entregarse en otro orden.
  - iOS, «Abrir en»: lee el fichero en el hilo principal (hasta 25 MB).
  - El service worker guarda una sola ruta: de dos envíos antes de que la página lea queda el
    último. `service-worker.js` tiene además dos manejadores `fetch` para `/share`; no se toca
    (spec §2).
  - Una lectura del hueco del service worker que no termina nunca detiene su lector hasta recargar,
    como la cola de recientes.
  - Una ruta de fuera que llega sin que el mapa llegue a existir falla a los 30 s con el aviso de
    lectura, y deja de esperar al mapa en ese momento.
  - Un `shared_id` que ya no está en el servidor (error HTTP) muestra el aviso de lectura; antes no
    decía nada. Recargar un enlace ya usado no vuelve a pedirlo, porque `shared_id` sale de la
    dirección en cuanto llega su texto; abrir otra vez el mismo enlace desde fuera sí muestra el
    aviso.
  - La restauración puede desarmar la alerta de una ruta compartida otra vez. Hay una alerta
    guardada para la ruta S, la reciente más nueva es otra ruta R (importada y nunca confirmada) y S
    se comparte de nuevo en un arranque en frío con el buzón lento. La restauración confirma R antes
    de que salga S y desarma la alerta de S, así que cuando S publica ha perdido lo ya avisado
    (`notified`). Es un caso estrecho y no se corrige.
  - La posición del teléfono se aplica cuando termina el vaciado del buzón, no al arrancar.
  - Una descarga de `?gpx_url=` o `shared_id` empieza aunque su petición quede sustituida en la
    misma vuelta, porque la importación no puede depender de que la petición llegue a leer.
  - Las descargas de `?gpx_url=` y `shared_id` cuentan ahora dentro del plazo de 30 s de su
    petición; antes de la fase 5, `loadFromParams` no tenía plazo. Una descarga lenta falla con el
    aviso de lectura y el `fetch` no se aborta. Si el texto llega después, un enlace `url` no se
    muestra ni se guarda, y un `shared_id` sí se guarda.
  - Una ruta enviada por `postMessage` con el mismo texto y desde el mismo origen en los 30 s
    siguientes al mensaje que la pidió no se vuelve a pedir: su respuesta lleva el resultado de
    aquella petición. Así un reenvío no sustituye un fichero elegido entre medias, pero reenviar a
    propósito la misma ruta dentro de esa ventana no la vuelve a mostrar.
  - Un `shared_id` cuyo cuerpo llega vacío o solo con espacios falla sin borrar la copia del
    servidor y sin quitar `shared_id` de la dirección, así que recargar lo vuelve a intentar.
  - Con un enlace en la dirección (`gpx_url`, `url` o `shared_id`), la lectura del hueco del
    service worker al arrancar solo guarda su ruta entre las recientes y no la muestra.
  - **Ruta compartida durante la lectura de solo-guardar al arrancar.** La página abre con un
    enlace y la lectura del hueco al arrancar es de solo-guardar. Si el service worker escribe una
    ruta S nueva y avisa por mensaje antes de que esa lectura llegue a leer la transacción, S se
    lee en modo solo-guardar: entra en recientes pero no se muestra, aunque su mensaje sí lo pedía.
    La ventana es de milisegundos, solo al arrancar.
  - **Un hueco desfasado gana a un envío del script de usuario.** Una ruta desfasada en el hueco
    del service worker puede ganarle a un envío del script de usuario cuando IndexedDB contesta
    después del `postMessage`. El deduplicado de 30 s reutiliza entonces el resultado
    `superseded` para los reenvíos y el script deja de reenviar, así que la ruta desfasada se
    queda en pantalla. Antes, el reenvío a los 4 s la recuperaba. Hace falta un hueco desfasado,
    algo raro en escritorio.
- **Comparar.**
  - Con la tabla de comparación en pantalla, cambiar idioma o avisos detallados no la repinta.
  - Con comparar fechas abierto (el botón lo abre siempre en modo explícito), un ajuste que
    recalcula pinta la tabla normal encima; la de fechas vuelve con el botón de ejecutar.
  - **Cambio de hora: comprobado, no es un límite.** Open-Meteo y AROME con `timezone=auto` no
    etiquetan en hora local. Cada respuesta lleva un único `utc_offset_seconds`, el vigente en el
    sitio al hacer la petición, y cada etiqueta es el instante UTC más ese desfase, sin hora repetida
    ni saltada. Comprobado el 15/09/2026 contra la misma petición con `timeformat=unixtime`, horas y
    cuartos: Madrid (25–27/10/2025, API histórica), Auckland (26–28/09/2026), Santiago (5–7/09/2026)
    y París con AROME HD, cero discrepancias. La tabla y comparar ya eligen la entrada del instante
    correcto a los dos lados del cambio, y la ventana de la lluvia también. Lo fija «across a
    daylight-saving change each step reads the entry of its own UTC instant» en
    `mobile/tests/forecast-rules-tz.test.mjs`, con una respuesta real recortada.
  - Elegir «comparar» con comparar fechas abierto lanza la comparación de proveedores. La tabla
    deja el modo de fechas al pintarse, así que pulsar una fila muestra ese proveedor; la fila de
    fechas sigue abierta.
  - Sin clave de OpenWeather, comparar proveedores deja OpenWeather fuera sin fila y sin aviso. Es lo
    decidido, no un límite.
  - En comparar fechas con la cadena OpenWeather → AROME → Open-Meteo y una clave de menos de cinco
    caracteres, el paso que llega a OpenWeather pide Open-Meteo, como la tabla. No tiene test.
  - Cuando AROME contesta algo inservible y falla el Open-Meteo que lo sustituye, el aviso nombra a
    AROME-HD.
  - Comparar sin conexión en la web se sigue lanzando y dice que no hay conexión (test de la fase 4).
    Solo la app lo bloquea, porque en la web no se prepara nada.
  - **OpenWeather se lee con la extracción de la tabla.** Comparar conservaba una copia escrita a mano
    que se había separado: sin tope de una hora, así que más allá de las 48 horas que manda One Call
    enseñaba la última hora de la respuesta, de otro día, en la fila de al lado de una de Open-Meteo
    que sí leía el día correcto; el dato diario lo elegía por `dt` crudo en vez de por la fecha local
    del paso; y una `pop` ausente dejaba la celda vacía donde la tabla pone 0 %. Cerrado: la lluvia de
    OpenWeather ya lee la misma hora que Open-Meteo y AROME. La documentación del proveedor
    (`docs.openweather.co.uk/api/one-call-3`, el producto que usa la app) no dice si `rain['1h']` cubre
    la hora anterior o la siguiente a `dt`; su hermano `docs.openweather.co.uk/api/hourly-forecast`, con
    los mismos campos, sí lo dice: "Rain volume for last hour", la hora que termina en `dt`. Con esa
    lectura, `extractOpenWeather` (`forecast-rules.js:126-194`) toma `rain['1h'] + snow['1h']` de la
    entrada cuyo `dt` es H+60 (H la hora del paso redondeada hacia abajo), nunca de la más cercana; el
    resto de campos sigue leyendo la más cercana, como antes. Sin esa entrada, o más lejos de
    `maxGapMs`, la lluvia queda sin valor y el resto del paso no se ve afectado.
  - **Comparar fechas respeta los horizontes.** Pasados los días de OpenWeather el paso pide
    Open-Meteo y pasados los de Open-Meteo se queda sin datos, como en la tabla. Antes no había nada:
    el campo de fecha acepta catorce días y `isProviderOperational` da OpenWeather por operativo a
    cualquier distancia, así que una fecha B lejana enseñaba la última hora que tuviera la respuesta,
    y con la clave de OpenWeather sin fecha ni hora la leía de la caché sin pedir nada.
- **Alerta de ruta.**
  - La línea base lleva la lectura con que se hizo (`BASELINE_VERSION`). Nada vuelve a armar una alerta
    en segundo plano, así que una actualización que cambie de qué entrada sale una magnitud deja
    guardadas líneas base de otra hora: compararlas con la lectura nueva anunciaría el cambio de
    lector como un cambio del tiempo, o taparía uno de verdad. Si no coincide, la primera comprobación
    resiembra la lluvia y no dice nada de lluvia esa vuelta; el viento conserva su línea base y los
    avisos oficiales ya notificados se conservan. En primer plano no se hereda: se vuelve a leer.
  - Una llamada al runner que no responde nunca detiene la cola de guardados y desarmados sin aviso,
    y la ruta anterior puede quedar armada: el desarmado de la ruta confirmada después espera
    detrás en la cola.
  - Una alerta guardada antes de la fase 4 no tiene huella y cuenta como otra ruta, así que la
    primera confirmación la desarma y pierde lo ya avisado una vez. Si falla la lectura de la
    alerta guardada al arrancar, la primera confirmación también desarma.
  - Un guardado que llega después de ser sustituido deja el registro en el runner, pero no
    actualiza la línea de estado.
  - Un guardado que el runner rechaza deja la huella con lo enviado aunque el runner conserve lo
    anterior: la alerta nueva, o nada si era el guardado vacío de una ruta ya terminada. En ese
    último caso, confirmar otra ruta no desarma la anterior. Un desarmado rechazado sí se cubre:
    la huella se anula solo cuando el runner lo acepta.
  - Dos rechazos del runner pueden dejar armada la ruta anterior (reproducido fuera del
    navegador). Hay una alerta X guardada y se confirma la ruta A. El runner rechaza el desarmado, y
    la huella sigue siendo X. Luego A publica y el runner rechaza también su guardado, pero la
    huella ya nombra A, porque se fija antes de que conteste (`saveWatch`). Si A se confirma otra
    vez y no vuelve a publicar, `cwDisarmWatchFor` ve la misma huella y no encola nada. El runner
    conserva X con A en pantalla.
  - **Comprobaciones en capas.** Algunas mutaciones sobreviven solas porque otra comprobación cubre
    el mismo caso:
    - La comprobación tras leer la alerta guardada y la de tras la línea base. Sin la primera, la
      segunda para el guardado. Sin las dos, solo se hace una petición de línea base de más, porque
      el guardado vuelve a comprobar cuando le llega el turno.
    - La de tras la línea base y la del turno del guardado. Entre las dos no hay ninguna espera en
      la que pueda entrar algo que no suba la ficha, así que cada una cubre a la otra. Sin las dos,
      falla «a baseline that answers after another route was confirmed stores nothing».
    - La ficha frente a la foto. Confirmar otra ruta sube la ficha solo si ya se había enviado una
      alerta; confirmar la misma ruta no la sube nunca. La comprobación de la foto en `armWatch` y
      la de la línea de estado tienen cada una un test que falla si se quita solo esa. La de la foto
      en el turno del guardado sobrevive sola: la de `armWatch` va justo antes y el guardado suele
      correr en el mismo turno. Solo haría falta si el guardado esperase en la cola detrás de otra
      operación mientras se vuelve a confirmar la misma ruta, y ese caso no tiene test.
    - La huella no es un detalle equivalente frente a un runner que rechaza. Anularla antes de que
      el runner acepte un desarmado la deja a null mientras el runner conserva la ruta anterior, y
      la siguiente ruta confirmada no desarma; lo caza «a disarm the runner refuses still leaves the
      old route to be disarmed when the next route is confirmed». Volver a fijarla al empezar a
      armar no tiene test que falle, pero tampoco es inocua: con un desarmado rechazado y el armado
      descartado porque se confirma otra vez la misma ruta, la huella nombra esa ruta mientras el
      runner conserva la anterior, y no se vuelve a desarmar (reproducido fuera del navegador).
  - **Hora de la lluvia en zonas de media hora o 45 minutos (abierto, decisión del autor).** El
    aviso pide `timezone=UTC` y lee la lluvia de la hora UTC; la tabla y comparar, de la hora en el
    desfase fijo de la respuesta. En zonas de desfase entero es la misma hora. En las de media hora
    o 45 minutos (India, Nepal, Terranova, parte de Australia) la hora del aviso va 30 o 45 minutos
    desplazada respecto a la de la tabla. No tiene que ver con el cambio de hora. Igualarlas exige
    decidir si la tabla pasa a horas UTC (en India mostraría la lluvia de 10:30 a 11:30) o si el aviso
    pasa a la hora local.
- **Hora y uso sin cobertura (fase 6).**
  - **Hora de salida.**
    - Un campo de hora vacío o ilegible cuenta como una hora pasada: el cálculo usa ahora
      redondeado y lo escribe en el campo, sin aviso. Antes avisaba `route_date_empty` o
      `route_date_invalid`.
    - El redondeo cuenta los segundos: a las 10:00:30 la salida queda a las 10:15. Los relojes falsos
      de los tests de Playwright se instalan un minuto antes del cuarto (`startClock`), porque siguen
      corriendo: cada test tiene 60 s de tiempo real, además de lo que avance con `fastForward`, antes
      de que ahora redondee al cuarto siguiente. Pausar el reloj pararía los temporizadores de la página.
    - El `min` del campo se fija al cargar y no avanza en una sesión larga. Elegir una hora pasada
      la deja escrita hasta que un cálculo, una carga o volver a la app aplican la regla.
  - **Volver a la app.**
    - Llama a `cw.startForecast()` aunque haya una petición de ruta en curso. Si esa petición
      confirma, el cálculo de la ruta anterior queda sustituido.
    - Una foto reproducida tiene la antigüedad del registro, así que cada vuelta con cobertura la
      recalcula, y sin cobertura la vuelve a reproducir.
    - Sin cobertura y sin foto preparada que sirva para la nueva salida no recalcula: la tabla se queda
      con las horas de la salida anterior hasta que haya cobertura, con el aviso
      `offline_cannot_recalculate`. Sobre una foto reproducida (fuera de margen, o caducada y ya avisada)
      no lo dice y deja su propio aviso.
    - Sin cobertura, con la salida sin mover y una foto en vivo de más de 30 min, cada vuelta a la app
      vuelve a mostrar `offline_cannot_recalculate`.
    - Con la salida sin mover y el último cálculo aún en marcha no relanza nada, aunque la foto en
      pantalla tenga más de 30 min.
    - Nada recalcula cuando vuelve la cobertura con la app en primer plano: solo volver a la app, un
      ajuste que recalcula u otra ruta.
  - **Ajustes sin cobertura con una foto reproducida.**
    - Un ajuste que no es la hora se rechaza, pero queda guardado. Nada lo aplica cuando vuelve la
      cobertura hasta otro cambio, volver a la app u otra ruta.
    - Un cambio se rechaza solo si difiere a la vez de los ajustes que leyó el último lanzamiento (un
      cambio rechazado pasa a ser esa referencia) y de los de la foto en pantalla. Volver al ajuste que
      muestra la foto, o salir de comparar, se acepta y la reproduce.
    - La foto reproducida lleva la velocidad y el intervalo de la preparada, aunque los de la página
      sean otros.
    - Elegir comparar no cuenta como cambio. Con comparar elegido, sobre una foto reproducida o sin
      cobertura en la app se pinta la tabla normal con sus marcadores y el aviso de que comparar necesita
      cobertura.
  - **Reproducción.**
    - El aviso de antigüedad mide la foto (`createdAt` al publicar), no las respuestas, que pueden
      venir de caché.
    - El resultado (`outcome`) de una reproducción es el de la foto guardada con `preparedAt` y
      `preparedFor`. No se recuentan los pasos utilizables en modo reproducción.
    - Una reproducción muestra los avisos oficiales guardados solo si están activados ahora.
    - Un registro con la forma correcta pero con respuestas de proveedor malformadas por dentro no se
      detecta: `wellFormed` comprueba la forma del registro y de cada paso, no el contenido de `payload`.
    - Fuera del margen la tabla sale sin datos aunque la respuesta guardada cubra esa hora.
  - **Arranque y caducidad.**
    - La petición de arranque lleva `source: 'recent'` también cuando abre la ruta preparada: la
      fuente se fija antes de leer y nada la usa.
    - Con cobertura, la ruta preparada dentro del margen también se abre al arrancar en vez de la
      reciente más nueva, y se calcula en vivo (spec §4.9.3, pasos 1 y 7).
    - Una transacción de IndexedDB de la foto preparada que no termina nunca deja preparar sin
      respuesta. Retiene la restauración al arrancar hasta el plazo de 30 s de su petición, que
      termina con el aviso de lectura.
    - Borrar la foto caducada al arrancar puede borrar una que se prepare en ese mismo momento.
    - El aviso de caducidad sin cobertura lo tapa enseguida el del cálculo que viene después
      (`offline_no_data`).
    - Cuando la restauración no pide nada (un enlace, el traspaso por `sessionStorage`, una ruta ya
      pedida), la foto preparada se carga para la sesión. Si para entonces la ruta que llegó publicó una
      tabla en vivo sin datos, o no hay nada publicado ni en marcha, se relanza una vez y se reproduce;
      con datos en pantalla no se relanza.
    - Una ruta preparada cuyo GPX no se abre se borra y se abre la última reciente, una sola vez, solo si
      el borrado salió bien y no se ha pedido otra ruta desde la petición de arranque. El aviso
      `route_load_failed` queda en pantalla. Si el borrado falla no se abre nada, y el registro roto se
      vuelve a probar en el siguiente arranque.
    - Un registro mal formado se borra al leerlo, en una transacción que vuelve a comprobarlo. La
      caducidad no lo comprueba otra vez y puede borrar una foto preparada en ese momento (ver arriba).
  - **Sin medir.** El tamaño real de la foto en IndexedDB (la spec estimaba del orden de 1 MB para
    unas 20 etapas).
- **Tests que faltan.**
  - Fase 6, sin test que las tumbe:
    - leer los ajustes dos veces al lanzar (equivalente: las dos lecturas caen en el mismo turno);
    - quitar la corrección de `setupDateLimits` (equivalente a la regla al cargar);
    - la comprobación `origin !== 'live'` al preparar con una foto reproducida en pantalla, porque
      solo se prueba sin foto;
    - un registro sin huella, sin `outcome` o con avisos que no son una lista (otra versión, sin
      unidades y un paso nulo sí tienen test); quitar las dos últimas comprobaciones no hace fallar nada,
      porque reproducir no las lee de forma que lance;
    - la segunda comprobación dentro de la transacción que borra un registro mal formado;
    - limitar a una vez el reintento tras borrar un GPX preparado roto (equivalente mientras se exija que
      el borrado haya salido bien);
    - IndexedDB no disponible al preparar;
    - que la web no reproduce;
    - `replayIfComputedWithout` (native.js) ya no relanza mientras la última petición de ruta sigue
      leyéndose (`cw.hasRouteRequestPending`, nuevo, a partir de `lastFinished` del coordinador: a
      diferencia de `hasRouteRequests`, que una vez cierta ya no vuelve a false en la sesión, esta sí
      refleja si la última petición ha terminado): esa petición confirmará y calculará por su cuenta.
      No tiene test que lo tumbe: haría falta una lectura de ruta retrasada todavía en curso justo
      cuando termina la lectura del registro preparado (una carrera de milisegundos entre dos
      promesas), poco fiable con los helpers actuales;
  - La carrera entre la migración desde `localStorage` y una importación.
  - IndexedDB no disponible.
  - Una excepción dentro de `publish`.
  - Un `logDebug` que lance dentro del `catch` del cálculo acabaría en rechazo no gestionado.
  - El aviso de comparar fechas y el de datos caducados en comparar (mismo código que el de
    proveedores, sin test propio).
  - La comprobación justo antes de pintar de comparar fechas: la cubren la del bucle y la previa a
    escribir en caché, salvo si la sustitución cae en la espera de 30 ms tras el último paso.
  - Que lanzar un cálculo suelte las reclamaciones `compare:*`.
  - Que `cwCancelComparisons` suelte las reclamaciones `compare:*`. No se puede observar hoy:
    cambiar de proveedor y cerrar comparar fechas siempre acaban lanzando un cálculo, que ya las
    suelta. Lo lanzan al momento, o al terminar la petición de ruta que lo retiene, y esa petición
    mantiene el indicador encendido mientras tanto. Que lanzar una comparación suelte las
    anteriores sí tiene test, con un proveedor que no contesta.
  - La comprobación de la foto en el turno del guardado de la alerta de ruta, con el guardado
    esperando detrás de otra operación en cola (ver «Comprobaciones en capas»).
  - Un `?gpx_url=` que falla con otra ruta en pantalla. En la web no puede haberla antes, porque la
    petición del enlace se hace al cargar la página; lo cubre el test de la fase 3 de una petición
    fallida.
  - Cuatro de los tests de la fase 5 pasan también con el código anterior: la reciente tocada tras
    leer una compartida, cuatro compartidas seguidas, el traspaso por `sessionStorage` y el enlace
    confirmado que entra en recientes. Fijan un comportamiento que ya existía, y a cada uno lo hace
    fallar una mutación. En el de cuatro compartidas, «la puerta de IndexedDB abierta en orden
    inverso» no puede abrirse de verdad fuera de orden, porque cada escritura espera a la anterior.
  - Tests de la primera tanda de correcciones de la fase 5 que también pasan con el código anterior,
    porque fijan un comportamiento que ya existía y cada uno cae con una mutación: de los tres de
    `shared_id` que falla, solo el de 404 cae quitando `res.ok`; el de red cae igual sin tocar
    `res.ok`, porque ahí `fetch` rechaza él solo antes de que el código llegue a mirarlo, y el de
    cuerpo vacío cae quitando el `if (!text.trim())` de `loadSharedIdIfPresent`, que es lo que de
    verdad lo sostiene (su respuesta es 200, así que `res.ok` ya vale true y no pinta nada); el
    DELETE que no se espera (cae con `await`), el `shared_id` que se guarda aunque falle el DELETE
    y se agote el plazo, el origen no permitido de `postMessage` (cae con `allowed = true`) y el de
    la petición anterior al arranque (cae quitando `hasRouteRequests()` de la restauración).
  - Tests de la segunda tanda de correcciones de la fase 5 que también pasan con el código anterior,
    y la mutación que tumba a cada uno: el `shared_id` que falla por 404 y conserva `shared_id` y
    la copia del servidor cae quitando `res.ok`; el mismo test por red conserva lo mismo pero no
    cae con esa mutación, porque `fetch` ya rechaza por su cuenta sin pasar por `res.ok`; el
    `shared_id` cuyo texto llega
    después de agotarse el plazo y aun así se guarda (cae importando solo al confirmar); el enlace
    sustituido en la misma vuelta cuya descarga falla sin rechazo sin gestionar (cae quitando
    `arrived.catch`), y el origen no permitido, que ahora sirve la app desde
    `https://foreign.example` con `route.fetch` en vez de `[::1]` (cae con `allowed = true`).
  - Dos protecciones sin test que las tumbe: `tx.onabort = () => done(null)` en la lectura del hueco
    del service worker (`gpx-share.js`), y `if (!arrived) centreOnUser()` en `native.js`, que queda
    tapada por las comprobaciones del propio `centreOnUser`.
  - El script de usuario (`tools/userscripts/tamper_meteoride.user.js`) deja de reenviar con la
    primera respuesta a su envío. No tiene tests: se comprobó solo leyendo el código.
  - Plazo de red (H4): que un aborto por sustitución no cuente como fallo. Contarlo no se vería, porque
    el cálculo o la comparación sustituidos ya no publican. El salto de los puntos siguientes solo se
    prueba en la tabla; comparar pasa por la misma envoltura, sin test propio de plazo.
  - Los seis arreglos pequeños de la ronda de cierre no tienen test que los tumbe, porque hoy no se
    pueden observar desde la suite: la copia de la lista de servidores abandonados que recibe la
    consulta de avisos (solo se vería lanzándola en paralelo con los pasos, que es justo lo que no se
    hace); que una petición nunca enviada ya no marque el cálculo como sin cobertura (siempre hay
    además un fallo de verdad que sí lo marca); soltar la escucha del aborto al acabar el cuerpo (es
    memoria, y la señal se recoge al terminar el cálculo); el comentario de que la lectura de caché
    tras un plazo solo rescata a AROME (no cambia comportamiento); quitar los horizontes de repuesto
    y `localChainResolve` de `compare.js` (código muerto: `window.cw.horizons` y el resolutor de
    `utils.js` existen siempre, y sin ellos compare.js ni arranca); y el plazo de la línea base del
    aviso de ruta (haría falta un servidor que acepte la conexión y no conteste nunca).
  - La etiqueta `source` de cada entrada solo se ve envolviendo `cw.requestRoute`; la comprueban
    los tests de `shared_id`, no los del resto de entradas.
  - El reinicio de `keepOnly = false` en `takeSharedFromServiceWorker` (gpx-share.js ~228-233) no
    tiene test: nada comprueba que una segunda vuelta del lector, disparada mientras la primera
    seguía en modo solo-guardar, deje de guardarlo y vuelva a mostrar lo que encuentre.
  - La parte del test de deduplicado de `postMessage` que reenvía desde otro origen permitido
    solo comprueba que no se pide otra ruta, no el acuse: la respuesta va a un origen que esta
    página no es y se pierde, así que no se puede observar.

### Sin comprobar en dispositivo

- **Tareas en segundo plano.** Nunca se han ejecutado por la vía real ni en iPhone ni en
  Android, así que ninguna alerta de ruta ha llegado todavía.
- **WKWebView.** Nada de esto se ha probado en un iPhone real: la CSP, la red de seguridad del
  parseo de GPX (un temporizador de 0 ms, probado solo en Chromium), la lectura de teselas de
  OpenStreetMap con `fetch`, y la durabilidad de IndexedDB entre sesiones. El fallo de guardar un
  `Blob` en IndexedDB (recent routes, tile cache) está confirmado y arreglado contra el motor
  WebKit real (tarea 11: prueba directa del controlador, origen `http`, navegador lanzado a mano,
  y `npm run test:webkit` en 261/261), pero eso sigue siendo WebKit de escritorio, no un iPhone.
- **Android.** Probado en emulador, no en dispositivo físico.
- **Uso sin cobertura real.** Sin comprobar en ninguno de los dos, incluida la reproducción de una
  ruta preparada tras cerrar la app y la durabilidad del registro en IndexedDB de WKWebView en un
  iPhone físico.

### Publicación: resuelto

Los diez enlaces de la ayuda a la guía apuntan a `blob/main/docs/GUIA.md` (y `GUIDE.md`).
Estuvieron dando 404 mientras `docs/` solo existía en la rama; el merge del PR #1
(`baf7f8e`, 2026-09-16) los arregló y ambos responden 200 comprobado por HTTP, no solo por
la API de contenidos. Ya se puede desplegar la web.

Queda en pie el motivo por el que esto necesitó una nota a mano: el test comprueba que el
enlace está en la página y que el fichero existe en el árbol de trabajo, no que la URL
resuelva. Si algún día las guías se mueven de sitio dentro del repositorio, el test seguirá
verde y los enlaces volverán a romperse.

### Compartir desde otra app: por qué se retiró la share extension (18/09)

**Síntoma.** Compartir una ruta desde Hammerhead no abría MeteoRide. La hoja se cerraba y
no pasaba nada — pero la ruta estaba dentro la siguiente vez que se abría la app a mano.

**Dos fallos, y cada uno tapaba al otro.**

1. `cc.meteoride.gpx` estaba declarado en `UTImportedTypeDeclarations` y se pasó a
   `UTExportedTypeDeclarations`. **Corrección posterior (revisión de Codex): esto casi con
   seguridad no era el fallo.** Apple dice que una declaración importada existe justamente
   para que el sistema conozca un tipo "aunque la app propietaria no esté instalada", así
   que la vinculación `.gpx` probablemente funcionaba desde el principio. Exportado sigue
   siendo lo correcto —el tipo es nuestro— pero es una decisión de corrección, no una
   causa demostrada: los dos cambios se hicieron juntos y nunca se separaron.
2. La share extension se llevaba la pulsación. **Esto sí está aislado**: es lo único que
   se retiró para la prueba en dispositivo. Los dos mecanismos ponen un MeteoRide en la
   hoja, con el mismo nombre y el mismo icono, indistinguibles mirándolos. El log del
   dispositivo lo cerró: `activityType: cc.meteoride.app.ShareExtension`, hospedada dentro
   del proceso de Hammerhead, guardando el fichero y completando, sin ningún lanzamiento de
   app en toda la captura. Y una share extension no puede abrir su app contenedora: Apple
   le da `NSExtensionContext.open` solo a los widgets de Hoy, e iOS 18 rechaza el truco de
   la cadena de respondedores.

**Arreglo.** UTI exportado, y fuera la extensión. Probado en dispositivo quitando el
`.appex` de *Embed Foundation Extensions* — reversible, sin borrar el target — y funcionó a
la primera. Los ficheros de la extensión se han borrado del repositorio.

**Lo que sigue sin confirmarse, y da igual.** Se
[dice](https://developer.apple.com/forums/thread/735383) que desde iOS 16 la presencia de
una extensión *elimina* la entrada de documento de la misma app. Ese hilo no tiene
respuesta de Apple y aquí no se ha separado de la hipótesis del icono equivocado. Para la
decisión de no llevar extensión, cuál de las dos sea es indiferente.

**Deuda que queda.**

- El App Group tiene un solo miembro. Se queda: `MeteoRideShareStore` vive en su
  contenedor y moverlo huerfanaría cualquier ruta ya guardada.
- `meteoride://` sigue declarado en iOS y ya no lo abre nadie. En Android sí está vivo.
- El tercer campo del nombre de fichero del buzón iOS (8 hex de un UUID) existía porque
  dos procesos escribían esa carpeta. Ahora escribe uno. Se deja por no renombrar ficheros
  que una app instalada pueda tener ya.
- `LSHandlerRank` es `Alternate` para una entrada que cubre a la vez el UTI propio y el KML
  de Google. Lo honesto sería partirla en dos y poner `Owner` en la nuestra. No se ha
  tocado porque funciona y no había motivo para mover dos cosas a la vez.
- Nada de esto se compila aquí. `mobile/tests/document-open.test.mjs` **parsea** los
  plists y falla ante siete mutaciones comprobadas, entre ellas la causa raíz original
  (borrar la vinculación `.gpx`), y sigue verde ante un reordenado de claves.

**Lo que encontró la revisión adversarial de esta misma ronda, ya corregido.**

- **KML tenía el mismo fallo y nadie lo había visto.** `CFBundleDocumentTypes` lista
  `com.google.earth.kml` y *ese identificador no lo declaraba nadie*: iOS no trae tipo KML
  propio y la app tampoco lo declaraba. Ahora va en `UTImportedTypeDeclarations`
  —importado, porque este sí es de otro—. Hasta ahora `.kml` solo vinculaba si alguna otra
  app instalada lo exportaba, y la extensión borrada lo tapaba aceptando cualquier fichero.
- **El test no cazaba lo que decía cazar.** La primera versión usaba regex y pasaba con un
  typo de sufijo en cualquiera de las dos mitades y con la vinculación `.gpx` borrada. Mi
  comprobación por mutación no lo detectó porque elegí un renombrado que no contenía la
  subcadena. Reescrito con un parser.
- **Las copias del sistema no se borraban nunca.** Con
  `LSSupportsOpeningDocumentsInPlace: false` iOS copia cada documento abierto a
  `Documents/Inbox` de la app y entrega esa copia, que es nuestra. Nadie la borraba: la
  poda de 24 horas solo barre la carpeta del App Group. Cada ruta abierta se quedaba en el
  sandbox para siempre, hasta 25 MiB cada una. `ingest` la descarta ahora, acepte o
  rechace el fichero, y solo si está bajo ese directorio.
- **`MeteoRideShareStore.swift` mandaba crear el target borrado.** Su cabecera decía "este
  fichero tiene que pertenecer a AMBOS targets". Corregido.
- **La política de privacidad publicada describía la extensión**, en los dos idiomas, y es
  el documento que lee un revisor de Apple. Corregida.
- Barrido de documentación: una docena de menciones obsoletas en `AGENTS.md`, `docs/IOS.md`
  (incluidas dos contradicciones dentro del mismo fichero), `docs/INSTALL.md` y
  `public/scripts/native.js`.

### Revisión adversarial de Codex sobre la retirada de la extensión (18/09)

Siete hallazgos. Cuatro arreglados, uno corregido como error de relato, dos abiertos.

**Arreglados.**

- **Alto — la limpieza que acababa de añadir borraba la entrega aunque fallase guardarla.**
  El `defer` estaba puesto antes de leer y de guardar, así que una ruta válida en
  `Documents/Inbox` se borraba también si la lectura daba error o no había espacio:
  `ingest` devolvía `false`, nadie anunciaba nada y desaparecía la única copia. Ahora solo
  se descarta ante una respuesta **definitiva** —guardada, o rechazada por lo que el
  fichero es—; un fallo de E/S la conserva.
- **Medio — nada recogía `Documents/Inbox` al arrancar.** Quedaban sin recuperar la ruta
  cuya lectura interrumpió una terminación, las que fallaron por algo pasajero y todo lo
  acumulado antes de que existiera esta limpieza. `SceneDelegate` llama ahora a
  `recoverSystemInbox()` al arrancar, en la misma cola serial y después de las URL que
  trajo el lanzamiento. Lo que pase de 24 horas se tira sin leer, que es la política que ya
  tenía la carpeta del App Group y lo que evita reintentar para siempre un fichero que
  falla siempre. Ojo: los 25 MiB limitan lo que se **acepta**, no el tamaño de la copia que
  iOS ya escribió; el único tope de esas es la edad.
- **Medio — el parser del test aprobaba un plist distinto del que creía comprobar.**
  `<array/>` se leía como `false` y satisfacía la aserción booleana; el CDATA de
  `<string>gpx<![CDATA[wrong]]></string>` se descartaba en silencio; una etiqueta con
  atributos se saltaba entera. Ahora los tres fallan a gritos, con sus propias aserciones.
  Añadidos MIME, `CFBundleTypeRole`, y una comparación contra el `Info.plist` generado —
  que es el que se compila y no estaba cubierto por nada.
- **Medio — el proyecto Xcode se había renombrado a `MeteoRide.xcodeproj`.** Ajeno a esta
  tanda, y con tres víctimas, todas silenciosas:
  1. `cap sync` dejaba de escribir `CapApp-SPM/Package.swift` —el fichero que lista las
     dependencias SPM de cada plugin— con un `[error] ENOENT` en mitad de su salida que
     no rompe nada hasta que se añade o se sube un plugin, y entonces el build de iOS
     simplemente no se entera.
  2. La sincronización de `MARKETING_VERSION` en `build-www.mjs` era un no-op.
  3. **Y `tests/version.test.mjs` existía justamente para cazar (2), pero saltaba**
     anunciando "ejecuta `cap add ios` primero", que era falso.

  Capacitor codifica `App/App.xcodeproj` a fuego (`@capacitor/cli/dist/config.js`), así que
  el proyecto se ha renombrado de vuelta: `Package.swift` y la versión vuelven a escribirse.
  El nombre visible de la app sale de `CFBundleDisplayName`, no del proyecto. El test
  distingue ahora "iOS sin generar" (salta) de "iOS generado con el proyecto renombrado"
  (falla, y dice por qué), y `docs/IOS.md` lo advierte en la receta de publicación.

**Corregido como error de relato.** Ver arriba: el cambio de UTI importado a exportado
probablemente no era el fallo, y yo lo conté como tal. Rectificado en el plist, en
`docs/IOS.md`, en `docs/HANDOFF.md` y en los comentarios del test.

**Abiertos, decididos y no arreglados.**

- **Alto, preexistente — `nextPending()` borra la entrega antes de que JavaScript la haya
  guardado de forma duradera.** Matar el proceso entre ese borrado y el commit en IndexedDB
  pierde la ruta. Arreglarlo de verdad pide un protocolo de acuse entre el nativo y el web
  con identificador estable para no duplicar al reintentar, y eso es un cambio de diseño,
  no un parche. No se toca en esta tanda; queda aquí escrito. Afecta igual a Android.

  **Cuán probable es, medido antes de aparcarlo (18/09).** Poco. `nextPending()` borra el
  fichero *y devuelve el texto en la misma llamada*, así que cuando desaparece la ruta ya
  está en memoria de JavaScript; lo que falta es que `importIt` la escriba en IndexedDB,
  unos milisegundos síncronos sin red, sin usuario y sin esperar al mapa. Para perderla el
  proceso tiene que morir justo ahí. El único escenario que no es mala suerte pura es
  **jetsam por memoria**, y se concentra donde más duele: al arrancar, con el mapa cargando
  y hasta 25 MiB de ruta ya en memoria, en un dispositivo viejo.

  La consecuencia también es menor de lo que suena: el fichero original de la app emisora
  no se toca, así que el usuario vuelve a compartir. No es pérdida de datos, es una ruta
  que hay que mandar otra vez. Lo que sí es cierto es que **nada la recupera**: al guardar
  bien, la copia del buzón del sistema ya se ha borrado. La ventana es estrecha y no tiene
  red debajo.
- **Bajo — el proyecto Xcode local conserva restos de la extensión**: el esquema
  `ShareExtension.xcscheme` apunta a un target que ya no existe, y `project.pbxproj` guarda
  referencias al `ShareViewController.swift` borrado. No vuelven a incrustar nada —la fase
  de *embed* está vacía— pero el esquema es inválido. `mobile/ios/` no está en git, así que
  esto es limpieza a mano en Xcode, junto con borrar el target.

### Revisión de la respuesta a App Review (19/09): cuatro pasadas

Sobre `1eca34c` y el texto para la respuesta de la 2.1: dos pasadas adversariales de Claude
(código y texto), una de Codex y una haciendo de revisor de Apple. Todas de solo lectura.

**Arreglados.**

- Licencias: `www/THIRD-PARTY-NOTICES.txt` reúne todo lo que la app lleva, nativo incluido.
  Faltaban el aviso zlib de pako (su cabecera declara «MIT AND Zlib»), los iconos de
  marcador (BSD-2, de pointhi/leaflet-color-markers), Capacitor y sus plugins, el código
  Apache de Cordova dentro de Capacitor y las librerías ion-ios que baja SPM.
- La ayuda y la política de iOS mencionaban Android dentro de la app: un rechazo 2.3.10
  rutinario. Se oculta por plataforma (`cw-ios`/`cw-android`), no se borra, porque el
  mismo `www/` va a las dos apps.
- El interruptor y el botón de depuración ya no aparecen en la app (2.1/2.2); la web los
  conserva.
- El botón «🔍 Check» de la clave de OpenWeather preguntaba por el centro del mapa, que al
  arrancar es la posición del teléfono, y las políticas prometen que esa posición no se
  envía nunca. Ahora pregunta por un punto fijo.
- La ayuda decía 48 h para AROME-HD (la cadena normal corta en 36 h; 48 es la comparación),
  que las alertas se «encienden» (vienen encendidas), que el iPad gira (la app es solo de
  iPhone) y que la clave de OpenWeather es gratuita (tiene que ser de One Call 3.0, con las
  condiciones que ponga OpenWeather; no se ha podido comprobar si piden tarjeta).
- `CFBundleLocalizations` [en, es] en el plist.

**Abiertos, decididos.**

- **`processing` en `UIBackgroundModes` se queda.** El plugin solo usa
  `BGAppRefreshTaskRequest`, pero su README exige «Background fetch» y «Background
  processing» como mínimo, y quitarlo solo se puede comprobar en un dispositivo.
- **Idioma al primer arranque en iOS, sin verificar.** Sin `CFBundleLocalizations`,
  WKWebView podía dar a `navigator.languages` solo el inglés en un iPhone en español. Ya
  está declarado, pero nadie lo ha visto funcionar: el texto para Apple no lo promete.
- **La copia de iOS se queda atrás si no se sincroniza.** `ios/App/App/public` no tenía
  ninguna de las licencias nuevas: antes de archivar, `npm run sync`.

### Segunda ronda sobre la respuesta a App Review (19/09)

Claude (código), Codex y el revisor de Apple simulado, sobre `55f0f9d` y `5635757`.

**Arreglados.** QuickJS 2025-04-26 va compilado en el `.aar` Android de background-runner y
no tenía aviso; tampoco lo tenían las librerías ion de Android ni el classpath de Gradle
(AndroidX, Kotlin, Gson, play-services). El test de avisos era circular (leía la lista de la
que se genera el fichero); ahora lee los `build.gradle`, `Package.swift` y `.aar` de cada
plugin. La licencia de los iconos de marcador se sirve también en la web. La ayuda ocultaba
Android pero seguía describiendo en la app lo que solo hace la web (`?gpx_url=`, atajos que
suben a Cloudflare, la rueda del ratón). Las «48 h de AROME en la comparación» eran falsas:
la comparación corta en 36 h como todo lo demás. Una preferencia de depuración guardada dejaba
la captura de logs encendida, oculta y sin forma de apagarla. Declarar `es` sin
`es.lproj/InfoPlist.strings` dejaba el aviso de ubicación medio traducido; ya existe, y un
build de simulador lo lleva dentro.

**Sin explicar.** «loading a route does not fold the controls» falló en webkit una vez en la
suite (la tira abierta medía 290 px de 374) y 2 de 5 aislado justo después. Luego, 40 de 40 con
el mismo código y 10 de 10 en `1eca34c`, `55f0f9d` y `5635757`. Había dos daemons de Gradle
vivos por la resolución de dependencias; no está demostrado que fueran la causa.

**Abierto.** `android-maven.txt` se escribe a mano desde `./gradlew :app:dependencies`: nada
comprueba las dependencias transitivas. El build de iOS sigue en `CURRENT_PROJECT_VERSION` 6
y su copia de `public/` está atrasada: `npm run sync` y subir el número antes de archivar.

### Tercera ronda sobre la respuesta a App Review (19/09)

Claude (código), el revisor de Apple simulado y Codex (`/codex:adversarial-review`), sobre
`5635757..5f8d88d` y el texto v4.

**Arreglados.** `logDebug` metía cada línea en `#debugConsole` con el panel cerrado: miraba
`style.display`, que el atributo `hidden` no toca (web y app, desde siempre; `dfa24f9` decía
haberlo arreglado y no era así). El test de `InfoPlist.strings` aceptaba ficheros que iOS lee
vacíos; ahora los parsea y, en macOS, los contrasta con `plutil`. El de avisos de licencia miraba
solo plugins `@capacitor/`, no leía `runtimeOnly` ni `.kts` y aceptaba nombres por subcadena. La
licencia de los iconos deja de ser un enlace simbólico. La ayuda de la app ya no dice que hay una
web detrás («lo que un navegador no puede hacer», «la aplicación web»; las políticas decían
«navegador interno»), no enlaza a la guía (que habla de Android y de instalar la web) y explica
la comparación con los controles que existen. La ruta de ejemplo cruzaba el mar, el puerto y el
aeropuerto; ahora es Castelldefels–Garraf por la C-31, calculada sobre OSM. Texto v5: 3920 bytes.

**Abierto.** Las dependencias transitivas de Gradle siguen fuera de cualquier test
(`android-maven.txt` a mano). QuickJS y Play services aparecen en los avisos también en iOS
porque `www/` es común; nadie los ve (el fichero no está enlazado). `processing` en
`UIBackgroundModes` se queda sin uso, documentado. Antes de archivar: `npx cap sync ios`,
comprobar que `ios/App/App/public/THIRD-PARTY-NOTICES.txt` existe y que `utils.js` es el nuevo,
subir el build a 7 o más, y que la grabación enseñe el permiso de notificaciones y «Watching…»,
porque el texto lo afirma.

### Cuarta ronda (19/09)

Claude (código), el revisor de Apple simulado y Codex, sobre `5f8d88d..9ee79db` y el texto v5.
Ninguna regresión en el código. **Arreglado:** el puente de `console.*` metía cada error en la
consola de depuración oculta y en la web la abría sola; los ajustes en español decían
«Unidades/i18n», «Check», «API Key», «Compare» y «Fallback»; el escáner de dependencias nativas
no leía `fileTree`, `releaseImplementation`, el módulo de plugins de Cordova ni los
`binaryTarget` de Swift. La ruta de ejemplo pasa a ser una vuelta real del autor por Mont-roig
(la de Garraf salía de OSM y pedía atribución ODbL). Texto v6, 3882 bytes: no nombra el fichero
de licencias (empieza por `@capacitor/android`) y cita los rótulos como salen en pantalla.
**No se cambia:** `AROMEHD_MAX_HOURS` sigue en 48; la cadena corta a 36 h y bajarlo dejaría
vacía la columna de AROME entre 36 y 48 h en la comparación. Codex lo leyó como que la app usa
48 h; el comentario ahora lo explica.

### Correcciones de preparación para App Review (19/09, build 7)

Las alertas por cambios de previsión usan ahora `active`: pueden referirse a una salida
muchas horas después y deben respetar Focus y los resúmenes. Se ha quitado el entitlement
Time Sensitive del proyecto iOS local. `UIBackgroundModes` queda en `fetch`, tanto en la
plantilla como en el proyecto local; esto sustituye la decisión histórica de conservar
`processing` descrita arriba. La configuración añade un User-Agent identificable de
MeteoRide para los mosaicos de OpenStreetMap. Open-Meteo aparece enlazado junto al mapa y
la tabla, con CC BY 4.0 en la tabla y explicación del procesamiento en ambas ayudas.

`docs/APP-REVIEW-REPLY.md` contiene el borrador revisado; requiere vídeo real del build 7,
modelo/iOS y contraste con el mensaje original de Apple antes de enviarlo.

Verificación nueva: 290 pruebas Node y 649 de navegador aprobadas, una omitida; pruebas
de regresión de alertas y atribución fallaron antes de corregirlas y pasan después.
Build de simulador, archive 1.0.0 (7) y exportación App Store Connect correctos. El IPA
tiene firma Apple Distribution válida, `get-task-allow=false`, familia iPhone, sólo
`fetch`, sin Time Sensitive ni extensión de compartir. Los recursos del archive
coinciden con `mobile/www`, incluido `THIRD-PARTY-NOTICES.txt`.

Archive conservado en Xcode: `~/Library/Developer/Xcode/Archives/2026-09-19/MeteoRide-1.0.0-7-AppReview.xcarchive`.
IPA local, ignorado por Git: `mobile/ios/releases/1.0.0-7/MeteoRide.ipa`.
Carga del build 7 en App Store Connect completada el 19/09 a las 16:24 (hora local):
`Upload succeeded`, paquete procesándose. No se ha enviado a revisión ni publicado.
La herramienta de interfaz no pudo seleccionar Simulator: instalar y lanzar la app
funcionó, pero no se certifica inspección visual nativa. Pendientes: dispositivo real
con TestFlight, compatibilidad iPad, vídeo, cuestionario App Privacy y respuesta original.

### Caducidad de las teselas (19/09, después del build 7)

La revisión final encontró que `tile-cache.js` guardaba cada tesela hasta el tope de 1200 y la
servía sin conexión aunque fuera de hace meses, y que la ayuda lo anunciaba («vuelven a salir
sin conexión»). La política de teselas de OpenStreetMap prohíbe el uso sin conexión y pide
respetar las cabeceras de caché. Ahora cada tesela guarda la caducidad de su respuesta
(`max-age`, `Expires`, o 7 días sin cabeceras; `no-store`/`no-cache` no se guardan), una caducada
no se sirve nunca y la poda la borra. La ayuda, las guías, IOS.md y el README ya no prometen
el mapa sin conexión. **El build 7 subido no lleva este cambio**: no afecta a la respuesta a
Apple (el texto no promete mapas sin conexión), pero hay que incluirlo en el siguiente build.

Revisión adversarial (Claude y Codex) de este cambio: el mapa pedía las teselas a los
subdominios `{s}.tile.openstreetmap.org`, que la política ya no admite; ahora usa
`tile.openstreetmap.org` y la CSP (app y web) nombra ese host exacto. El User-Agent
identificativo pasa al nivel superior de `capacitor.config.json`, así que también lo envía
Android. Un `Expires` que no se entiende cuenta como caducado. El barrido de caducadas corre
como mucho una vez al día (la lectura ya las rechaza). Codex señaló que `max-age` cuenta desde
la recepción sin descontar `Age`: esa cabecera no es legible por CORS, y OSM envía
`stale-if-error=604800`, que autoriza servir una tesela caducada 7 días más cuando falla la
red, que es cuando esta caché se lee; queda explicado en el código.
