# MeteoRide

🚴‍♂️ **MeteoRide** shows the weather along your bike route. Load a GPX or KML
file, set the speed you expect to ride at, and get temperature, wind,
precipitation, humidity, cloudiness, luminosity and UV index for every point of
the route — at the hour you will actually be there.

**Try it:** <https://app.meteoride.cc>. Nothing to install, no account. It also
runs as a native iPhone and Android app, as an installable PWA, or from your own
copy of this repository.

## Documentation

| Document | What is in it |
|---|---|
| **[User guide](docs/GUIDE.md)** · **[Guía de usuario](docs/GUIA.md)** | How to use MeteoRide, in full: providers, settings, the native app, privacy, limits. **Start here.** |
| [Installing and running](docs/INSTALL.md) | PWA install recipes, the native apps, running your own copy. |
| [Deploying, and sharing routes into it](docs/DEPLOY.md) | Cloudflare Pages + Worker, the POST handoff, iOS Shortcuts. |
| [Tampermonkey userscripts](docs/USERSCRIPTS.md) | One-click import from Komoot, Bikemap and Hammerhead. |
| [iOS build](docs/IOS.md) · [Android build](docs/ANDROID.md) | Per-platform native build instructions. |

The help inside the app —
[español](https://app.meteoride.cc/help.html) ·
[English](https://app.meteoride.cc/help_en.html) — is the short version of the
user guide: what to do, without the why.

## What it does

- **Three weather providers**: Open-Meteo (free, no key, 14 days), OpenWeather
  (key required, 4 days, official alerts) and AROME-HD (free, high resolution,
  Europe within 48 hours) — plus a chain that uses each over the stretch where
  it is best.
- **Automatic fallbacks**: if a provider exceeds its horizon, fails or has no
  data, only the affected steps switch to Open-Meteo. An abbreviated label
  (OPM / ARM / OPW) marks which source each column came from.
- **Comparison modes**: two providers side by side, or the same route on two
  different dates.
- **Interactive table and map**: hourly icons, wind speed with direction and
  gusts, rain amount and probability, humidity, cloud, a luminosity bar and UV;
  wind arrows, precipitation drops and route markers on the map, linked to the
  selected column.
- **Solar information**: sunrise, sunset, civil twilight and calculated
  luminosity.
- **Route loading**: the file picker, recent routes kept locally, or URL
  parameters such as `?gpx_url=`, `?datetime=` and `?speed=`.
- **Local caching**: provider responses are kept for ~30 minutes per step, to
  speed up reloads and stay inside API limits.
- **Native apps**: system share sheet both ways, `.gpx` / `.kml` file handler,
  background alerts when the forecast for a planned route turns worse, and a
  forecast that survives going out of signal.
- **Privacy-focused**: it runs on your device. Only coordinates, times and your
  own API key reach the weather providers.
- **Open source**: MIT licensed.

Every one of these is explained in the [user guide](docs/GUIDE.md).

## Privacy, in one paragraph

MeteoRide runs entirely on your device: settings, routes and cache never leave
it, and there is no account. The one exception is the website's iOS Shortcuts
handoff, which uploads the GPX to Cloudflare because Shortcuts only accept POST;
that file is deleted within two minutes. The native apps do not need it. Weather
providers receive only the coordinates of your route, the times you ask about,
and your API key if you configured one. The detail is in
[the guide](docs/GUIDE.md#13-privacy-and-data).

## Contributing

Contributions are welcome: fork the repo, report issues, suggest features,
translate to new languages or improve the docs.
[GitHub Issues](https://github.com/lockevod/MeteoRide/issues) is also where to
ask for support.

Developed by [Lockevod](https://github.com/lockevod).

## License

MIT — see [LICENSE](LICENSE).

Bikemap, Komoot, OpenWeatherMaps, Openmeteo and Hammerhead are registered marks.
They may have specific proprietary licenses; if you use this code or the
published webapp you must comply with them.

This code and the webapp are provided as-is, without warranty. By using this
repository or the webapp you accept these terms.

## Support the project

If you find MeteoRide useful, consider supporting it with a donation:

<a href="https://www.buymeacoffee.com/enderthor" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/default-orange.png" alt="Buy Me A Coffee" height="41" width="174"></a>

---

**Disclaimer**: MeteoRide is a planning tool. Weather data are estimates and may
not be accurate. Always verify conditions and use your judgment. The developer
is not responsible for decisions based on this information.
