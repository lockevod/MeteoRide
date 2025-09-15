# MeteoRide

🚴‍♂️ **MeteoRide** is a web application designed for cyclists to forecast detailed weather in a route. Load GPX or KML files, select your cycling speed, and get comprehensive weather data along your path, including temperature, wind, precipitation, humidity, cloudiness, luminosity, and UV index.

You can download de code, execute directly without a server, install in a server or acces to https://app.meteoride.cc webapp.

## Features

- **Weather Providers**: Choose from Open-Meteo (free, up to 14 days), MeteoBlue (API key required, up to 7 days), OpenWeather (API key required, up to 5 days), or Arome-HD (high-resolution for Europe within 48 hours).
- **Provider chains**: A new chain option is available: "OpenWeather 0–2h → Arome 2–36h → OpenMeteo". This requires an OpenWeather API key; if the key is missing the option is disabled in the selector. 
- **Comparison Mode**: Evaluate differences between providers for better decision-making.
- **Automatic Fallbacks**: Switches to Open-Meteo if your primary provider fails or exceeds its horizon, with optional notifications.
- **Interactive Weather Table**: Displays hourly data with icons, temperature, wind (speed + direction + gusts), rain (amount + probability), humidity, cloudiness, luminosity bar, and UV index.
- **Interactive Map**: Visualize wind arrows (blue for light <12 km/h, red for strong 30-50 km/h, purple for very strong >50 km/h), precipitation drops, and route markers.
- **Horizontal Scrolling**: Drag or scroll the table horizontally on touch screens; click columns to highlight and center the map.
- **Solar Information**: Automatic sunrise/sunset times, civil twilight, and real luminosity calculations.
- **Smart Fallbacks**: Handles provider failures, retries, and clear notifications on data limitations.
- **GPX Route Loading**: Supports standard tracks, routes, and waypoints. Load files directly or via URLs with parameters like `?gpx_url=` or sharing directly.
- **URL Parameters**: Direct links for routes, e.g., `?gpx_url=https://example.com/route.gpx`, `?datetime=2024-03-15T10:00`, `?speed=25`.
- **Local Caching**: Stores provider responses in localStorage for ~30 minutes per step/hour to speed up reloads and reduce API calls.
- **Settings**: API key management with check buttons, units (wind: km/h/m/s/mph; temperature: °C/°F; distance: km/mi; precipitation: mm/in), and language support (English/Spanish).
- **Privacy-Focused**: No data sent to external servers. Only shares coordinates, dates, and API keys with weather providers. This app can be installed locally (only needs a brownser) except if you want to use "share route" with IOS.
- **Progressive Web App (PWA)**: Installable on mobile and desktop devices for a native app-like experience.
- **Open Source**: MIT licensed, available on GitHub for contributions.

