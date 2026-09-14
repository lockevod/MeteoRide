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
npm test                    # build de www + tests Node + Playwright (43 + 16 + 9)
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

Verificado aquí: **89 tests** (55 Playwright sobre el bundle real con la red cortada y
el bridge nativo simulado; 16 de reglas; 9 del runner ensamblado con KV/notificaciones/
fetch simulados; 5 de iconos; 2 de nombres de plugin; 2 de traducciones); Java
compilado contra stubs; nombres de API de Capacitor 8.5.2 cotejados con las fuentes de
`node_modules` (`CAPBridgedPlugin`, `registerPluginInstance`, `capacitorDidLoad`,
`SceneDelegateProxy`, `BackgroundRunnerPlugin.registerBackgroundTask`); `cap sync
android` ejecutado y los gradle generados commiteados.

Verificado por el autor en su Mac: el Swift **compila** (plugin, view controller,
share extension, parche del plugin, `backgroundRefreshStatus`), la app arranca en el
simulador, carga un GPX desde Archivos, calcula previsión y muestra el toggle de
alertas con su aviso de límites del sistema.

**No verificado** (no hay Xcode ni SDK Android en el entorno de desarrollo, y el autor
aún no ha probado en dispositivo físico):
- La tarea en segundo plano en dispositivo real (iOS y Android). En el simulador de
  iOS BGTaskScheduler **no se ejecuta nunca**, así que ninguna alerta ha llegado aún
  por la vía real; lo único probado es la lógica pura y el runner con stubs.
- Que OpenStreetMap permita leer teselas con `fetch` desde `capacitor://localhost`
  (si no, el mapa funciona igual pero sin caché; hay fallback).
- La CSP `<meta>` de la app solo se ha validado en Chromium, no en WKWebView.
- Nada se ha compilado ni ejecutado en Android más allá de `cap sync`.

## 7. Trabajo abierto / ideas

La lista completa está en `AGENTS.md → Open work`; esto es lo que hay que tener
presente para la app nativa:

- Probar en iPhone y Android **físicos**: las tareas en segundo plano no se ejecutan
  en el simulador, así que ninguna alerta ha llegado aún por la vía real.
- Firma de release de Android sin configurar: `assembleRelease` no firma.
- Borrar la rama remota obsoleta `claude/cool-allen-w8evld` (desde GitHub, por el
  autor: una sesión de agente recibe 403).
- Suite solo en Chromium; iOS usa WKWebView. Añadir el proyecto `webkit` de
  Playwright cerraría casi todo ese hueco.
- Nada ejecuta los tests automáticamente: un job de GitHub Actions en los PR cuesta
  unas pocas líneas.
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
> sección 9 de `docs/HANDOFF.md`.

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
| **H1** (alta, preexistente) | `app.js:514` resetea, `:1013` escribe, `:1090/:1099` pintan | Dos cálculos solapados corrompen el `weatherData` global: el segundo resetea mientras el primero sigue escribiendo, y gana quien termine el último. Toca también las alertas, porque el evento `cw:forecast` (`app.js:1425` → `native.js:635`) consume ese mismo global. Visto al arreglar H2: en la suite, **una sola carga de ruta** deja cada paso tres veces en `weatherData`, intercalado; no hace falta cambiar parámetros deprisa. Causa: `bindUIEvents` e `initUI` escuchaban los dos `#gpxFile` e `initUI` se ejecutaba dos veces (al cargar `ui.js` y en DOMContentLoaded desde `app.js`), así que cada fichero lanzaba tres cálculos. **Corregido ese disparador** (un listener, `initUI` con guarda, test en `smoke.spec.mjs`); **Corregida también la carrera**: cada ejecución de `fetchWeatherForSteps` toma un número (`forecastRun`), acumula en local y solo la última publica tabla, avisos, alertas, `cw:forecast` y `hideLoading`; `mobile/tests/forecast-runs.test.mjs`. Queda fuera `compare.js`, que escribe `weatherData` sin número. |
| **H2** (alta, código propio) | `native.js:344-358` | `prepareForOffline` coge **todas** las claves de caché frescas, sean de esta ruta o no, ignora el booleano que devuelve `pinCacheKeys` y luego dice "{n} puntos" contando entradas de caché. Siempre informa de éxito. **Corregido**: reconstruye las claves de los pasos pintados con `makeCacheKey` y distingue nada, completo, parcial ("n de total") y fallo al fijar; cuatro tests en `smoke.spec.mjs`. |
| **H3** (media) | `app.js:993-1007` | La caché de OpenWeather guarda el JSON completo por cada hora: ~49 escrituras del mismo objeto. |
| **H4** (media) | bucle de proveedores | Secuencial y sin timeout de aplicación: un proveedor lento cuelga toda la previsión. |
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
  llamadas a `reloadFull` y `fetchWeatherForSteps` por fichero elegido. Mirar solo
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
corrección de `utc_offset_seconds` solo cubre la tabla; `public/scripts/compare.js` todavía
elige las horas de Open-Meteo con `window.cw.findClosestIndex` en la zona del teléfono, así
que un teléfono en otra zona que la ruta puede ver horas distintas en comparar que en la
tabla hasta que se mueva a las mismas reglas, en la fase 4.

La fase 2 (registro, foto y publicación) tiene su plan en
`docs/superpowers/plans/2026-09-14-fase-2-registro-foto-publicacion.md`, también fuera de
git. Cada cálculo anota lo que ven sus peticiones en su propio registro, lee sus ajustes una
vez y termina en una foto con pasos, alertas oficiales y resultado; solo `publish()` la lleva
a pantalla, y el aviso sale de `decideNotice`, sin temporizadores (H5). Con ella se corrigen
la casilla «mostrar alertas», que nunca dejaba fuera los avisos, y la unidad con que se lee
al repintar una respuesta de OpenWeather cacheada. Mientras no llegue la fase 4, comparar no
da avisos de proveedor y `revalidateWeatherAlerts` sigue mostrando alertas por su cuenta. Las
fases 3 a 7 tendrán cada una su plan cuando empiecen.
