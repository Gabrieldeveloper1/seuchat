import { useEffect, useRef, useState } from "react";

const VIDEO = "/seuchatseguro-tour.mp4";
const MOBILE_VIDEO = "/seuchatseguro-tour-mobile.mp4";
const POSTER = "/seuchatseguro-tour-poster.png";
const MOBILE_POSTER = "/seuchatseguro-tour-mobile-poster.png";

export default function WelcomeVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [mobile, setMobile] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches);
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [failed, setFailed] = useState(false);
  const [paused, setPaused] = useState(false);
  const video = mobile ? MOBILE_VIDEO : VIDEO;
  const poster = mobile ? MOBILE_POSTER : POSTER;

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const compact = window.matchMedia("(max-width: 900px)");
    const update = () => {
      setReducedMotion(media.matches);
      if (media.matches) videoRef.current?.pause();
    };
    const updateSize = () => {
      setMobile(compact.matches);
      setFailed(false);
    };
    update();
    media.addEventListener("change", update);
    compact.addEventListener("change", updateSize);
    return () => {
      media.removeEventListener("change", update);
      compact.removeEventListener("change", updateSize);
    };
  }, []);

  async function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;
    if (paused) {
      try {
        await video.play();
        setPaused(false);
      } catch {
        setPaused(true);
      }
    } else {
      video.pause();
      setPaused(true);
    }
  }

  return (
    <figure className="welcome-tour" aria-label="Apresentação do SeuChatSeguro">
      <div className="welcome-tour-frame">
        {reducedMotion || failed ? (
          <img
            className="welcome-tour-poster"
            src={poster}
            alt="Apresentação do SeuChatSeguro: conversas, grupos, chamadas e recursos para o dia a dia."
          />
        ) : (
          <video
            key={video}
            ref={videoRef}
            className="welcome-tour-video"
            src={video}
            poster={poster}
            autoPlay
            muted
            loop
            playsInline
            controls={false}
            preload="metadata"
            aria-label="Vídeo de apresentação silencioso, em reprodução automática e contínua."
            onError={() => setFailed(true)}
          >
            Seu navegador não oferece suporte a vídeo. Veja a imagem de apresentação.
          </video>
        )}
      </div>
      <figcaption className="welcome-tour-caption">
        <span>Tour visual · 51 s · sem áudio</span>
        {!reducedMotion && !failed && (
          <button
            className="welcome-tour-toggle"
            type="button"
            onClick={() => void togglePlayback()}
            aria-pressed={paused}
          >
            <span aria-hidden="true">{paused ? "▶" : "Ⅱ"}</span>
            {paused ? "Retomar apresentação" : "Pausar apresentação"}
          </button>
        )}
      </figcaption>
    </figure>
  );
}