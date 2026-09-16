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

- Rama: `native-ios-capacitor` (todo lo de abajo está ahí; `main` no lo tiene).
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
| Recibir GPX/KML desde otras apps (share sheet, "Abrir en") | iOS: `mobile/native/ios/**` (share extension + App Group + plugin). Android: `mobile/android/.../MainActivity.java`, `MeteoRideShareStore.java`, `MeteoRideSharePlugin.java`, intent filters | JS probado; Swift **nunca compilado**; Java compila contra stubs |
| Enviar la ruta cargada a otra app (Hammerhead, Files…) | botón 📤 en `native.js` (Filesystem CACHE + Share) | probado |
| Ajustes persistentes fuera del web view | `cwSettings` espejado a Preferences; restore al arrancar | probado |
| Sin cobertura: último pronóstico (≤12 h) etiquetado, ruta restaurada al abrir, botón 📴 que fija la caché, teselas del mapa cacheadas (IndexedDB), aviso "mapa sin conexión", mensajes de proveedor caído | `public/scripts/utils.js`, `tile-cache.js`, `native.js` | probado; CORS de teselas OSM **sin verificar en dispositivo** |
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
  no copiado, para que editar el fichero del repo actualice el target.

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
share extension, parche del plugin, `backgroundRefreshStatus`), la app arranca en el
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
- Borrar la rama remota obsoleta `claude/cool-allen-w8evld` (desde GitHub, por el
  autor: una sesión de agente recibe 403).
- La suite corre ya en Chromium y WebKit (`npm test`, tarea 11 + cierre de la
  tarea 9/10), pero solo en el WebKit de escritorio de Playwright; sigue sin
  probarse en un iPhone físico.
- `.github/workflows/tests.yml` (tarea 13) ejecuta `npm test` (Chromium y WebKit) en
  cada PR y en cada push a `main`/`native-ios-capacitor`, sin secretos. El resultado se
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
git checkout native-ios-capacitor
cd mobile && npm install                                 # postinstall parchea el runner
```

Prompt sugerido para un asistente:

> Estoy en el repo MeteoRide, rama `native-ios-capacitor`. Lee `AGENTS.md`,
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
en `AGENTS.md → Open work`. Última actualización: ronda de correcciones de cierre (revisión de toda la rama, dos
revisiones adversariales internas y una revisión adversarial externa).

### Pendiente por fase del rediseño

- **Fase 7 — retirada y documentación.**
  - Hecho: fuera `pinCacheKeys` y `cachedWeatherKeys`; `cw_offline_pinned` se borra una vez al
    arrancar y el vaciado por cuota trata igual todas las entradas de caché.
  - Hecho: repaso final de `AGENTS.md` y de este documento contra el código (recuentos de tests y
    cobertura de la suite al día). El rediseño no tiene más fases pendientes.
  - Hecho (tarea 13): `.github/workflows/tests.yml` ejecuta la suite completa en cada PR
    y en cada push a `main`/`native-ios-capacitor`; ver §7.

### Hallazgos de la revisión del 14/09 aún abiertos

- Ninguno: los seis están corregidos (§9).

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
