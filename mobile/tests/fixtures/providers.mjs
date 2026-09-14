// Synthetic provider answers shaped like the real ones. Every hour carries a different
// value, so a lookup that lands on the wrong index shows up as a different number.
// There are no real captured answers in the repository; these follow the documented
// shapes (Open-Meteo hourly + minutely_15 + utc_offset_seconds, OpenWeather One Call).

export const OFFSET = 7200; // Europe/Madrid in September

const pad = (n) => String(n).padStart(2, '0');
const local = (day, hour, minute = 0) => `2026-09-${pad(day)}T${pad(hour)}:${pad(minute)}`;

/** Open-Meteo (and AROME after merging): 48 hourly slots from 20 Sept 00:00 local. */
export function openMeteo({ minutely = true, drop = [] } = {}) {
  const time = [];
  for (let i = 0; i < 48; i++) time.push(local(20 + Math.floor(i / 24), i % 24));
  const series = (f) => time.map((_, i) => f(i));
  const hourly = {
    time,
    temperature_2m: series((i) => 10 + i),
    precipitation: series((i) => (i % 5 === 0 ? 0 : i / 10)),
    precipitation_probability: series((i) => (i * 7) % 100),
    relative_humidity_2m: series((i) => 40 + (i % 50)),
    wind_speed_10m: series((i) => 5 + i),
    wind_gusts_10m: series((i) => 15 + i),
    winddirection_10m: series((i) => (i * 15) % 360),
    weathercode: series((i) => [0, 1, 3, 61, 80][i % 5]),
    uv_index: series((i) => i % 9),
    is_day: series((i) => (i % 24 >= 7 && i % 24 < 20 ? 1 : 0)),
    cloud_cover: series((i) => (i * 11) % 100),
  };
  for (const key of drop) delete hourly[key];
  const out = { latitude: 41.4, longitude: 2.2, utc_offset_seconds: OFFSET, timezone: 'Europe/Madrid', hourly };
  if (minutely) {
    // 24 quarters from 08:00 to 13:45 local.
    const mtime = [];
    for (let q = 0; q < 24; q++) mtime.push(local(20, 8 + Math.floor(q / 4), (q % 4) * 15));
    const ms = (f) => mtime.map((_, q) => f(q));
    out.minutely_15 = {
      time: mtime,
      temperature_2m: ms((q) => 100 + q),
      precipitation: ms((q) => q / 100),
      precipitation_probability: ms(() => null),
      relative_humidity_2m: ms((q) => 70 + q),
      wind_speed_10m: ms((q) => 50 + q),
      wind_gusts_10m: ms((q) => 60 + q),
      winddirection_10m: ms((q) => q * 10),
      weathercode: ms((q) => [2, 3][q % 2]),
      uv_index: ms(() => null),
      is_day: ms(() => 1),
      // Present on purpose: processWeatherData reads cloud cover from hourly even when
      // the rest comes from minutely_15, and only a different value here shows it.
      cloud_cover: ms(() => 5),
    };
  }
  return out;
}

/** OpenWeather One Call: 48 hourly entries from 20 Sept 00:00 local and 8 daily ones. */
export function openWeather(units = 'metric') {
  const start = Date.UTC(2026, 8, 19, 22, 0) / 1000;
  // Wind values are km/h expressed in the unit the request asked for.
  const k = units === 'imperial' ? 1 / 1.60934 : 1 / 3.6;
  const hourly = Array.from({ length: 48 }, (_, i) => ({
    dt: start + i * 3600,
    temp: 10 + i,
    wind_speed: (5 + i) * k,
    wind_gust: (15 + i) * k,
    wind_deg: (i * 15) % 360,
    humidity: 40 + (i % 50),
    rain: i % 5 ? { '1h': i / 10 } : undefined,
    weather: [{ id: [800, 801, 804, 500, 521][i % 5] }],
    uvi: i % 9,
    clouds: (i * 11) % 100,
    pop: ((i * 7) % 100) / 100,
  }));
  const daily = Array.from({ length: 8 }, (_, d) => ({
    dt: start + d * 86400 + 12 * 3600,
    temp: { day: 20 + d },
    wind_speed: (8 + d) * k,
    wind_gust: (20 + d) * k,
    wind_deg: d * 40,
    humidity: 60 + d,
    rain: d,
    snow: 0,
    pop: d / 10,
    weather: [{ id: 500 + d }],
    uvi: d,
    clouds: d * 10,
  }));
  return { lat: 41.4, lon: 2.2, timezone_offset: OFFSET, hourly, daily };
}

/** UTC instants the characterization looks every answer up at (08:00 … local). */
export const STEP_TIMES = [
  '2026-09-20T06:00:00Z', // 08:00 local, first minutely quarter
  '2026-09-20T06:20:00Z', // 08:20 local, between quarters
  '2026-09-20T06:40:00Z', // 08:40 local, past the half hour
  '2026-09-20T09:30:00Z', // 11:30 local, inside minutely
  '2026-09-20T14:10:00Z', // 16:10 local, outside minutely
  '2026-09-22T03:00:00Z', // beyond the 48 hourly slots
];
