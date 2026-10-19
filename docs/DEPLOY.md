# Deploying MeteoRide, and sharing routes into it

**app.meteoride.cc is Cloudflare Pages, connected to this repository: every push to `main`
publishes `public/`.** So a push is a deploy, and it publishes every commit not yet pushed at
once. Run `cd mobile && npm test` on that HEAD first.

MeteoRide is a static site. Any web server will do — until you want the POST
handoff (`/share`) that the optional Hammerhead exporter userscript uses, which is
the only part with a server-side requirement.

---

## Ways to get a GPX into MeteoRide

Pick the one that fits your workflow; only the first needs anything deployed.

### POST handoff (`/share`, for the Hammerhead exporter)

The MeteoRide → Hammerhead userscript
(`tools/userscripts/tamper_meteoride_export_hammerhead.user.js`, see
[USERSCRIPTS.md](USERSCRIPTS.md)) POSTs the current GPX to `/share` on its
`SHARE_SERVER_BASE` (by default `https://app.meteoride.cc`). The function keeps it
in KV under a random id and serves it at `/shared/<id>`, which is the URL
Hammerhead's servers import; `?shared_id=<id>` also opens it in MeteoRide.

This involves uploading the GPX to a temporary server for the handoff. The file is
used only for that and is deleted automatically, within a maximum of two minutes.

iOS Shortcuts used to post to the same endpoint; they are no longer offered, since
the native iPhone app receives a GPX from the share sheet. **The native iPhone and
Android apps do not need any of this.** They use the system share sheet, and the
file never leaves the device.

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

The POST handoff needs a host that runs code next to the static files. GitHub Pages
cannot host a dynamic POST endpoint, so it is not enough on its own.

The quickest production-ready option is **Cloudflare Pages + KV**: it hosts the
static site and runs a small Worker at the same origin. Vercel or any web server
that supports POST and the usual headers works too.

If you use Cloudflare, this repository already contains the pieces:

- `functions/` — the Worker endpoints.
- `_routes.json` — which paths go to the Worker rather than to the static site.
- `public/_headers` — the site's headers, including its Content-Security-Policy.

`public/_headers` is a Cloudflare file and is stripped from the native bundle,
which carries its own CSP in a `<meta>` tag instead.

`public/_redirects` sends the old landings (`/en/route-weather`, `/es/tiempo-en-tu-ruta` and
the seven others, with and without the trailing slash) to their page on meteoride.cc, 301.

---

## meteoride.cc (product site)

The overview at <https://meteoride.cc> is a second Cloudflare Pages project on this same
repository, separate from the app's (app.meteoride.cc). Its source is `site/`; the build
writes `site/dist/` (git-ignored): nine pages, the language chooser at `/`, `sitemap.xml`,
`robots.txt`, `favicon.ico` and `_headers`.

### Order of the move (once, by hand)

meteoride.cc is today a custom domain of the **app's** project, and the old landings live at
`app.meteoride.cc/<code>/<slug>`. The commit `063ef16` deletes those landings and adds
`public/_redirects` sending them to `https://meteoride.cc/<code>/`: pushed before the apex
belongs to the site, they would redirect into the app's own 404s. So, in this order:

1. **Push up to `368db80`** (it already contains `site/`), not the landing deletion:
   `git push origin 368db80:main`. The app deploys as usual; nothing changes for visitors.
2. **Create the site's Pages project** and check it on its own `<project>.pages.dev` address:
   - **Workers & Pages → Create → Pages → Connect to Git**, this repository, branch `main`.
     Name it e.g. `meteoride-site`.
   - Build settings: framework preset *None*, **root directory `site`**, build command
     `node build.mjs`, build output directory `dist`. Environment variable `NODE_VERSION` =
     `22`. The build needs no `npm install`. The root directory matters: Pages deploys the
     `functions/` folder it finds in the root directory, and at the repository root that is the
     app's `/share` function, which would then run on meteoride.cc without its KV binding.
     The build still reads `public/` (the app's dictionaries) from the full checkout.
   - **Leave Cloudflare Web Analytics off** for this project (Settings → Web Analytics). It
     injects a beacon script from `static.cloudflareinsights.com`, which the site's CSP blocks
     and which contradicts "no analytics".
   - On `https://<project>.pages.dev/` the chooser picks a language and `/es/` … `/pt/` load.
     (At `368db80` the build has no `_headers`, `sitemap.xml` or `robots.txt` yet: those come
     with step 4.)
3. **Move the apex, back to back**: in the app's project, Custom domains, remove
   `meteoride.cc` (the app keeps `app.meteoride.cc`); straight away, in the site's project,
   add `meteoride.cc` and `www.meteoride.cc`. Then **Rules → Redirect Rules** on the zone:
   when hostname equals `www.meteoride.cc`, redirect dynamically to
   `concat("https://meteoride.cc", http.request.uri.path)`, status **301**, preserving the
   query string. Adding a Pages custom domain only touches the `meteoride.cc` / `www` CNAME
   (or flattened apex) records: **check in DNS that the MX and TXT (SPF/DKIM) records of Email
   Routing are still there**, so `privacy@meteoride.cc` and `support@meteoride.cc` keep
   arriving, and send one test mail to each.
4. **Push the rest**: `git push origin main` (the landing deletion, `public/_redirects`, the
   site's `_headers`, sitemap and robots, and everything after). Both projects deploy. Between
   steps 3 and 4 the apex serves the `368db80` build of the site, without the hand-off of
   old app links described below, so keep that gap to minutes.
5. **Verify**:
   - `curl -sI https://meteoride.cc/es/` carries the site's `Content-Security-Policy`
     (`default-src 'self'`, no host), and the page loads with no CSP error in the console.
   - `https://www.meteoride.cc/fr/` lands on `https://meteoride.cc/fr/`.
   - `curl -sI https://app.meteoride.cc/es/tiempo-en-tu-ruta` answers 301 to
     `https://meteoride.cc/es/` (and the same with a trailing slash).
   - `https://meteoride.cc/?gpx_url=https://example.com/r.gpx` lands on
     `https://app.meteoride.cc/?gpx_url=…`.

### What the move costs the apex's old users

Until now meteoride.cc **was** the app. The site's chooser at `/` hands that traffic on: `/`
with any query (`?gpx_url=`, a share link) or opened as an installed app (the PWA's
`start_url` is `/`; `display-mode: standalone`, or `navigator.standalone` on iOS) goes to
`https://app.meteoride.cc/` with the same query and fragment. But **what the app stored on the
meteoride.cc origin (settings, the API key, recent routes) cannot follow**: browsers keep
storage per origin, and app.meteoride.cc cannot read it. Anyone who used the app on the apex
starts clean on app.meteoride.cc and re-enters their key. That is accepted; there is no
migration.

The site loads nothing from another origin (no CDN, web font, analytics or cookie) and its
`_headers` enforce that; links out are fine.

Screenshots are not taken by the build: they are committed in `site/img/shots/`. To redo
them after a change in the app: `cd mobile && npm run build && npm run site:shots`.

---

## Privacy of a deployment you run

Uploaded GPX files on <https://app.meteoride.cc> are deleted within two minutes.
If you deploy your own share-server, that retention is yours to decide, and so
are the access policies. Treat shared links as public unless your server
enforces access control.

If you need stricter guarantees and do not need the POST handoff, run MeteoRide
entirely locally: open `index.html` and use only the file picker and
`?gpx_url=`.
