# Respuesta para App Review

No enviar hasta adjuntar la grabación del build 9 (iPhone 17 Pro, iOS 27.0).
El vídeo debe mostrar el arranque desde el icono, la ruta de
Mont-roig, la previsión, un cambio de salida, el permiso de notificaciones y el estado
«Watching … until …». Añadir importación, exportación y reapertura offline al recorrido
de prueba; sin conexión, el fondo del mapa puede salir en blanco (las teselas caducan por
la política de OpenStreetMap), y la ruta y la tabla sí se ven. No se ha contrastado este borrador con el mensaje original de Apple.

El bloque siguiente es el texto para Notes y para responder; las comprobaciones de
TestFlight y App Privacy siguen siendo necesarias. No se ha enviado a Apple.

```text
Thank you for the review. Answers to each point follow.

1. Screen recording
Attached, recorded using build 9 on an iPhone 17 Pro running iOS 27.0, starting from the Home Screen. MeteoRide has no account creation, login, account deletion, public user posts, purchases or paid features, so none of those flows exist to show.

2. Purpose and audience
MeteoRide is a free weather planner for cycling. The user loads a GPX or KML route, sets a departure time and an average speed, and the app shows the forecast at each point of the route for the time the rider is expected to reach it, as a table and on the map. It is for cyclists, mountain bikers and walkers planning a route.

3. How to use the main features
The bundled example needs no account, imported file or API key.
- Launch the app on a fresh installation. It may ask for location permission to centre the map; declining it changes nothing else.
- Tap "Try an example route" on the map. A sample ride bundled with the app (a 42.5 km loop from Mont-roig del Camp, Spain) loads and the forecast table fills in automatically.
- Change the departure time or the speed: the forecast is recalculated.
- The 📁 button opens your own .gpx or .kml file. Routes also open from Files, Mail or another app's share sheet.
- With a route loaded, the 📤 button exports it through the share sheet, and the 📴 button saves it with its forecast for use without coverage.
- Ride alerts are on by default: in ⚙️ → Alerts, "Tell me if the weather on the route changes" is on. After a forecast the app may ask for notification permission and shows "Watching <route> until <time>" below that switch. The row above it, "Show official weather alerts", is optional and needs an OpenWeather key. While the ride is ahead, a background check notifies if rain or wind on it gets worse. iOS decides when the check runs, so an alert cannot be triggered on demand; the recording shows the permission request and the watching status.

4. External services
The app contacts three services directly, with no server of ours in between:
- Open-Meteo (api.open-meteo.com): forecasts, including the AromeHD model. No key.
- OpenWeather (api.openweathermap.org): an optional provider and official warnings, only with a One Call API 3.0 key from the user's own OpenWeather account. The core forecast, import/export, offline preparation and ride-change alerts need no key.
- OpenStreetMap (tile.openstreetmap.org): map tiles, with attribution shown on the map.
The background alert check uses the same forecast services. There is no AI, analytics, advertising, tracking or authentication service. Routes are read on the device; forecast requests carry sampled route coordinates and, like any request, the IP address, but no added user or device identifier other than the user's own OpenWeather key when set.

5. Regional differences
None in features. Only the forecast model varies with provider coverage: AromeHD, selectable under Provider, covers France and nearby regions, up to 36 hours ahead in the normal forecast; elsewhere, or further ahead, the app uses Open-Meteo's global forecast. The app is in English and Spanish, selectable in ⚙️, with units in °C/°F, m/s, km/h or mph, km/mi and mm/in.

6. Regulated industry and third-party material
Not a regulated industry; no licence or documentation of that kind is needed. It is a planning aid, not a safety or emergency service. Weather data comes from the public APIs above, under their terms. Map data is © OpenStreetMap contributors. The licence texts of all bundled open-source components ship inside the app.

Native iOS functionality
Background forecast checks with local notifications that respect Focus and notification summaries (ride alerts can be turned off in ⚙️), opening GPX/KML from other apps, exporting through the share sheet, location while in use, and a route saved with its forecast for use without coverage.
```

## App Privacy (App Store Connect → App Privacy)

Rellenar según `public/privacy-ios.html` y `docs/IOS.md` («App Store review»). No declarar
«Data Not Collected»: cada previsión envía las coordenadas de la ruta a Open-Meteo, que
dice conservarlas en sus registros hasta 90 días, y eso ya no es un tratamiento efímero.

- **Privacy Policy URL:** `https://app.meteoride.cc/privacy-ios.html`.
- **Do you or your third-party partners collect data from this app?** Yes.
- **Location → Precise Location.** Purpose: **App Functionality**, solo esa.
  Linked to the user's identity: **No** (la ruta viaja sin cuenta ni identificador; la clave
  de OpenWeather, solo si el usuario pone la suya, se trata abajo).
  Used for tracking: **No**.
- **Other Data → Other Data Types** (la clave de OpenWeather del usuario). Es el caso
  discutible: la clave es del propio usuario y OpenWeather no es socio del desarrollador,
  pero la identifica ante OpenWeather. Declararla es la lectura prudente: Purpose **App
  Functionality**, Linked **Yes**, Tracking **No**. Omitirla es defendible; si se omite,
  no hay que tocar nada más.
- Nada más: sin contacto, sin identificadores, sin uso, sin diagnósticos, sin compras, sin
  contenido de usuario (el GPX no sale del dispositivo, solo coordenadas muestreadas).
- El `PrivacyInfo.xcprivacy` del paquete solo declara las API de acceso requerido; no
  contradice nada de lo anterior.

