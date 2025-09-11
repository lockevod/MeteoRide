# MeteoRide

🚴‍♂️ **MeteoRide** is a web application designed for cyclists to forecast detailed weather in a route. Load GPX files, select your cycling speed, and get comprehensive weather data along your path, including temperature, wind, precipitation, humidity, cloudiness, luminosity, and UV index.

## Features

- **GPX Route Loading**: Supports standard tracks, routes, and waypoints. Load files directly or via URLs with parameters like `?gpx_url=` or `?gpx_data=`.
- **Weather Providers**: Choose from Open-Meteo (free, up to 14 days), MeteoBlue (API key required, up to 7 days), OpenWeather (API key required, up to 5 days), or Arome-HD (high-resolution for Europe within 48 hours).
- **Provider chains**: A new chain option is available: "OpenWeather 0–2h → Arome 2–36h → OpenMeteo". This requires an OpenWeather API key; if the key is missing the option is disabled in the selector. Chains determine which provider serves each timestamp based on the current time ("now"), not the selected route start.
- **Comparison Mode**: Evaluate differences between providers for better decision-making.
- **Automatic Fallbacks**: Switches to Open-Meteo if your primary provider fails or exceeds its horizon, with optional notifications.
- **Interactive Weather Table**: Displays hourly data with icons, temperature, wind (speed + direction + gusts), rain (amount + probability), humidity, cloudiness, luminosity bar, and UV index.
- **Interactive Map**: Visualize wind arrows (blue for light <12 km/h, red for strong 30-50 km/h, purple for very strong >50 km/h), precipitation drops, and route markers.
- **Horizontal Scrolling**: Drag or scroll the table horizontally on touch screens; click columns to highlight and center the map.
- **Solar Information**: Automatic sunrise/sunset times, civil twilight, and real luminosity calculations.
- **Smart Fallbacks**: Handles provider failures, retries, and clear notifications on data limitations.
- **URL Parameters**: Direct links for routes, e.g., `?gpx_url=https://example.com/route.gpx`, `?datetime=2024-03-15T10:00`, `?speed=25`.
- **Local Caching**: Stores provider responses in localStorage for ~30 minutes per step/hour to speed up reloads and reduce API calls.
- **Settings**: API key management with check buttons, units (wind: km/h/m/s/mph; temperature: °C/°F; distance: km/mi; precipitation: mm/in), and language support (English/Spanish).
- **Privacy-Focused**: Runs entirely on your device; no data sent to external servers. Only shares coordinates, dates, and API keys with weather providers.
- **Progressive Web App (PWA)**: Installable on mobile and desktop devices for a native app-like experience.
- **Open Source**: MIT licensed, available on GitHub for contributions.

## Howto use
You can use in your own computer, only download the code and open index.html in your computer.
You can use directly in a web (it's the same code published by github pages directly). You can use https://app.meteoride.cc

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

## Privacy and Data

MeteoRide operates locally in your browser. Data shared with providers includes only coordinates, dates, and API keys. Local storage includes settings, encrypted API keys, preferences, and temporary weather cache. This is for donwloaded code and with code in github pages (https://app.meteoride.cc)

## Installation

No installation required—run directly in your browser (downloaded or by web directly)

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

### Local share-server / Shortcuts (optional)

This repository includes a small local Node server `share-server.js` to receive GPX files (useful for testing iOS Shortcuts or Android share targets).

- Start the server:

```bash
node share-server.js
```

- Quick test with curl (server returns JSON 201 by default):

```bash
curl -v -X POST --data-binary @example.gpx http://localhost:8081/share -H 'Content-Type: application/gpx+xml'
```

- Use `run-test.sh` to automate a POST and print the returned `indexUrl`:

```bash
./run-test.sh --host localhost --port 8081
```

See `SHORTCUTS.md` and `SHORTCUT_EXPORT.md` for step-by-step instructions and a Shortcuts-friendly flow.

#### iOS Shortcuts (minimum iOS 16)

If you plan to use iOS Shortcuts to send GPX files from your iPhone to the local server, here are concrete notes:

- The repository includes two helper files:
	- `SHORTCUT_EXPORT.json` — a template describing the Shortcut steps (replace YOUR_HOST and ports).
	- `SHORTCUT_EXPORT.md` — step-by-step Shortcuts builder notes (manual import/recreate).

- Important: Apple Shortcuts' `.shortcut` import format is platform-specific and often includes metadata/signatures. Creating a fully importable `.shortcut` file outside of the Shortcuts app can fail unless signed. See `SHORTCUT_IMPORT_NOTES.md` for details and a safe manual workflow.

- Quick recommended workflow for iOS 16:
	1. Open the Shortcuts app on your iPhone.
 2. Create a new shortcut and follow the steps in `SHORTCUT_EXPORT.md` (Select File → Get File Contents → Get Contents of URL (POST) → Get Dictionary Value → Open URL).
 3. In the "Get Contents of URL" action set the URL to `http://<YOUR_HOST>:8080/share` (or `:8081` for node server).
 4. Optionally add `?follow=1` to the URL or set header `X-Follow-Redirect: 1` if you want the server to reply with a 303 redirect.

If you prefer, you can use the `SHORTCUT_EXPORT.json` as a precise checklist to recreate the actions in the Shortcuts app.

## Technologies

- **Maps**: OpenStreetMap
- **Weather Data**: Open-Meteo, MeteoBlue, OpenWeather
- **Icons**: Weather Icons by Erik Flowers
- **Libraries**: Leaflet.js, SunCalc, GPX parser
- **Hosting**: GitHub Pages (optional)

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
