# Respuesta para App Review

## Build 11 — respuesta al rechazo del 21/09/2026

Apple rechazó 1.0 (9) el 21/09 (submission `f7c9f37f-da39-47e8-9301-be089aad8f54`, iPad Air
11" M3) por 5.1.1(ii), el texto del permiso de ubicación, y 1.5, la Support URL. Esta respuesta
va en el mismo hilo. **Enviarla sólo cuando todo lo siguiente sea cierto:**

1. **Push a `main`** (despliega la web). Comprobar el CONTENIDO, no el código de estado: la web
   devuelve 200 con la portada de la app para cualquier URL que no existe, y el 21-22/09 eso es
   lo que servía `support.html`.
   - `curl -sL https://app.meteoride.cc/support.html | grep -o support@meteoride.cc | wc -l` → 4
     (enlace y texto en cada idioma; hoy da 0); en una ventana privada se ve el título
     «MeteoRide — Support / Soporte». Si redirige a `/support`, vale.
   - `curl -sL https://app.meteoride.cc/privacy-ios.html | grep -c "22 September 2026"` → 1: la
     política publicada es la nueva (la del 19/09 aún mandaba los fallos a GitHub).
2. Correo de prueba a `support@meteoride.cc` **y** a `privacy@meteoride.cc`: llegan y se pueden
   responder.
3. Support URL = `https://app.meteoride.cc/support.html` en todas las localizaciones de App Store
   Connect. Revisar a la vez la descripción, las palabras clave y la Marketing URL: nada de
   Android, web, PWA ni donaciones (la web lleva las tres cosas; mejor dejar la Marketing URL
   vacía que apuntarla a app.meteoride.cc).
4. Build 11 subido, procesado y seleccionado en la versión (que no quede ni el 9 ni el 10). El 10
   se subió para probar en TestFlight y no lleva el formato nuevo de las políticas.
5. Capturas del diálogo de ubicación en inglés y en español, del build 11 (hay capturas del
   simulador iPad Air 11" M3 en `mobile/ios/releases/1.0.0-11/`; el texto del permiso es el mismo desde el build 10; mejor las de TestFlight en un
   iPhone).
6. **Notes de la versión** (App Review Information → Notes). Las que hay en App Store Connect son
   un texto corto propio, no el bloque largo de la sección del build 9 (ese se envió como
   respuesta en el hilo). Sustituirlas por esto, que añade la ruta de ejemplo (el revisor usa
   un iPad y no tendrá un GPX) y alinea la ubicación con el permiso nuevo:

   ```text
   MeteoRide is a cycling weather planning app. No login is required.

   To test the app without a file, tap "Try an example route" on the map: a sample route bundled with the app loads and the forecast is calculated with Open-Meteo, which needs no account or API key. You can also import your own GPX or KML route with the 📁 button or through the iOS share sheet, and change the departure time or the cycling speed to recalculate.

   OpenWeather is optional and requires the user's own API key. It is not required to test the main functionality.

   Previously prepared forecasts and cached map tiles can be viewed offline. Fetching new forecasts requires an internet connection.

   Location permission is optional. It is requested when the app opens with no route loaded, only to centre the map on the user's area. The position is not saved or sent to the weather services, and it is never used in the background. Weather forecasts use the route's coordinates.

   Support: https://app.meteoride.cc/support.html (support@meteoride.cc).
   ```

   Comprobar también que el campo Privacy Policy URL sigue en
   `https://app.meteoride.cc/privacy-ios.html`.
7. Responder en el hilo con el texto de abajo y las dos capturas, y **después pulsar «Resubmit
   to App Review»** con el build 11 seleccionado: responder no reenvía. El estado tiene que
   pasar a «Waiting for Review».

```text
Hello,

Thank you for your feedback. We have addressed both issues from the September 21 review.

Guideline 5.1.1(ii)
Build 1.0 (11) includes updated location purpose strings in English and Spanish. They explain that the location is used only to centre the map where the user is when the app is opened with no route loaded, and give a specific example: if the user opens the app while travelling, the map starts on the town they are in instead of a default city. They also say that the position is not saved or sent to the weather services, since forecasts use the points of the user's route, and that the permission can be declined. In addition, the location is never requested or used in the background.

On a fresh installation, with Location Services enabled and permission not yet determined, opening the app without a route triggers the location prompt. Screenshots in English and Spanish are attached.

Guideline 1.5
The Support URL is now https://app.meteoride.cc/support.html, a public page in English and Spanish with support information and a direct contact, support@meteoride.cc, which requires no account. The same address is in the Support section of the in-app help (the ? button).

Thank you for reviewing the updated submission.
```

## Build 9 (enviado el 19/09, rechazado el 21/09)

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
Attached, recorded using build 9 on an iPhone 17 Pro running iOS 27.0, starting from the Home Screen. Build 10 changes only texts and one layout detail. MeteoRide has no account creation, login, account deletion, public user posts, purchases or paid features, so none of those flows exist to show.

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
  Linked to the user's identity: **Yes**. Por defecto la ruta va a Open-Meteo sin identidad,
  pero con la clave de OpenWeather del usuario las mismas coordenadas le llegan a OpenWeather
  asociadas a su cuenta; la respuesta tiene que cubrir ese caso.
  Used for tracking: **No**.
- **Identifiers → User ID** (la clave de OpenWeather del usuario, que le identifica ante
  OpenWeather como cliente). Purpose: **App Functionality**. Linked: **Yes**. Tracking: **No**.
  Encaja en User ID («account ID… that can be used to identify a particular user or
  account») mejor que en Other Data. Vincular la ubicación no la cubre: es otro dato que sale
  del dispositivo.
- Criterio: ante la duda, declarar (`docs/IOS.md`). La alternativa mínima —tratar
  OpenWeather como servicio del propio usuario, ubicación no vinculada y clave sin declarar— es
  defendible, pero no se mezclan: o las dos cosas o ninguna.
- Nada más: sin contacto, sin identificadores, sin uso, sin diagnósticos, sin compras, sin
  contenido de usuario (el GPX no sale del dispositivo, solo coordenadas muestreadas).
- El `PrivacyInfo.xcprivacy` del paquete solo declara las API de acceso requerido; no
  contradice nada de lo anterior.

