// Clima pela API pública e gratuita Open-Meteo (sem chave).
export interface Place { name: string; lat: number; lon: number; admin?: string; country?: string }
export interface Weather {
  current: { temp: number; feels: number; humidity: number; wind: number; code: number; isDay: boolean };
  hourly: { time: string; temp: number; code: number; rain: number }[];
  daily: { date: string; max: number; min: number; code: number; rain: number; sunrise: string; sunset: string }[];
}
const KEY = "scs.place";
export const DEFAULT_PLACE: Place = { name: "São Paulo", lat: -23.55, lon: -46.63, admin: "SP", country: "Brasil" };
export function savedPlace(): Place {
  try { const p = JSON.parse(localStorage.getItem(KEY) ?? "null"); if (p && typeof p.lat === "number") return p; } catch { /* */ }
  return DEFAULT_PLACE;
}
export const savePlace = (p: Place) => localStorage.setItem(KEY, JSON.stringify(p));

export async function searchPlaces(q: string): Promise<Place[]> {
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: q, count: "6", language: "pt", format: "json" })}`, { referrerPolicy: "no-referrer" });
  if (!r.ok) throw new Error("Busca de cidades indisponível");
  const j = await r.json() as { results?: { name: string; latitude: number; longitude: number; admin1?: string; country?: string }[] };
  return (j.results ?? []).map((x) => ({ name: x.name, lat: x.latitude, lon: x.longitude, admin: x.admin1, country: x.country }));
}

export async function getWeather(p: Place): Promise<Weather> {
  const q = new URLSearchParams({
    latitude: String(p.lat), longitude: String(p.lon), timezone: "auto", forecast_days: "7",
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day",
    hourly: "temperature_2m,weather_code,precipitation_probability",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset",
  });
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`, { referrerPolicy: "no-referrer" });
  if (!r.ok) throw new Error("Previsão do tempo indisponível agora");
  const j = await r.json();
  const nowIso = j.current.time as string;
  const start = Math.max(0, (j.hourly.time as string[]).findIndex((t) => t >= nowIso.slice(0, 13)));
  return {
    current: { temp: j.current.temperature_2m, feels: j.current.apparent_temperature, humidity: j.current.relative_humidity_2m, wind: j.current.wind_speed_10m, code: j.current.weather_code, isDay: !!j.current.is_day },
    hourly: (j.hourly.time as string[]).slice(start, start + 24).map((t, k) => ({ time: t, temp: j.hourly.temperature_2m[start + k], code: j.hourly.weather_code[start + k], rain: j.hourly.precipitation_probability[start + k] ?? 0 })),
    daily: (j.daily.time as string[]).map((d, k) => ({ date: d, max: j.daily.temperature_2m_max[k], min: j.daily.temperature_2m_min[k], code: j.daily.weather_code[k], rain: j.daily.precipitation_probability_max[k] ?? 0, sunrise: j.daily.sunrise[k], sunset: j.daily.sunset[k] })),
  };
}

export type Sky = "clear" | "partly" | "cloud" | "fog" | "rain" | "snow" | "storm";
export function describe(code: number): { label: string; sky: Sky } {
  if (code === 0) return { label: "Céu limpo", sky: "clear" };
  if (code <= 2) return { label: code === 1 ? "Poucas nuvens" : "Parcialmente nublado", sky: "partly" };
  if (code === 3) return { label: "Nublado", sky: "cloud" };
  if (code <= 48) return { label: "Neblina", sky: "fog" };
  if (code <= 57) return { label: "Garoa", sky: "rain" };
  if (code <= 67) return { label: "Chuva", sky: "rain" };
  if (code <= 77) return { label: "Neve", sky: "snow" };
  if (code <= 82) return { label: "Pancadas de chuva", sky: "rain" };
  if (code <= 86) return { label: "Neve", sky: "snow" };
  return { label: "Tempestade", sky: "storm" };
}
