import { useSyncExternalStore } from "react";

// Player de música global: continua tocando enquanto a pessoa conversa.
export interface Track { id: string; title: string; artist: string; art?: string; src: string; dur?: number; source: "audius" | "itunes"; preview?: boolean }
interface St { queue: Track[]; i: number; playing: boolean; t: number; d: number; loading: boolean; error: string | null; vol: number }

let st: St = { queue: [], i: -1, playing: false, t: 0, d: 0, loading: false, error: null, vol: Math.max(0, Math.min(1, Number(localStorage.getItem("scs.vol") ?? 0.9))) };
const subs = new Set<() => void>();
const set = (p: Partial<St>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
let audio: HTMLAudioElement | null = null;

function el(): HTMLAudioElement {
  if (audio) return audio;
  const a = new Audio();
  a.preload = "auto";
  a.volume = st.vol;
  a.onplay = () => set({ playing: true });
  a.onpause = () => set({ playing: false });
  a.onwaiting = () => set({ loading: true });
  a.oncanplay = () => set({ loading: false });
  a.onplaying = () => set({ loading: false, error: null });
  a.ontimeupdate = () => set({ t: a.currentTime, d: isFinite(a.duration) ? a.duration : st.d });
  a.onended = () => player.next(true);
  a.onerror = () => { set({ loading: false, playing: false, error: "Não foi possível tocar esta faixa" }); };
  audio = a;
  return a;
}

function session(tr: Track) {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({ title: tr.title, artist: tr.artist, album: "SeuChatSeguro", artwork: tr.art ? [{ src: tr.art, sizes: "480x480", type: "image/jpeg" }] : [] });
  navigator.mediaSession.setActionHandler("play", () => player.toggle());
  navigator.mediaSession.setActionHandler("pause", () => player.toggle());
  navigator.mediaSession.setActionHandler("nexttrack", () => player.next());
  navigator.mediaSession.setActionHandler("previoustrack", () => player.prev());
}

export const player = {
  play(queue: Track[], i: number) {
    const tr = queue[i];
    if (!tr) return;
    const a = el();
    set({ queue, i, t: 0, d: tr.dur ?? 0, loading: true, error: null });
    a.src = tr.src;
    void a.play().catch(() => set({ loading: false, error: "Não foi possível reproduzir esta faixa neste navegador" }));
    session(tr);
  },
  toggle() { const a = el(); if (!a.src) return; if (a.paused) void a.play().catch(() => {}); else a.pause(); },
  next(auto = false) { if (st.i + 1 < st.queue.length) player.play(st.queue, st.i + 1); else if (!auto) player.play(st.queue, 0); },
  prev() { const a = el(); if (a.currentTime > 4 || st.i <= 0) { a.currentTime = 0; return; } player.play(st.queue, st.i - 1); },
  seek(p: number) { const a = el(); const d = isFinite(a.duration) ? a.duration : st.d; if (d) a.currentTime = Math.max(0, Math.min(d, p * d)); },
  volume(v: number) { el().volume = v; localStorage.setItem("scs.vol", String(v)); set({ vol: v }); },
  stop() { const a = el(); a.pause(); a.removeAttribute("src"); a.load(); set({ queue: [], i: -1, playing: false, t: 0, d: 0 }); },
};

export function usePlayer() {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => st);
}

// ---- fontes públicas ----
const APP = "SeuChatSeguro";
interface AudiusTrack { id: string; title: string; duration: number; user: { name: string }; artwork?: Record<string, string> | null; is_streamable?: boolean }
const fromAudius = (x: AudiusTrack): Track => ({
  id: `a:${x.id}`, title: x.title, artist: x.user?.name ?? "Artista", art: x.artwork?.["480x480"] ?? x.artwork?.["150x150"], dur: x.duration,
  src: `https://api.audius.co/v1/tracks/${encodeURIComponent(x.id)}/stream?app_name=${APP}`, source: "audius",
});
async function getJson<T>(url: string): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctl.signal, referrerPolicy: "no-referrer" });
    if (!r.ok) throw new Error("Serviço de música indisponível agora");
    return (await r.json()) as T;
  } catch (e) { throw e instanceof Error && e.name !== "AbortError" ? e : new Error("O serviço de música demorou para responder"); }
  finally { clearTimeout(t); }
}

export async function audiusTrending(genre?: string): Promise<Track[]> {
  const q = new URLSearchParams({ app_name: APP, limit: "30", time: "week" });
  if (genre) q.set("genre", genre);
  const r = await getJson<{ data: AudiusTrack[] }>(`https://api.audius.co/v1/tracks/trending?${q}`);
  return r.data.filter((x) => x.is_streamable !== false).map(fromAudius);
}
export async function audiusSearch(term: string): Promise<Track[]> {
  const r = await getJson<{ data: AudiusTrack[] }>(`https://api.audius.co/v1/tracks/search?${new URLSearchParams({ app_name: APP, query: term, limit: "30" })}`);
  return r.data.filter((x) => x.is_streamable !== false).map(fromAudius);
}
interface ItunesTrack { trackId: number; trackName: string; artistName: string; artworkUrl100?: string; previewUrl?: string; trackTimeMillis?: number }
export async function itunesSearch(term: string): Promise<Track[]> {
  const r = await getJson<{ results: ItunesTrack[] }>(`https://itunes.apple.com/search?${new URLSearchParams({ term, media: "music", entity: "song", limit: "30", country: "BR" })}`);
  return r.results.filter((x) => x.previewUrl).map((x) => ({
    id: `i:${x.trackId}`, title: x.trackName, artist: x.artistName, art: x.artworkUrl100?.replace("100x100", "600x600"),
    src: x.previewUrl!, dur: 30, source: "itunes" as const, preview: true,
  }));
}
