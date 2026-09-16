# MeteoRide user guide

The help you carry inside the app answers "what do I do". This guide answers
"why" and "what happens if". The full detail lives here: each provider's limits,
what the app stores and where, how it behaves out of signal, and every install
recipe.

Versión en español: [GUIA.md](GUIA.md) · In-app help:
[help_en.html](https://app.meteoride.cc/help_en.html)

---

## 1. What MeteoRide is

MeteoRide is an application for cyclists —on the web and as an iPhone and
Android app— that loads GPX/KML routes and shows the forecast along the route.

The app works out the route steps from the cycling speed you choose and asks one
or more weather providers for temperature, wind, precipitation, humidity,
cloudiness, luminosity and UV index at each of those steps. It includes
automatic fallbacks so you get data even when a provider fails, and it can
compare forecasts from different sources or for two different dates.

MeteoRide does not edit the route: it only reads it.

---

## 2. Getting started

### 2.1 Load a GPX/KML route

Click the **📁** button and pick your file. Standard GPX and KML tracks, routes
and waypoints are supported.

You can also load a route from a link with the parameters described in
[§9.4](#94-urls-with-parameters), or share it from another app if you use the
native app ([§6](#6-in-the-iphone-and-android-app)).

### 2.2 Date and time

Select when you plan to ride. The system snaps the time to 15-minute intervals
automatically.

### 2.3 Speed

Enter your estimated average speed or use one of the presets: 5, 10, 12, 15 or
20 km/h. The time you will be at each point comes from this speed, so it is what
changes the result most.

### 2.4 Interval

Choose how often you want weather information: every 15 or 30 minutes.

### 2.5 Provider

Choose the provider or the provider chain you want to use. They are described in
[§4](#4-weather-providers). What happens when the one you picked fails is in
[§9.3](#93-smart-fallbacks).

### 2.6 Compare providers mode (Comp.)

Tick **Comp.** to evaluate the differences between providers over the same route
and the same time.

- It reads Open-Meteo and AROME exactly like the normal table, including
  quarter-hour data within the first 5 hours.
- If a provider does not answer, the notice names the one that failed instead of
  showing a generic error.

### 2.7 Compare dates mode

Compare the forecast for the same route on two different dates or times.

- Select **Compare Dates** in the provider dropdown to enter this mode.
- Set Date A and Date B with the date/time controls that appear. The icon-only
  buttons expand the second date.
- Press **🔄 Compare** to update the table.
- The table shows 4 rows: intervals for Date A, summary for Date A, intervals
  for Date B, summary for Date B.
- **There is no automatic recalculation.** If you change any control you have to
  press Compare again.

---

## 3. Loading routes from other sites (userscripts)

The project includes two optional Tampermonkey userscripts. They are not needed
to use MeteoRide; they are shortcuts for people who plan on other sites. Install
instructions are in [USERSCRIPTS.md](USERSCRIPTS.md).

- **Komoot / Bikemap / Hammerhead → MeteoRide**: adds a button that opens the
  route you are looking at directly in MeteoRide. On Komoot, GPX download is
  only available with a **Premium** account; without one the script cannot fetch
  the file.
- **MeteoRide → Hammerhead**: adds a button in MeteoRide that exports the
  current GPX to Hammerhead (dashboard.hammerhead.io). The script uploads the
  raw GPX to a share-server you configure and asks Hammerhead to import that
  URL.

---

## 4. Weather providers

| Provider | API key | Horizon | Coverage |
|---|---|---|---|
| Open-Meteo | No | 14 days | Global |
| OpenWeather | Yes (free tier) | 4 days | Global |
| AROME-HD | No | 48 hours | Part of Europe |

- **Open-Meteo**: free, no key, global coverage, up to 14 days. Open-Meteo picks
  its best model for the area of your track. Recommended for any situation, and
  ideal for long-term planning and routes outside Europe.
- **OpenWeather**: requires an API key, up to 4 days. Excellent real-time data,
  and it is **the only provider that publishes official weather alerts**
  ([§11](#11-official-weather-alerts)). Best for immediate departures and urban
  areas.
- **AROME-HD**: high-resolution model (~1-2 km) from MeteoFrance, reached
  through Open-Meteo and without a key. Only available for Europe
  (approx. 39-52°N, 10.5°W-16.5°E) and within 48 hours. Outside that area or
  that window it switches straight to the best model Open-Meteo has for that
  location, with nothing odd to report: there is still data. Superior for wind
  and short-term precipitation in France and nearby countries.

### Provider chains

Chains combine the strengths of several providers inside the same table:

- **OpenWeather → AROME-HD → Open-Meteo**: real-time OpenWeather data for the
  first hour, hyper-local AROME precision for the next 47 hours, and Open-Meteo
  for the rest of the forecast. Requires an OpenWeather key; without one the
  option is disabled in the selector.

Choose according to what you need: real-time accuracy (OpenWeather), local
precision (AROME-HD) or long-term planning (Open-Meteo).

---

## 5. Installing as a web app (PWA)

The MeteoRide website can be installed as a Progressive Web App (PWA) for an
experience close to a native app. You need the site deployed on a server, or use
<https://app.meteoride.cc>.

If what you want is the native iPhone or Android app, you need none of this:
install it from the store.

**Android**

1. Open MeteoRide in Chrome.
2. Tap the menu (three dots) in the top right.
3. Select "Add to Home screen".
4. Confirm by tapping "Add".

**iOS (iPhone/iPad)**

1. Open MeteoRide in Safari.
2. Tap the Share button (square with arrow).
3. Select "Add to Home Screen".
4. Tap "Add" in the top right.

**Chrome on desktop**

1. Open MeteoRide in Chrome.
2. Click the install icon in the address bar or in the menu.
3. Click "Install".

**Edge on desktop**

1. Open MeteoRide in Edge.
2. Click the install icon in the address bar.
3. Click "Install".

**Safari on Mac**

1. Open MeteoRide in Safari.
2. Go to File > Add to Dock.
3. Or click the Share button and select "Add to Dock".

---

## 6. In the iPhone and Android app

These only exist inside the native app: they are things a browser cannot do.

### 6.1 Send the route to another app

With a route loaded, the **📤** button in the top bar opens the system share
sheet with the GPX attached. From there it goes to your head unit (Hammerhead,
Wahoo), to Files, to mail, wherever you like. The file never leaves the device:
there is no intermediate server, unlike the iOS Shortcut the website needs.

### 6.2 Receive a route from another app

The other way round too: in Komoot, Strava, Bikemap, Files or mail, share the
GPX and pick **MeteoRide**. The app opens with the route already loaded. Same
for "Open in MeteoRide" from a downloaded file.

If MeteoRide does not appear in the share sheet the first time, restart the
phone: the system takes a while to register the app as a destination.

### 6.3 Alerts when the weather on your route changes

A forecast is a guess made hours ahead. When you work out a route, the app keeps
watching it and tells you if it turns worse for the hours you will be out:

- It was dry and rain appears, or the rain becomes heavy.
- It was calm and moderate or strong wind appears, or gusts above 55 km/h.
- An official warning is issued that overlaps your ride. This needs an
  OpenWeather key and official alerts switched on.

Each change is reported once; if it gets worse again, you hear about it again.
Improvements are not reported, and neither are stretches you have already
ridden. The watch ends an hour after the route's last point.

Switch it on and off under **Settings → Alerts → "Tell me if the weather on the
route changes"**, where a line underneath says which route is being watched and
until when.

**Worth knowing:** the check is run by the operating system when it feels like
it, not by the app. On iPhone, Background App Refresh must be on for MeteoRide
(Settings → General), and Low Power Mode suspends it. On Android, some
manufacturers kill background tasks with their own battery manager. When the
system is not going to run it, the app says so under the toggle instead of
letting you believe you are being watched over.

### 6.4 Out of signal

The weather cannot be invented, but what was already downloaded is not thrown
away:

- Opening the app brings back the last route with its table, without loading
  anything.
- An old forecast is still shown, labelled with how many hours old it is. It
  stops at twelve.
- Map tiles you have already looked at are kept on the phone and come back
  offline. In an area you never opened, the background is blank and the map says
  so.
- When there is no data at all, it says so rather than leaving an empty screen
  with no explanation.

The **📴** button saves the forecast for the route you have loaded and protects
it from the cache's automatic clear-out. Press it at home before you leave.

### 6.5 Map and settings

- With no route loaded, the map opens where you are rather than in Barcelona.
- The app starts in the phone's language until you pick one by hand.
- Units, language, your API key, recent routes and the tiles you have already
  looked at are kept outside the internal browser, in a form WebKit does keep:
  they survive the system reclaiming space and on iPhone they are still there
  when you open the app again. They were not before.
- The first time the map looks for you, the system asks for location permission
  in MeteoRide's name.
- The phone stays in portrait, because turning it breaks the layout. The iPad
  does rotate.

---

## 7. Settings

### 7.1 API keys

Only OpenWeather needs a key, and only if you want that provider or the official
alerts. It is free from
[openweathermap.org/api](https://openweathermap.org/api) (One Call API).

Next to the field there is a **🔍 Check** button: the app makes a simple request
and shows the status beside it (valid / invalid / quota / HTTP code). Use it
before leaving home if you have just created the key; OpenWeather takes a while
to activate them.

### 7.2 Non-critical notices

The **Show non-critical notices** checkbox controls notification verbosity.
Enabled, you will see informational banners when fallbacks happen because of
horizon limits, quota or API errors. Disabled, only critical errors are shown.

### 7.3 Units

- **Wind:** km/h, m/s, mph
- **Temperature:** °C, °F
- **Distance:** km, mi
- **Precipitation:** mm, in

### 7.4 Languages

The application supports Spanish and English. The chosen language changes the
interface and the messages. In the native app, until you pick one by hand the
phone's language is used.

### 7.5 Debug button

**Settings → Show debug button** turns the 🐞 button on. It starts off. It is
there to attach information when reporting a problem.

---

## 8. Interpreting the data

### 8.1 The weather table

The table shows information hour by hour:

- **First row:** time and accumulated distance.
- **Second row:** weather icons, with provider change indicators where
  applicable.
- **Temperature:** in degrees Celsius or Fahrenheit.
- **Wind:** speed + direction arrow; gusts in parentheses.
- **Rain:** amount in mm/h **for the hour you are riding through** (probability
  in parentheses). It is not the reading closest to the step's exact minute, but
  the one for the whole hour during which you will be covering that stretch.
- **Humidity:** relative humidity percentage.
- **Cloudiness:** cloud cover percentage.
- **Luminosity:** a vertical bar next to the weather icon, in the second row. It
  represents 0-100% of available light for that interval.
- **UV:** ultraviolet index (integer), in the combined "Cloud / UV" row.

### 8.2 Provider change indicators

When the data source changes during the route you will see an abbreviated label
above that column's data:

- **OPM** — Open-Meteo
- **ARM** — AROME-HD
- **OPW** — OpenWeather

They appear in normal mode, in compare providers and in compare dates, and mark
exactly which provider supplies the data for each time segment. They are
especially useful with chains, where several sources are combined.

### 8.3 The map

- **Blue arrows:** light wind (<12 km/h)
- **Red arrows:** strong wind (30-50 km/h)
- **Purple arrows:** very strong wind (>50 km/h)
- **Droplets 💧:** expected precipitation
- **Green/red markers:** route start and end

---

## 9. Advanced features

### 9.1 Scrolling the table horizontally

The table is interactive and touch-friendly:

- Drag the table horizontally or use the mouse wheel to scroll columns (gestures
  and *drag-to-scroll*).
- Click any column —or any cell, to select that column— and the row and the map
  are highlighted.
- The map recentres on the selected point if you click a wind arrow or the
  column.
- If the penultimate column is less than 5 minutes away from the last one, the
  app hides it to avoid visual duplicates.
- The small ⇆ icon indicates there are more columns available when scrolling.

### 9.2 Solar information

The app automatically shows:

- Sunrise and sunset times.
- Civil twilight, marked with "c".
- Calculated luminosity according to time and conditions.

### 9.3 Smart fallbacks

MeteoRide handles automatically:

- Switching to Open-Meteo, **only for the affected steps**, if your provider
  exceeds its time horizon, fails repeatedly or has no data for that point.
- Retries when there are temporary errors.
- A brief notice in the header when that happens, if you leave non-critical
  notices on in Settings ([§7.2](#72-non-critical-notices)).

Every request has a deadline: **15 seconds** for the server to start answering
and **15 more seconds** without receiving data while it downloads. A provider
that goes silent is not asked again during that same calculation: the remaining
steps go straight to the fallback instead of waiting for it to time out over and
over.

### 9.4 URLs with parameters

You can open MeteoRide with the route and the parameters already set:

- `?gpx_url=https://example.com/route.gpx`
- `?datetime=2024-03-15T10:00`
- `?speed=25`

They can be combined. The GPX is downloaded by the browser straight from that
URL: MeteoRide does not upload it anywhere.

### 9.5 Recent routes

MeteoRide keeps the most recent GPX files you loaded locally so you can get them
back without uploading the file again.

- **How to use:** next to the 📁 button there is a dropdown with your recent
  routes. Pick one and it loads exactly as if you had uploaded it now.
- **Limit:** the last **5** routes are kept. Re-loading a route that is already
  saved moves it to the top instead of duplicating it.
- **Recommended size:** up to about **750 KB** per GPX. If yours is much larger,
  trim it or host it and load it with `?gpx_url=`.
- **Privacy:** GPX files are stored in your browser using IndexedDB (or
  localStorage as a fallback). They are never shared outside your device.
- **Efficiency:** only the basic information (name, size and date) is kept in
  memory; the full content is read only when you select the route.

### 9.6 Local cache and performance

Provider responses are stored in `localStorage` for about **30 minutes** per
step/hour. This speeds up frequent reloads and reduces requests to rate-limited
APIs. It expires on its own: there is nothing to clear by hand.

---

## 10. Limitations and tips

### Limitations

- **Time horizon:** Open-Meteo 14 days, OpenWeather 4 days, AROME-HD 48 hours.
- **Accuracy:** forecasts are markedly less reliable from day 3-4 onwards.
- **Free APIs:** Open-Meteo requires no key and has no practical limit;
  OpenWeather offers a free tier, but keys can have monthly usage limits.
- **MeteoRide does not edit the route.** It only reads the GPX/KML.

### Best practices

- Use routes of at most 100-200 km for better performance.
- Plan 1-2 days ahead for greater accuracy.
- Combine information from several sources for important decisions.
- Always have a plan B for adverse conditions.
- Carry rain gear even if the probability is low.

---

## 11. Official weather alerts

MeteoRide can display the official warnings and alerts published by national
meteorological services, when they appear in OpenWeather's `alerts` array.

To enable them: enter your **OpenWeather API Key** in Settings and tick **Show
official weather alerts**.

- **Availability:** requires an OpenWeather key, as it is the only provider that
  publishes them. With the key configured, MeteoRide checks for alerts even when
  OpenWeather is not your selected primary provider. Without a key the checkbox
  is disabled and says why.
- **Visibility:** when an alert is detected an info card appears and auto-hides
  after 15 seconds. A persistent **⚠️** indicator is left in the UI so you can
  re-open all detected alerts.
- **Sampling and efficiency:** to limit API calls a representative sample of
  points along the route is checked (approx. 2/3 of the steps, minimum 3). Alert
  responses are cached locally for ~1 hour.
- **Time window:** only alerts whose period (start/end) overlaps the time window
  of the corresponding route stretch are considered, with a ±1 hour tolerance
  around the step.
- **Testing:** if you are a developer or want to validate the integration, you
  can trigger test alerts from the browser console with
  `window.testWeatherAlerts()`.

> **Important notice.** These alerts are provided for information only. Do not
> rely solely on them for safety decisions. Always consult your country's
> official meteorological service or the competent authorities before
> undertaking an activity that may be affected by severe conditions. OpenWeather
> may contain errors or delays, or may omit specific local warnings; MeteoRide
> is not a substitute for official communications.

---

## 12. Troubleshooting

| Symptom | What to check |
|---|---|
| GPX/KML will not load | Verify that the file contains valid tracks. |
| No weather data | Check your API key with 🔍 Check, or switch to Open-Meteo, which needs no key. |
| Date out of range | Reduce the time horizon: each provider has its own ([§4](#4-weather-providers)). |
| Empty table | Make sure the route is long enough for at least one step. |
| A shared route does not reach the app | Restart the phone the first time ([§6.2](#62-receive-a-route-from-another-app)). |
| Weather-change alerts do not arrive | Read what the app says under the toggle ([§6.3](#63-alerts-when-the-weather-on-your-route-changes)). |

To report a problem, turn the debug button on ([§7.5](#75-debug-button)) and
include your device and the version, shown at the foot of the help page.

---

## 13. Privacy and data

**MeteoRide runs completely on your device.** All settings, preferences and data
are stored only in your browser, using localStorage and IndexedDB.

The only exception is the website: if you use the iOS Shortcuts to share a GPX,
that file is uploaded to Cloudflare. It is unavoidable because iOS Shortcuts
only accept POST. If you open the file directly from MeteoRide nothing is
uploaded, because it is processed locally, and the native app does not need this
at all. In any case the uploaded GPX is deleted automatically within a maximum
of two minutes.

- **No account:** you do not need to create an account or provide personal data.
- **Full control:** you can delete all stored data from your browser settings.
- **Open source:** you can inspect the full source code on GitHub.

### Data shared with weather providers

To obtain forecasts, MeteoRide only shares:

- The **geographic coordinates** of the points in your route.
- The **dates and times** for which you need the forecast.
- **Your API key**, if you use OpenWeather.

Weather providers (Open-Meteo, OpenWeather) have their own privacy policies.
MeteoRide only acts as a client requesting the forecast data you need.

### About the API key

The key is stored in your device's local storage, **not encrypted**. That means
it could hypothetically be accessed by a third party with access to your device,
or by another script running in your browser. The risk with this type of key is
low, but using a free key with minimal permissions is recommended.
Alternatively, you can avoid keys altogether and rely on the providers that do
not require them (Open-Meteo, AROME-HD).

### What is stored locally

- Units and language settings.
- API keys, unencrypted.
- Speed and interval preferences.
- Temporary weather data cache (~30 minutes).
- The last 5 GPX routes loaded.
- In the native app, also the map tiles you have already looked at.

If you need stricter privacy guarantees, you can run MeteoRide entirely locally
(opening `index.html` without using the share/upload features) or deploy your
own share-server with the access policies you decide ([DEPLOY.md](DEPLOY.md)).

---

## 14. License and credits

Developed by [Lockevod](https://github.com/lockevod).

### License

This project is licensed under the **MIT License**, which means:

- You can use the application freely.
- You can modify the source code.
- You can distribute your own version.
- For personal and commercial use.
- You have to inform about the author and the MIT license.

### Technologies and services

- **Maps:** OpenStreetMap and contributors.
- **Weather data:** Open-Meteo, OpenWeather.
- **Weather icons:** Weather Icons by Erik Flowers.
- **Libraries:** Leaflet.js, SunCalc, GPX parser.
- **Native app:** Capacitor (iOS / Android).
- **Hosting:** Cloudflare Pages (web version only).
- **Scripts:** Tampermonkey.

### Marks and liability

Bikemap, Komoot, OpenWeatherMaps, Openmeteo and Hammerhead are registered marks.
They may have specific proprietary licenses; if you use this code or the
published webapp you must comply with them.

This code and the webapp are designed with "zero trust" type security in mind,
but they are not commercial code or a commercial service. The code and the
webapp are provided as-is, without any warranty or liability. You accept this if
you download this repository, use the code, or use the webapp.

Updated information about this app is always on
[GitHub](https://github.com/lockevod/MeteoRide). You accept all updated
information, liabilities and restrictions on that page if you use this app.

### Disclaimer

MeteoRide is a planning tool. Weather data are estimates and may not be fully
accurate. Always use your judgement and verify conditions before heading out.
The developer is not responsible for decisions based on this information.

---

## 15. Support and contributions

### Report issues

- Open an issue in the
  [GitHub repository](https://github.com/lockevod/MeteoRide/issues).
- Turn the debug button (🐞) on under **Settings → Show debug button**: it
  starts off.
- Include your device and the version, shown at the foot of the help page.

### Contribute

- Fork the repository on GitHub.
- Report bugs or suggest improvements.
- Translate to new languages.
- Improve the documentation.

Weather can change quickly. Use MeteoRide as a guide, but stay flexible and safe
on your rides.
