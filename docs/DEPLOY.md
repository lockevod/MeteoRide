# Deploying MeteoRide, and sharing routes into it

MeteoRide is a static site. Any web server will do — until you want the POST
handoff that iOS Shortcuts need, which is the only part with a server-side
requirement.

---

## Ways to get a GPX into MeteoRide

Pick the one that fits your workflow; only the first needs anything deployed.

### POST handoff (recommended for iOS / Shortcuts)

Send raw GPX to the app's share endpoint; the service worker accepts a POST and
stores the file temporarily. This method is required for many iOS share flows
because the browser and service-worker APIs cannot always receive the raw file
directly from the share sheet.

For technical reasons this involves uploading the GPX to a temporary server for
the handoff. The file is used only for that and is deleted automatically, within
a maximum of two minutes. By using the POST handoff you acknowledge the GPX will
be uploaded to a temporary server for the handoff only.

The repository includes an example iOS recipe in `SHORTCUT_EXPORT.md`, which you
can follow to build your own Shortcut. There is also a ready-made one:

[GPX to MeteoRide Shortcut](https://www.icloud.com/shortcuts/a57e06eaadca423eafaeaee05753b79b)

**The native iPhone and Android apps do not need any of this.** They use the
system share sheet, and the file never leaves the device.

### Hosted URL (`?gpx_url=`)

Host your GPX somewhere (GitHub, a public file host, S3…) and open MeteoRide
with `?gpx_url=https://…/route.gpx`. The client fetches the GPX directly from
that URL; no upload to a third-party server is required by MeteoRide.

### Direct / local open

Choose a GPX file from your device with the 📁 button, drag and drop it, or use
an open-in flow where supported. These run entirely in your browser and upload
nothing.

---

## Production setup for the POST handoff (Cloudflare Pages + Worker)

For the POST handoff to work reliably, the app's service worker and the POST
endpoint must be served **from the same origin**. GitHub Pages cannot host a
dynamic POST endpoint, so it is not enough on its own.

The quickest production-ready option is **Cloudflare Pages + KV**: it hosts the
static site and runs a small Worker at the same origin. Vercel or any web server
that supports POST and the usual headers works too.

If you use Cloudflare, this repository already contains the pieces:

- `functions/` — the Worker endpoints.
- `_routes.js` — which paths go to the Worker rather than to the static site.
- `public/_headers` — the site's headers, including its Content-Security-Policy.

`public/_headers` is a Cloudflare file and is stripped from the native bundle,
which carries its own CSP in a `<meta>` tag instead.

---

## Privacy of a deployment you run

Uploaded GPX files on <https://app.meteoride.cc> are deleted within two minutes.
If you deploy your own share-server, that retention is yours to decide, and so
are the access policies. Treat shared links as public unless your server
enforces access control.

If you need stricter guarantees and do not need the POST handoff, run MeteoRide
entirely locally: open `index.html` and use only the file picker and
`?gpx_url=`.
