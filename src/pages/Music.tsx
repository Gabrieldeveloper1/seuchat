import { useEffect, useState } from "react";
import { audiusSearch, audiusTrending, itunesSearch, player, usePlayer, type Track } from "../lib/player";
import { IconBack, IconMusic, IconPause, IconPlay, IconSearch, IconSkipNext, IconSkipPrev, IconX } from "../icons";

const genres = [["", "Em alta"], ["Electronic", "Eletrônica"], ["Hip-Hop/Rap", "Hip-hop"], ["Pop", "Pop"], ["Lo-Fi", "Lo-fi"], ["Rock", "Rock"], ["R&B/Soul", "R&B"]];
const time = (n: number) => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`;

export default function Music({ onBack }: { onBack: () => void }) {
  const [genre, setGenre] = useState("");
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<"audius" | "itunes">("audius");
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const p = usePlayer();
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(""); setTracks([]);
    const request = query ? (source === "audius" ? audiusSearch(query) : itunesSearch(query)) : audiusTrending(genre);
    request.then((v) => { if (!cancelled) setTracks(v); }).catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : "Falha ao carregar músicas"); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [genre, query, source]);
  return <div className="pane"><div className="chat-head pane-head"><button className="icon-btn back" onClick={onBack} aria-label="Voltar"><IconBack /></button><div className="t"><b>Música</b><span className="muted small">Encontre algo para ouvir</span></div></div>
    <div className="pane-body music-page">
      <form className="music-search" onSubmit={(e) => { e.preventDefault(); setQuery(text.trim()); }}><IconSearch /><input value={text} onChange={(e) => setText(e.target.value)} placeholder="Buscar artista ou música" aria-label="Buscar música" /><button className="btn sm" type="submit">Buscar</button></form>
      <div className="chips music-chips">{genres.map(([v,t]) => <button key={v} className={`chip ${!query && genre === v ? "on" : ""}`} onClick={() => { setText(""); setQuery(""); setGenre(v); }}>{t}</button>)}</div>
      {query && <div className="music-sources"><span>Buscar em:</span><button className={`chip ${source === "audius" ? "on" : ""}`} onClick={() => setSource("audius")}>Audius</button><button className={`chip ${source === "itunes" ? "on" : ""}`} onClick={() => setSource("itunes")}>iTunes · prévias</button></div>}
      <h3>{query ? `Resultados para “${query}”` : genre ? genres.find(([v]) => v === genre)?.[1] : "Em alta"}</h3>
      <p className="muted small">{query && source === "itunes" ? "Prévia de até 30 segundos, fornecida pelo iTunes." : "Músicas disponíveis no Audius."} Esses serviços externos recebem seu IP.</p>
      {loading && <p className="muted">Carregando músicas…</p>}{error && <div className="error" role="alert">{error}</div>}{!loading && !error && !tracks.length && <p className="muted">Nenhuma música encontrada.</p>}
      <div className="music-list">{tracks.map((tr,i) => <button className="music-track" key={tr.id} onClick={() => player.play(tracks,i)}><span className="music-art">{tr.art ? <img src={tr.art} alt="" referrerPolicy="no-referrer" /> : <IconMusic />}</span><span className="music-title"><b>{tr.title}</b><small>{tr.artist}{tr.preview ? " · prévia" : ""}</small></span><span>{p.queue[p.i]?.id === tr.id && p.playing ? <IconPause /> : <IconPlay />}</span></button>)}</div>
      {p.error && <div className="error" role="alert">{p.error}</div>}
    </div></div>;
}

export function MiniPlayer() {
  const p = usePlayer(); const tr = p.queue[p.i];
  if (!tr) return null;
  return <div className="mini-player" role="region" aria-label="Tocando agora"><span className="music-art">{tr.art ? <img src={tr.art} alt="" referrerPolicy="no-referrer" /> : <IconMusic />}</span><span className="music-title"><b>{tr.title}</b><small>{tr.artist} · {time(p.t)} / {time(p.d)}</small></span><button aria-label="Anterior" onClick={() => player.prev()}><IconSkipPrev /></button><button aria-label={p.playing ? "Pausar" : "Reproduzir"} onClick={() => player.toggle()}>{p.playing ? <IconPause /> : <IconPlay />}</button><button aria-label="Próxima" onClick={() => player.next()}><IconSkipNext /></button><button aria-label="Fechar player" onClick={() => player.stop()}><IconX /></button><input className="mini-seek" type="range" min="0" max="1000" value={p.d ? Math.round(Math.min(1, p.t / p.d)*1000) : 0} onChange={(e) => player.seek(Number(e.target.value)/1000)} aria-label="Posição da música" /></div>;
}
