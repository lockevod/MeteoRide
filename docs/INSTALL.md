# Installing and running MeteoRide

There are three ways to get going with MeteoRide, and only two of them involve
installing anything. This is which one you want.

| You want | Read |
|---|---|
| To use it, nothing else | Open <https://app.meteoride.cc>. There is nothing to install. |
| The App Store / Play Store app | [Native apps](#native-apps-ios--android) |
| To run your own copy | [Your own copy](#running-your-own-copy) |

---

## Native apps (iOS / Android)

**Installing them:** iPhone from the [App Store](https://apps.apple.com/es/app/meteoride/id6813109920).
Android from the APK attached to each [GitHub release](https://github.com/lockevod/MeteoRide/releases/latest)
(Android 7.0+; the release notes walk through allowing the install, and every APK is signed
with the same certificate so the next one installs over it). The rest of this section is
about building them.

MeteoRide is built as a real App Store / Play Store app with
[Capacitor](https://capacitorjs.com). It runs the very same code from `public/`
inside a native shell, so there is no second codebase to maintain.

What the native build adds:

- **Native share sheet, both ways**: share a GPX to MeteoRide from Files, Mail,
  Komoot, Strava or any other app, and send the loaded route back out to a head
  unit app such as Hammerhead. No upload to a temporary server — the file
  never leaves the device.
- **`.gpx` / `.kml` file handler**: "Open in MeteoRide" from anywhere on the
  system.
- **Fully offline assets**: Leaflet, SunCalc and the weather icons are bundled
  instead of loaded from a CDN.
- **Settings that stay put**: units, language, your API key, recent routes and
  map tiles are kept in native storage, so they survive the system reclaiming
  the web view's data.
- **Ride alerts**: after you plan a route, a background check re-reads its
  forecast and notifies you if rain or strong wind appears where there was none,
  or an official warning is issued for the ride.
- **Useful without coverage**: the app reopens on your last route and still
  shows the forecast it downloaded, labelled with its age, instead of an empty
  table. A button pins the prepared route's forecast so it is not cleared. Map
  tiles you have already looked at are kept too.

The project lives in `mobile/`. Per-platform instructions:

- [IOS.md](IOS.md) — build, Xcode setup and how another app opens a route in MeteoRide.
- [ANDROID.md](ANDROID.md) — build and the share intents, already wired.

```bash
cd mobile
npm install
npm run add:ios   # iOS only, once; the Android project is already in the repo
npm run ios       # or: npm run android
npx playwright install chromium
npm test          # rebuilds mobile/www and runs the suite over it
```

`npm test` is the only command that rebuilds the bundle. Running `npx playwright
test` on its own tests the previous `www/`.

---

## Running your own copy

No installation is required: download the code and open `index.html` in a
browser, or serve `public/` with any ordinary web server (Apache, Caddy, nginx,
`python -m http.server`…).

```bash
git clone https://github.com/lockevod/MeteoRide.git
cd MeteoRide
open public/index.html      # or serve the directory
```

Everything works this way except the POST handoff (`/share`) used by the
Hammerhead exporter userscript, which needs a server that accepts POST. That is a deployment
question, not an installation one: see [DEPLOY.md](DEPLOY.md).
