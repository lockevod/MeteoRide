# Tampermonkey userscripts

Two optional userscripts, for one-click integration with third-party sites.
Neither is needed to use MeteoRide.

---

## 1. Komoot, Bikemap and Hammerhead → MeteoRide

Adds a small MeteoRide icon button on Komoot and Bikemap pages, and a
quick-import button on Hammerhead route pages when a GPX is available. Clicking
it sends the GPX to MeteoRide. The script detects Hammerhead dashboard route
pages and will try to fetch the GPX through the dashboard export endpoint when
possible.

- Path: `tools/userscripts/tamper_meteoride.user.js`
- Raw URL: <https://raw.githubusercontent.com/lockevod/meteoride/main/tools/userscripts/tamper_meteoride.user.js>
- [![Install (one-click) — Tampermonkey](https://img.shields.io/badge/Install-Tampermonkey-blue?style=flat-square)](https://raw.githubusercontent.com/lockevod/meteoride/main/tools/userscripts/tamper_meteoride.user.js)

## 2. MeteoRide → Hammerhead (URL import)

Adds an export button in the MeteoRide UI that uploads the generated GPX to the
Hammerhead Dashboard.

- Path: `tools/userscripts/tamper_meteoride_export_hammerhead.user.js`
- Raw URL: <https://raw.githubusercontent.com/lockevod/meteoride/main/tools/userscripts/tamper_meteoride_export_hammerhead.user.js>
- [![Install (one-click) — Tampermonkey](https://img.shields.io/badge/Install-Tampermonkey-blue?style=flat-square)](https://raw.githubusercontent.com/lockevod/meteoride/main/tools/userscripts/tamper_meteoride_export_hammerhead.user.js)

---

## Installation

1. Install Tampermonkey (or a compatible userscript manager) in your browser:
   Chrome, Firefox, Edge, etc.
2. Open the raw URL of the script you want and use Tampermonkey's **Install**
   button, or create a new userscript and paste the file contents from the
   repository.
3. Make sure the userscript is enabled and allowed to run on the relevant
   domains:
   - `tamper_meteoride.user.js`: the Komoot and Bikemap domains.
   - `tamper_meteoride_export_hammerhead.user.js`: `https://app.meteoride.cc/*`
     and `https://dashboard.hammerhead.io/*`.
4. Configure any required options in the script header or in the `CONFIG` object
   near the top of the file — for example, the share-server base URL for the
   Hammerhead exporter.

## Limitations

- **Komoot**: GPX export is only available for routes if you have a **Premium**
  subscription. The userscript can only fetch a GPX when the site exposes the
  file for your current route, through a direct download or an API endpoint.
- **Bikemap**: some routes require login or are private; the userscript cannot
  fetch the GPX in those cases.
- **Hammerhead exporter**: requires a share-server that returns a
  `/shared/<id>.gpx` URL, or JSON with the shared URL. The Hammerhead tab should
  be open in the same browser profile for automatic token discovery; if it is
  not logged in, the script polls for interactive login (configurable via
  `AUTH_WAIT_MS`).
- Both scripts avoid heavy DOM parsing and prefer direct GPX links and APIs, to
  stay lightweight and reliable.

## Security

- The Komoot/Bikemap userscript posts the GPX to MeteoRide with
  `window.postMessage`, and MeteoRide validates the message origin. That script
  uploads no GPX to external servers.
- The Hammerhead exporter uploads the GPX to the share-server **you** configure.
  Treat shared links as public unless your server enforces access controls. The
  Hammerhead token discovery happens inside the Hammerhead tab and the token is
  not taken out of that page.
- <https://app.meteoride.cc> deletes every uploaded GPX within two minutes, and
  the userscript is configured to delete the GPX once it has been downloaded or
  sent to Hammerhead.
