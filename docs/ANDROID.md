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

## Testing the share flow

```bash
adb push route.gpx /sdcard/Download/
adb shell am start -a android.intent.action.VIEW \
  -d file:///sdcard/Download/route.gpx -t application/gpx+xml \
  -n cc.meteoride.app/.MainActivity
```

For the share sheet, open any file manager, long-press a `.gpx` and pick Share. Watch
what happens with `adb logcat -s MeteoRide Capacitor/Console`.

## Release build

Create a keystore, then add the signing config to `android/app/build.gradle` and build:

```bash
cd mobile/android
./gradlew bundleRelease      # .aab for Play Store
./gradlew assembleRelease    # .apk for sideloading
```

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