## Howto use
You can use in your own computer, only download the code and open index.html in your computer.
You can use directly in a web (it's the same code published in Vercel directly). You can use https://app.meteoride.cc We use vercel because it's necessary to have POST option to upload gpx files if you use share (IOS). If you don't use this option (upload a GPX all info is managed in your own brownser. If you upload a )

## Getting Started

1. **Load a GPX Route**: Click the 📁 button or use URL parameters.
2. **Set Date and Time**: Choose your planned start time (auto-adjusts to 15-minute intervals).
3. **Adjust Speed**: Enter average speed or use presets (5, 10, 12, 15, 20 km/h).
4. **Select Interval**: Choose weather data every 15 or 30 minutes.
5. **Pick Provider**: Select a weather source and enable comparison if needed.

For more detailed information, see the [User Guide (English)](https://app.meteoride.cc/help_en.html) or [Guía de Usuario (Español)](https://app.meteoride.cc/help.html).

## Limitations and Tips

- **Time Horizons**: Open-Meteo (14 days), MeteoBlue (7 days), OpenWeather (5 days). Implemented a fallback with Meteoblue and openweathermap (more than standard days fallback to open-meteo)
- **Accuracy**: Forecasts less reliable beyond 3-4 days.
- **Free APIs**: Monthly limits for MeteoBlue and OpenWeather; Open-Meteo has no limits.
- **Best Practices**: Use routes up to 100-200 km, plan 1-2 days ahead, combine sources, have a backup plan, and carry rain gear.

## Troubleshooting

- **GPX/KML Won't Load**: Ensure the file has valid tracks.
- **No Weather Data**: Check API key or switch to Open-Meteo.
- **Date Out of Range**: Reduce the time horizon.
- **Empty Table**: Verify route length.


## Installation

No installation required—run directly in your browser (downloaded or https://app.meteoride.cc  directly). If you want to install locally in a web server you can use a common webserver (apache, caddy, etc), if you want to  use shortcuts  you will need some method to provide POST method (testing in a Caddy and Node environment, but you can use your onwn).

### Installing as a Progressive Web App (PWA)

MeteoRide can be installed as a PWA for a native app-like experience. If you want to install as a PWA you need to have deployed webapp in a server or use https://app.meteoride.cc 

#### Android
1. Open MeteoRide in Chrome.
2. Tap the menu (three dots) in the top right.
3. Select "Add to Home screen".
4. Confirm by tapping "Add".

#### iOS (iPhone/iPad)
1. Open MeteoRide in Safari.
2. Tap the Share button (square with arrow).
3. Select "Add to Home Screen".
4. Tap "Add" in the top right.

#### Chrome on Desktop
1. Open MeteoRide in Chrome.
2. Click the install icon in the address bar or the menu.
3. Click "Install".

#### Edge on Desktop
1. Open MeteoRide in Edge.
2. Click the install icon in the address bar.
3. Click "Install".

#### Safari on Mac
1. Open MeteoRide in Safari.
2. Go to File > Add to Dock.
3. Or, click the Share button and select "Add to Dock".

For local development:
1. Clone the repo: `git clone https://github.com/lockevod/MeteoRide.git`
2. Open `index.html` in your browser.

### Sharing routes (iOS / Android)

MeteoRide supports several ways to share GPX routes from mobile devices. Pick the one that fits your workflow:

- POST handoff (recommended for iOS / Shortcuts): send raw GPX to the app's share endpoint (the service worker accepts a POST and stores the file temporarily). This method is required for many iOS share flows because the browser/service-worker APIs cannot always receive the raw file directly from the share sheet. For technical reasons this involves uploading the GPX to a temporary server for the handoff; the file is used only for this purpose and is deleted automatically (within a maximum of two minutes). By using the POST handoff you acknowledge the GPX will be uploaded to a temporary server for the handoff only.

- Hosted URL (`?gpx_url=`): host your GPX somewhere (GitHub, public file host, S3, etc.) and open MeteoRide with `?gpx_url=https://.../route.gpx`. The client fetches the GPX directly from that URL; no upload to a third-party server is required by MeteoRide.

- Direct / local open (file input, drag & drop, or open-in flows): choose a GPX file from your device or share it directly to the page when supported. These flows run entirely in your browser and do not upload the file.

The repository includes a Shortcuts export with an example iOS recipe in `SHORTCUT_EXPORT.md` which you can follow to create an iOS Shortcuts to automate the POST handoff.

You can also donwload mine shortcut. I'm using it and it's working fine.

[GPX to Meteoride Shortcut](https://www.icloud.com/shortcuts/a57e06eaadca423eafaeaee05753b79b)


### Recommended Production setup for POST handoff (Cloudflare Pages + Worker)

If you want the POST handoff to work reliably (required for iOS Shortcuts POST flows), the app's service worker and the POST endpoint must be served from the same origin. GitHub Pages cannot host a dynamic POST endpoint. The quickest production-ready option is Cloudflare Pages + KV  which lets you host the static site and run a small Worker at the same origin (but you can use vercel  or similar also or any webserver supporting POST and commmond headers.)

If you use cloudflare you've exemples in this repo (files in functions,_routes.js an .headers)


## Tampermonkey userscripts

This project includes two optional Tampermonkey userscripts. Install them in your browser if you want one-click integrations with third-party sites.

1) Komoot / Bikemap → MeteoRide
Adds a small MeteoRide icon button on Komoot and Bikemap pages when a route GPX is available; clicking the button sends the GPX to MeteoRide.
- Path: `scripts/userscripts/tamper_meteoride.user.js`
- Raw URL: `https://raw.githubusercontent.com/lockevod/meteoride/main/tools/userscripts/tamper_meteoride.user.js`
- Install (one-click): [![Install (one-click) — Tampermonkey](https://img.shields.io/badge/Install-Tampermonkey-blue?style=flat-square)](https://raw.githubusercontent.com/lockevod/meteoride/main/tools/userscripts/tamper_meteoride.user.js)  


2) MeteoRide → Hammerhead (URL import)
Adds an export button in the MeteoRide UI that uploads the generated GPX to Hammerhead Dashboard.
- Path: `scripts/userscripts/tamper_meteoride_export_hammerhead.user.js`
- Raw URL: `https://raw.githubusercontent.com/lockevod/meteoride/main/tools/userscripts/tamper_meteoride_export_hammerhead.user.js`
- Install (one-click): [![Install (one-click) — Tampermonkey](https://img.shields.io/badge/Install-Tampermonkey-blue?style=flat-square)](https://raw.githubusercontent.com/lockevod/meteoride/main/tools/userscripts/tamper_meteoride_export_hammerhead.user.js)  
	Raw: `https://raw.githubusercontent.com/lockevod/meteoride/main/tools/userscripts/tamper_meteoride_export_hammerhead.user.js`

Installation (Tampermonkey)
1. Install Tampermonkey (or a compatible userscript manager) in your browser (Chrome, Firefox, Edge, etc.).
2. Open the raw URL for the script you want (see above) and use the Tampermonkey `Install` button, or create a new userscript and paste the file contents from the repository.
3. Make sure the userscript is enabled and allowed to run on the relevant domains:
	- `tamper_meteoride.user.js`: enable for Komoot/Bikemap domains.
	- `tamper_meteoride_export_hammerhead.user.js`: enable for `https://app.meteoride.cc/*` and `https://dashboard.hammerhead.io/*`.
4. Configure any required options in the script header or in the `CONFIG` object near the top of the file (for example, share-server base URL for the Hammerhead exporter).

Notes and limitations
- Komoot: GPX export is only available for routes if you have a Komoot **Premium** subscription. The userscript can only fetch GPX when the site exposes the GPX file for your current route (direct download or API endpoint).
- Bikemap: some routes may require login or private access; the userscript cannot fetch GPX in those cases.
- Hammerhead exporter: requires a share-server that returns a `/shared/<id>.gpx` URL or JSON with the shared URL. The Hammerhead tab should be open in the same browser profile for automatic token discovery; if it is not logged in the script will poll for interactive login (configurable `AUTH_WAIT_MS`).
- Both scripts avoid heavy DOM parsing and prefer direct GPX links / APIs to stay lightweight and reliable.

Security
- The Komoot/Bikemap userscript posts the GPX to MeteoRide using `window.postMessage`; MeteoRide validates the message origin. No GPX is uploaded to external servers by that script itself.
- The Hammerhead exporter uploads GPX to your configured share-server; treat shared links as public unless your server enforces access controls. The Hammerhead token discovery happens inside the Hammerhead tab and the token is not exfiltrated from that page. Web https://app.meteoride.cc delectes all gpx every 2 minutes and tampermonkey is configured to delete gpx once is donwloades/send to hammerhead.


## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
Bikemap, Komoot, OpenWeatherMaps, Openmeteo, Meteoblue and Hammerhead are registerer marks. They can have specific propietary licenses, please if you use this code or the published webapp you have to comply with them. If you don't want you cannot use this code or the app.

This code and the webapp are designed with "zero trust" security in mind but it isn't a commercial code or service, the code and web app is provide as is, any liability or warranty is given with this code and webapp. You accept this if you donwload this repo, use the code or use the webapp. 


## Technologies

- **Maps**: OpenStreetMap
- **Weather Data**: Open-Meteo, MeteoBlue, OpenWeather
- **Icons**: Weather Icons by Erik Flowers
- **Libraries**: Leaflet.js, SunCalc, GPX parser
- **Hosting**: Cloudfare Pages (only if you use web)
- **Sripts**: Tampermonkey

## Contributing

Contributions are welcome! Fork the repo, report issues, suggest features, translate to new languages, or improve docs. Visit [GitHub Issues](https://github.com/lockevod/MeteoRide/issues) for support.

Developed by [Lockevod](https://github.com/lockevod).

## Support

If you find MeteoRide useful, consider supporting the project with a donation:

<a href="https://www.buymeacoffee.com/enderthor" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/default-orange.png" alt="Buy Me A Coffee" height="41" width="174"></a>

---

**Disclaimer**: MeteoRide is a planning tool. Weather data are estimates and may not be accurate. Always verify conditions and use your judgment. The developer is not responsible for decisions based on this information.
