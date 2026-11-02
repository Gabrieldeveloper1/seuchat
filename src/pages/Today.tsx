import { useCallback, useEffect, useState } from "react";
import { useApp } from "../lib/store";
import type { NewsItem } from "../lib/api";
import { describe, getWeather, savePlace, savedPlace, searchPlaces, type Place, type Sky, type Weather } from "../lib/weather";
import { IconBack, IconCloud, IconCloudRain, IconCloudSnow, IconDrop, IconExternal, IconFog, IconLoader, IconMoon, IconNews, IconPin, IconRefresh, IconSearch, IconStorm, IconSun, IconWind, IconX } from "../icons";

export function SkyIcon({ sky, day = true, ...p }: { sky: Sky; day?: boolean; className?: string }) {
  const I = sky === "clear" ? (day ? IconSun : IconMoon) : sky === "partly" ? IconCloud : sky === "cloud" ? IconCloud : sky === "fog" ? IconFog : sky === "rain" ? IconCloudRain : sky === "snow" ? IconCloudSnow : IconStorm;
  return <I {...p} />;
}

const CATS: [string, string][] = [["destaques", "Destaques"], ["brasil", "Brasil"], ["mundo", "Mundo"], ["economia", "Economia"], ["tecnologia", "Tecnologia"], ["esportes", "Esportes"], ["entretenimento", "Entretenimento"], ["ciencia", "Ciência e saúde"]];

