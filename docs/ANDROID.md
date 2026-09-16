# MeteoRide for Android

The Android app is the same Capacitor shell as the iOS one, running the web app from
`public/`. Unlike iOS, the generated project is committed (`mobile/android/`), so the
share handling is already wired and nothing has to be recreated by hand.

## Requirements

- Android Studio (Ladybug or newer) with SDK 36 installed.
- JDK 21.
- Node.js 20+.

`minSdkVersion` is 24, so Android 7.0 and up.

## Build and run

```bash
cd mobile
npm install
npm run android     # build www + cap sync + open Android Studio
```

Then press Run. Any change under `public/` only needs `npm run sync` before running
again, and `npm test` first if you touched the web app. Never run `cap add android`: the project already exists and the command would
overwrite the share handling.

## What is already wired

`MainActivity` registers a small plugin and parks any incoming route in an inbox that
the web layer drains. The three pieces live next to each other:

| File | Job |
|---|---|
| `MeteoRideShareStore.java` | reads the incoming `content://` URI and stores the route on disk |
| `MeteoRideSharePlugin.java` | exposes `consumePending()` to JavaScript, same contract as iOS |
| `MainActivity.java` | pulls the route out of the intent on launch and on `onNewIntent` |

The manifest accepts three things:

- **Share sheet** (`ACTION_SEND`, `ACTION_SEND_MULTIPLE`) for GPX, KML, XML and
  `application/octet-stream`. That last type is there because many apps hand a `.gpx`
  over with no better type; the code checks the file name and sniffs the content, so
  anything that is not a route is ignored. If MeteoRide shows up too often in your
  share sheet, delete that one `<data>` line from `AndroidManifest.xml`.
- **File open** (`ACTION_VIEW`) for `.gpx` and `.kml` from a file manager, a download
  or a mail attachment.
- **`meteoride://`**, the same custom scheme the iOS build uses.

Routes are stored under the app's private files directory and deleted as soon as the
web layer reads them.

The ride-alert watch (see the iOS document for what it does) runs through
`@capacitor/background-runner` on WorkManager, which needs nothing in the project
beyond what is committed: the `flatDir` line in `app/build.gradle` for the plugin's
engine, `POST_NOTIFICATIONS` in the manifest (Android 13 asks the user the first time
a forecast is computed), and the config in `capacitor.config.json`. WorkManager will
not run more often than every 15 minutes and Doze defers it further; vendors with
their own battery managers (see dontkillmyapp.com) can stop it altogether, which the
app cannot detect beyond the plain battery-optimisation flag it shows a hint for.

Notifications go to a high-importance channel the app creates the first time it arms
a watch, so they show as heads-up. The channel is created from the web view with
`@capacitor/local-notifications`; the runner cannot create channels, only post to
one by id.

## Testing the share flow

The app only accepts `content://` URIs, the way every real sender hands files over.
Push the route to `Download/` and open it through the system documents provider,
granting read access the way a file manager would:

```bash
adb push route.gpx /sdcard/Download/
adb shell am start -a android.intent.action.VIEW \
  -d "content://com.android.externalstorage.documents/document/primary%3ADownload%2Froute.gpx" \
  -t application/gpx+xml --grant-read-uri-permission \
  -n cc.meteoride.app/.MainActivity
```

That exercises the file-open path. The share sheet cannot be driven meaningfully from
`adb`, because the `content://` URI and its permission grant come from the sharing
app: open a file manager, long-press a `.gpx` and pick Share. Watch either path with
`adb logcat -s MeteoRide Capacitor/Console`.

## Passing a route between apps

Plan in Komoot, check the weather in MeteoRide, send it to a head unit. Both directions
go through the system share sheet, so any app that can hand over a `.gpx` works without
MeteoRide knowing about it.

- **Receiving**: share an exported route to MeteoRide, or use "Open in MeteoRide" from
  a file manager or a mail attachment.
- **Sending**: the 📤 button in the header hands the loaded route to the share sheet,
  where you pick Hammerhead, Files, Mail or anything else.

Sharing a *link* rather than a file does nothing, deliberately. Komoot, Strava and
Bikemap gate their downloads behind a logged-in session, so a shared URL fetches a
login page rather than a route.

## Without coverage

