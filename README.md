# MeteoRide

🚴‍♂️ **MeteoRide** is a web application designed for cyclists to forecast detailed weather in a route. Load GPX files, select your cycling speed, and get comprehensive weather data along your path, including temperature, wind, precipitation, humidity, cloudiness, luminosity, and UV index.

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

- **GPX Won't Load**: Ensure the file has valid tracks.
- **No Weather Data**: Check API key or switch to Open-Meteo.
- **Date Out of Range**: Reduce the time horizon.
- **Empty Table**: Verify route length.


## Installation

No installation required—run directly in your browser (downloaded or by web directly). If you need/want to share by IOS shortcut then you need to follow the link or install in a web server.

### Installing as a Progressive Web App (PWA)

MeteoRide can be installed as a PWA for a native app-like experience.

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

For detailed, up-to-date step-by-step instructions (including Shortcuts recipes and helper scripts), please visit the project website on GitHub.

## Recommended Production setup for POST handoff (Cloudflare Pages + Worker)

If you want the POST handoff to work reliably (required for iOS Shortcuts POST flows), the app's service worker and the POST endpoint must be served from the same origin. GitHub Pages cannot host a dynamic POST endpoint. The quickest production-ready option is Cloudflare Pages + Worker (KV) which lets you host the static site and run a small Worker at the same origin.

Quick summary of steps:

1. Create a Cloudflare account and add your project repository to Cloudflare Pages (connect via GitHub). Set the build directory to the repo root (no build step needed for this static site).
2. Create a Workers KV namespace (Workers → KV → Create Namespace). Name the binding e.g. `SHARED_GPX`.
3. In Cloudflare Workers, create a new Worker and paste the code from `cloudflare/worker/index.js` in this repository.
	 - In the Worker settings add a KV binding: `SHARED_GPX` → select the namespace created.
4. Route the Worker so `/share` and `/shared/*` are handled by the Worker on the same domain where Pages serves the site. Alternatively deploy the Worker under the same custom domain.
5. Deploy Pages (the repo) — each push to the configured branch will auto-deploy the static site.
6. Test the flow:

Local test commands (after deployment):

1) POST handoff using curl (simulates iOS Shortcut):

```bash
curl -v -X POST --data-binary @teialada.gpx \
	-H "Content-Type: application/gpx+xml" \
	-H "x-gpx-name: teialada.gpx" \
	-L https://your-site.example/share
```

The Worker will store the GPX in KV (TTL 120s) and redirect to `/?shared=1&shared_id=<id>` on the same origin. The app will then read it and load the route.

Notes & tips:
- Make sure your site is served over HTTPS and the Worker is bound to the same origin.
- The Worker code stores GPX for 120 seconds; adjust `expirationTtl` in `cloudflare/worker/index.js` if you need longer.
- If you prefer Vercel or Netlify instead, implement a serverless function that stores GPX temporarily (Redis/Upstash or similar) and return the same redirect flow.

If you want, I can also add a small GitHub Actions workflow that deploys the Worker via Wrangler on push. Tell me if you want that and I will add the workflow and instructions to create an API token.

### Deployment checklist

- [ ] Create a Cloudflare account and add your domain or use workers.dev.
- [ ] Create a Workers KV namespace and name it (binding: `SHARED_GPX`).
- [ ] In Cloudflare Dashboard, create a new Worker and paste `cloudflare/worker/index.js`.
- [ ] In the Worker's settings, add a KV binding: `SHARED_GPX` -> select the namespace.
- [ ] Configure routing so `/share` and `/shared/*` are handled by the Worker on the same origin as your Pages site.
- [ ] (Optional) Create a Cloudflare Pages project and point it to this GitHub repository.
- [ ] (Optional) Add the following GitHub Secrets to enable CI deploy via Wrangler: `CF_API_TOKEN`, `CF_ACCOUNT_ID`.

### iOS Shortcuts (example)

Use the Shortcuts app to create a shortcut that POSTS GPX to the share endpoint instead of saving a file. Example steps:

1. "Get Contents of URL" – set Method to POST, URL to https://your-site.example/share
2. Request Body: Set to "File" and select the GPX file (or set "Text" and paste GPX)
3. Add Header: Content-Type = application/gpx+xml
4. (Optional) Add Header: x-gpx-name = <desired filename>
5. Run Shortcut. The endpoint will respond with a redirect to the app URL where the app reads the GPX from KV and loads it.

This avoids the Shortcuts auto-download behavior and lets the app receive the GPX directly.

## Privacy and Data

MeteoRide operates locally in your browser. Data shared with providers includes only coordinates, dates, and API keys. Local storage includes settings, encrypted API keys, preferences, and temporary weather cache. This is for donwloaded code and with code in cloudflare pages (https://app.meteoride.cc)
If you use share GPX option (IOS shortcut) then you'll upload the GPX to server, this GPX will be erased automatically 2 minutes later (you don't need to use it, you can open the GPX directly and no data be stored in the server).
You've detailed instructions to share GPS to this app. Sharing with an IOS shortcut needs to upload the server because IOS doesn't allow to share information directly to a PWA. If you use android you can share directly and this isn't applicable ( no GPX is uploaded).

## Technologies

- **Maps**: OpenStreetMap
- **Weather Data**: Open-Meteo, MeteoBlue, OpenWeather
- **Icons**: Weather Icons by Erik Flowers
- **Libraries**: Leaflet.js, SunCalc, GPX parser
- **Hosting**: Cloudfare Pages (only if you use web)

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Fork the repo, report issues, suggest features, translate to new languages, or improve docs. Visit [GitHub Issues](https://github.com/lockevod/MeteoRide/issues) for support.

Developed by [Lockevod](https://github.com/lockevod).

## Support

If you find MeteoRide useful, consider supporting the project with a donation:

<a href="https://www.buymeacoffee.com/enderthor" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/default-orange.png" alt="Buy Me A Coffee" height="41" width="174"></a>

---

**Disclaimer**: MeteoRide is a planning tool. Weather data are estimates and may not be accurate. Always verify conditions and use your judgment. The developer is not responsible for decisions based on this information.