function ago(ts: number): string {
  if (!ts) return "";
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  return h < 24 ? `há ${h} h` : new Date(ts).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}
const hour = (iso: string) => iso.slice(11, 16);
const wday = (iso: string, i: number) => (i === 0 ? "Hoje" : new Date(iso + "T12:00").toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", ""));

function WeatherCard() {
  const [place, setPlace] = useState<Place>(savedPlace);
  const [w, setW] = useState<Weather | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Place[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let off = false;
    setW(null); setErr(null);
    getWeather(place).then((x) => !off && setW(x)).catch((e) => !off && setErr(e instanceof Error ? e.message : "Falha"));
    return () => { off = true; };
  }, [place]);
  useEffect(() => {
    if (q.trim().length < 2) return setFound([]);
    const t = setTimeout(() => { searchPlaces(q.trim()).then(setFound).catch(() => setFound([])); }, 300);
    return () => clearTimeout(t);
  }, [q]);
  const choose = (p: Place) => { savePlace(p); setPlace(p); setPicking(false); setQ(""); };
  const locate = () => {
    if (!navigator.geolocation) return;
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setBusy(false); choose({ name: "Minha localização", lat: +pos.coords.latitude.toFixed(2), lon: +pos.coords.longitude.toFixed(2) }); },
      () => { setBusy(false); setErr("Permissão de localização negada. Busque sua cidade."); },
      { timeout: 10000, maximumAge: 600000 },
    );
  };
  const d = w ? describe(w.current.code) : null;
  return (
    <section className={`wx ${d ? `sky-${d.sky}` : ""} ${w && !w.current.isDay ? "night" : ""}`}>
      <div className="wx-top">
        <button className="wx-place" onClick={() => setPicking((v) => !v)}><IconPin /> {place.name}{place.admin ? `, ${place.admin}` : ""}</button>
        <span className="wx-src">Open-Meteo</span>
      </div>
      {picking && (
        <div className="wx-pick">
          <div className="emoji-search"><IconSearch /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cidade" aria-label="Buscar cidade" />{q && <button aria-label="Limpar" onClick={() => setQ("")}><IconX /></button>}</div>
          <button className="btn sm" onClick={locate} disabled={busy}>{busy ? <IconLoader className="spin" /> : <IconPin />} Usar minha localização</button>
          {found.map((p) => <button key={`${p.lat},${p.lon}`} className="wx-opt" onClick={() => choose(p)}><b>{p.name}</b><span>{[p.admin, p.country].filter(Boolean).join(" · ")}</span></button>)}
        </div>
      )}
      {err && <div className="wx-err">{err}</div>}
      {!w && !err && <div className="wx-skel"><i /><i /><i /></div>}
      {w && d && (
        <>
          <div className="wx-now">
            <SkyIcon sky={d.sky} day={w.current.isDay} className="wx-big" />
            <div>
              <div className="wx-temp">{Math.round(w.current.temp)}°</div>
              <div className="wx-label">{d.label}</div>
            </div>
            <div className="wx-stats">
              <span><IconSun /> Sensação {Math.round(w.current.feels)}°</span>
              <span><IconDrop /> Umidade {w.current.humidity}%</span>
              <span><IconWind /> Vento {Math.round(w.current.wind)} km/h</span>
              <span>Máx. {Math.round(w.daily[0].max)}° · Mín. {Math.round(w.daily[0].min)}°</span>
            </div>
          </div>
          <div className="wx-hours">
            {w.hourly.map((h, i) => <div key={h.time} className="wx-h"><span>{i === 0 ? "Agora" : hour(h.time)}</span><SkyIcon sky={describe(h.code).sky} day={+h.time.slice(11, 13) >= 6 && +h.time.slice(11, 13) < 18} /><b>{Math.round(h.temp)}°</b>{h.rain >= 20 && <small>{h.rain}%</small>}</div>)}
          </div>
          <div className="wx-days">
            {w.daily.map((x, i) => {
              const lo = Math.min(...w.daily.map((y) => y.min)), hi = Math.max(...w.daily.map((y) => y.max));
              return (
                <div key={x.date} className="wx-d">
                  <span className="wx-dn">{wday(x.date, i)}</span>
                  <SkyIcon sky={describe(x.code).sky} />
                  <small>{x.rain >= 20 ? `${x.rain}%` : ""}</small>
                  <span className="wx-min">{Math.round(x.min)}°</span>
                  <span className="wx-range"><i style={{ left: `${((x.min - lo) / (hi - lo || 1)) * 100}%`, right: `${100 - ((x.max - lo) / (hi - lo || 1)) * 100}%` }} /></span>
                  <span className="wx-max">{Math.round(x.max)}°</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

function News() {
  const { fetchNews } = useApp();
  const [cat, setCat] = useState("destaques");
  const [items, setItems] = useState<NewsItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [at, setAt] = useState(0);
  const load = useCallback((c: string) => {
    setItems(null); setErr(null);
    fetchNews(c).then((r) => { setItems(r.items); setAt(r.updatedAt); }).catch((e) => setErr(e instanceof Error ? e.message : "Falha ao carregar notícias"));
  }, [fetchNews]);
  useEffect(() => load(cat), [cat, load]);
  const [first, ...rest] = items ?? [];
  return (
    <section className="news">
      <div className="sec-head"><h3><IconNews /> Notícias do dia</h3>{at > 0 && <span className="muted small">Atualizado {ago(at)}</span>}<button className="icon-btn" aria-label="Atualizar" onClick={() => load(cat)}><IconRefresh /></button></div>
      <div className="chips news-chips">{CATS.map(([v, t]) => <button key={v} className={`chip ${cat === v ? "on" : ""}`} onClick={() => setCat(v)}>{t}</button>)}</div>
      {err && <div className="empty"><IconNews style={{ width: 34, height: 34 }} /><div>{err}<br /><span className="small">As notícias precisam da função <b>news</b> publicada no servidor.</span></div><button className="btn sm" onClick={() => load(cat)}><IconRefresh /> Tentar de novo</button></div>}
      {!items && !err && <div className="news-grid">{Array.from({ length: 6 }, (_, i) => <div key={i} className="news-card skel"><i /><b /><b /></div>)}</div>}
      {first && (
        <a className="news-hero" href={first.link} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
          <span className="news-hero-txt"><span className="news-src">{first.source} · {ago(first.date)}</span><b>{first.title}</b>{first.summary && <span className="news-sum">{first.summary}</span>}</span>
        </a>
      )}
      {rest.length > 0 && (
        <div className="news-grid">
          {rest.map((n) => (
            <a key={n.link} className="news-card" href={n.link} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
              <span className="news-ph"><IconNews /></span>
              <span className="news-src">{n.source} · {ago(n.date)} <IconExternal /></span>
              <b>{n.title}</b>
            </a>
          ))}
        </div>
      )}
      <p className="muted small center-text">Links abrem o site original em uma nova aba. Fontes: g1, BBC News Brasil e Google Notícias.</p>
    </section>
  );
}

export default function Today({ onBack, name }: { onBack: () => void; name: string }) {
  const h = new Date().getHours();
  const hello = h < 5 ? "Boa noite" : h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
  return (
    <div className="pane">
      <div className="chat-head pane-head">
        <button className="icon-btn back" onClick={onBack} aria-label="Voltar"><IconBack /></button>
        <div className="t"><b>{hello}, {name.split(" ")[0]}</b><span className="muted small">{new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}</span></div>
      </div>
      <div className="pane-body">
        <WeatherCard />
        <News />
      </div>
    </div>
  );
}