Out of signal the app keeps showing the last forecast it downloaded, labelled with how
old it is, rather than an empty table. It stops at twelve hours, and it never prefers
cached data while a connection works.

The app reopens on the route you had last, so opening it out of signal shows that
route with the forecast already downloaded rather than an empty screen. A route shared
in from another app takes precedence over it.

The 📴 button saves the forecast for the route you have loaded, so the entries survive
the clear-out that runs when storage fills up. Press it at home before leaving.

Map tiles you have already looked at are kept on the device and come back without a
connection, so the area you studied at home still has a background. A stretch you never
opened will be blank, and the map says so: tiles are only stored as you view them,
never downloaded ahead, which is what OpenStreetMap's terms allow.

## What is in the bundle

Every library, font and image the app draws with is inside it, and the build fails if a
reference to another site creeps back in. The bundled pages also carry a
Content-Security-Policy meta tag, which the website gets from `public/_headers` instead;
that file is a Cloudflare feature and is stripped from the bundle.

Two things still come off the network at runtime and cannot be bundled: map tiles from
OpenStreetMap and the forecast APIs. Everything else works with the device offline.

`?gpx_url=` is a website entry point and is unreachable here, since nothing navigates
the web view to a URL with a query string. That is why the policy lists the forecast
hosts instead of allowing any https origin. Wiring a deep link that opens a route by
URL means widening it again.

## Play review

The bundle carries no donation link: the help pages' "Buy me a coffee" section is
removed at build time. Google Play tolerates external donation links more than Apple
does, but its payments policy does not promise to, and the bundle is the same for
both platforms.

## Release build

`app/build.gradle` already reads the signing config; nothing there needs editing. It
looks, in this order, for `ANDROID_KEYSTORE_PATH` / `ANDROID_KEYSTORE_PASSWORD` /
`ANDROID_KEY_ALIAS` / `ANDROID_KEY_PASSWORD` as environment variables, then for a
`mobile/android/keystore.properties` file with the same four values under the keys
`storeFile`, `storePassword`, `keyAlias`, `keyPassword` (see
`keystore.properties.example` for the shape). Whichever source has all four wins;
they are not merged. Neither present is not an error: the build still runs and
produces an **unsigned** APK/AAB, with a console warning, exactly as before this was
wired up — this is what keeps a fresh clone and CI green without secrets.

Generate a keystore once, keep it forever — **losing it means every future release
has to ship under a new package identity**, since Play (and a sideloaded upgrade)
refuses an APK that is not signed by the same key as the one already installed:

```bash
keytool -genkeypair -v -keystore meteoride-release.jks -alias meteoride \
  -keyalg RSA -keysize 2048 -validity 10000
```

Put it somewhere outside the repo and either export the four env vars or copy
`mobile/android/keystore.properties.example` to `mobile/android/keystore.properties`
(git-ignored) and fill in the real path and passwords. Then:

```bash
cd mobile/android
./gradlew bundleRelease      # .aab for Play Store
./gradlew assembleRelease    # .apk for sideloading
```

Confirm a build actually got signed, and by which key, with `apksigner` from the SDK's
`build-tools`:

```bash
apksigner verify --print-certs app/build/outputs/apk/release/app-release.apk
```

An unsigned APK fails that command outright, which is the other way to notice signing
did not happen.

Play Store listings need the same privacy answers as the App Store: no account, no
analytics, and coordinates sent only to the weather providers. The privacy section of
the `README` covers the data flows.

## Icons

```bash
cd mobile
mkdir -p assets && cp ../public/icons/icon-1024.png assets/icon.png
npx @capacitor/assets generate --android
```

## Troubleshooting

**`Capacitor.Plugins.MeteoRideShare` is undefined.** `registerPlugin` must run before
`super.onCreate` in `MainActivity`.

**Shared routes never arrive.** Check `adb logcat -s MeteoRide`. The store logs why it
rejected an item, usually because the shared file was neither named like a route nor
looked like one inside.

**MeteoRide does not appear in the share sheet.** Reinstall the app. Android caches
intent filters, and a manifest change does not always take effect on an upgrade.

**Blank screen.** Open `chrome://inspect` in Chrome on your desktop with the device
connected; the web view shows up there with the usual console.
