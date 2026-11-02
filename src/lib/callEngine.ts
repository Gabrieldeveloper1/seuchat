// Chamadas de voz/vídeo e compartilhamento de tela (WebRTC). A sinalização (SDP) viaja DENTRO das
// mensagens seladas e assinadas do relay; o fingerprint DTLS fica autenticado de ponta a ponta.
export type CallPhase = "idle" | "incoming" | "calling" | "connected";

export interface CallState {
  phase: CallPhase;
  peer: string | null;
  video: boolean;
  mic: boolean;
  cam: boolean;
  sharing: boolean;
  local: MediaStream | null;
  remote: MediaStream | null;
  remoteScreen: MediaStream | null;
  startedAt: number | null;
  info: string | null;
}

/** Navegadores de celular (Chrome/Safari mobile) não expõem getDisplayMedia; no computador sim. */
export const screenShareSupported = () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;

export const IDLE: CallState = { phase: "idle", peer: null, video: false, mic: true, cam: false, sharing: false, local: null, remote: null, remoteScreen: null, startedAt: null, info: null };

interface Sig { t: "call"; op: "offer" | "answer" | "end" | "reject"; cid: string; sdp?: string; video?: boolean; reneg?: boolean; reason?: string }

const turnUrl = import.meta.env.VITE_TURN_URL as string | undefined;
export const turnConfigured = !!turnUrl;

function iceConfig(relayOnly: boolean): RTCConfiguration {
  const servers: RTCIceServer[] = [{ urls: (import.meta.env.VITE_STUN_URL as string) || "stun:stun.l.google.com:19302" }];
  if (turnUrl) servers.push({ urls: turnUrl, username: import.meta.env.VITE_TURN_USER as string, credential: import.meta.env.VITE_TURN_PASS as string });
  return { iceServers: servers, iceTransportPolicy: relayOnly && turnUrl ? "relay" : "all" };
}

function gathered(pc: RTCPeerConnection, ms = 4000): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((res) => {
    const done = () => { pc.removeEventListener("icegatheringstatechange", chk); clearTimeout(t); res(); };
    const chk = () => pc.iceGatheringState === "complete" && done();
    const t = setTimeout(done, ms);
    pc.addEventListener("icegatheringstatechange", chk);
  });
}

export class CallEngine {
  state: CallState = IDLE;
  private pc: RTCPeerConnection | null = null;
  private cid = "";
  private pending: { sdp: string; video: boolean } | null = null;
  private makingOffer = false;
  private caller = false;
  private mainId: string | null = null;
  private screenSender: RTCRtpSender | null = null;
  private screenStream: MediaStream | null = null;
  private timer: number | undefined;
  private facing: "user" | "environment" = "user";

  constructor(
    private send: (peer: string, sig: Sig) => Promise<void>,
    private onChange: (s: CallState) => void,
    private relayOnly: () => boolean,
  ) {}

  private set(p: Partial<CallState>) {
    this.state = { ...this.state, ...p };
    this.onChange(this.state);
  }

  private async media(video: boolean): Promise<MediaStream> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Chamadas não são suportadas neste navegador (use HTTPS)");
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: video ? { facingMode: this.facing, width: { ideal: 1280 }, height: { ideal: 720 } } : false });
    } catch {
      throw new Error(video ? "Permita câmera e microfone para chamar" : "Permita o uso do microfone para chamar");
    }
  }

  private makePc() {
    const pc = new RTCPeerConnection(iceConfig(this.relayOnly()));
    pc.ontrack = (e) => {
      const st = e.streams[0];
      if (!st) return;
      if (!this.mainId) this.mainId = st.id;
      const isMain = st.id === this.mainId;
      const refresh = () => {
        const live = st.getVideoTracks().some((t) => t.readyState === "live" && !t.muted);
        this.set(isMain ? { remote: st } : { remoteScreen: live ? st : null });
      };
      e.track.addEventListener("mute", refresh);
      e.track.addEventListener("unmute", refresh);
      e.track.addEventListener("ended", refresh);
      refresh();
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected" && this.state.phase !== "connected") {
        clearTimeout(this.timer);
        this.set({ phase: "connected", startedAt: Date.now() });
      }
      if (pc.connectionState === "failed" || pc.connectionState === "closed") this.cleanup("A conexão da chamada caiu");
    };
    this.pc = pc;
    return pc;
  }

  async start(peer: string, video: boolean) {
    if (this.state.phase !== "idle") throw new Error("Você já está em uma chamada");
    const local = await this.media(video);
    this.cid = crypto.randomUUID();
    this.caller = true;
    this.mainId = null;
    const pc = this.makePc();
    local.getTracks().forEach((t) => pc.addTrack(t, local));
    this.set({ ...IDLE, phase: "calling", peer, video, cam: video, local });
    try {
      this.makingOffer = true;
      await pc.setLocalDescription(await pc.createOffer());
      await gathered(pc);
      this.makingOffer = false;
      await this.send(peer, { t: "call", op: "offer", cid: this.cid, sdp: pc.localDescription!.sdp, video });
    } catch (e) {
      this.cleanup("Não foi possível iniciar a chamada");
      throw e;
    }
    this.timer = window.setTimeout(() => void this.hangup("Sem resposta"), 45_000);
  }

  /** Chamado pelo store ao receber um sinal de um contato aceito. */
  async handle(from: string, p: Sig, sentAt: number) {
    const idle = this.state.phase === "idle";
    if (p.op === "offer" && p.sdp) {
      if (p.reneg && this.pc && from === this.state.peer && p.cid === this.cid) return this.renegotiate(p.sdp);
      if (Date.now() - sentAt > 60_000) return; // toque velho
      if (!idle) return void this.send(from, { t: "call", op: "reject", cid: p.cid, reason: "busy" }).catch(() => {});
      this.cid = p.cid;
      this.caller = false;
      this.mainId = null;
      this.pending = { sdp: p.sdp, video: !!p.video };
      this.set({ ...IDLE, phase: "incoming", peer: from, video: !!p.video });
      this.timer = window.setTimeout(() => void this.reject(), 45_000);
    } else if (from === this.state.peer && p.cid === this.cid) {
      if (p.op === "answer" && p.sdp && this.pc) await this.pc.setRemoteDescription({ type: "answer", sdp: p.sdp }).catch(() => {});
      else if (p.op === "end") this.cleanup("Chamada encerrada");
      else if (p.op === "reject") this.cleanup(p.reason === "busy" ? "Contato ocupado" : "Chamada recusada");
    }
  }

  async accept() {
    const pend = this.pending;
    const peer = this.state.peer;
    if (!pend || !peer || this.state.phase !== "incoming") return;
    clearTimeout(this.timer);
    try {
      const local = await this.media(pend.video);
      const pc = this.makePc();
      await pc.setRemoteDescription({ type: "offer", sdp: pend.sdp });
      local.getTracks().forEach((t) => pc.addTrack(t, local));
      await pc.setLocalDescription(await pc.createAnswer());
      await gathered(pc);
      this.set({ local, cam: pend.video });
      await this.send(peer, { t: "call", op: "answer", cid: this.cid, sdp: pc.localDescription!.sdp });
    } catch (e) {
      void this.send(peer, { t: "call", op: "reject", cid: this.cid }).catch(() => {});
      this.cleanup(null);
      throw e;
    }
    this.pending = null;
  }

  async reject() {
    const peer = this.state.peer;
    if (peer && this.state.phase === "incoming") await this.send(peer, { t: "call", op: "reject", cid: this.cid }).catch(() => {});
    this.cleanup(null);
  }

  async hangup(info: string | null = null) {
    const peer = this.state.peer;
    if (peer && this.state.phase !== "idle") await this.send(peer, { t: "call", op: "end", cid: this.cid }).catch(() => {});
    this.cleanup(info);
  }

  private async renegotiate(sdp: string) {
    const pc = this.pc!;
    if (this.makingOffer && this.caller) return; // colisão: quem ligou tem prioridade
    if (pc.signalingState !== "stable") await pc.setLocalDescription({ type: "rollback" } as RTCSessionDescriptionInit).catch(() => {});
    await pc.setRemoteDescription({ type: "offer", sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await gathered(pc);
    await this.send(this.state.peer!, { t: "call", op: "answer", cid: this.cid, sdp: pc.localDescription!.sdp });
  }

  private async offerAgain() {
    const pc = this.pc;
    if (!pc || !this.state.peer) return;
    this.makingOffer = true;
    try {
      await pc.setLocalDescription(await pc.createOffer());
      await gathered(pc);
      await this.send(this.state.peer, { t: "call", op: "offer", cid: this.cid, sdp: pc.localDescription!.sdp, video: this.state.video, reneg: true });
    } finally {
      this.makingOffer = false;
    }
  }

  toggleMic() {
    const on = !this.state.mic;
    this.state.local?.getAudioTracks().forEach((t) => (t.enabled = on));
    this.set({ mic: on });
  }

  async toggleCam() {
    const l = this.state.local;
    if (!l || !this.pc) return;
    const cur = l.getVideoTracks()[0];
    if (cur) {
      cur.enabled = !cur.enabled;
      return this.set({ cam: cur.enabled });
    }
    const v = (await this.media(true)).getVideoTracks()[0];
    l.addTrack(v);
    this.pc.addTrack(v, l);
    this.set({ cam: true, video: true });
    await this.offerAgain();
  }

  /** Alterna entre câmera frontal e traseira sem renegociar a chamada. */
  async switchCamera() {
    const l = this.state.local;
    const cur = l?.getVideoTracks()[0];
    if (!l || !cur || !this.pc) return;
    const next = this.facing === "user" ? "environment" : "user";
    let st: MediaStream;
    try {
      st = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: next }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    } catch {
      throw new Error("Não foi possível trocar de câmera");
    }
    const nv = st.getVideoTracks()[0];
    const sender = this.pc.getSenders().find((x) => x.track === cur);
    if (sender) await sender.replaceTrack(nv);
    nv.enabled = cur.enabled;
    cur.stop();
    l.removeTrack(cur);
    l.addTrack(nv);
    this.facing = next;
    this.set({ local: new MediaStream(l.getTracks()) });
  }

  async shareScreen() {
    if (this.state.phase !== "connected" || !this.pc) return;
    if (this.state.sharing) return this.stopShare();
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Este navegador não permite compartilhar a tela. Use o computador (Chrome, Edge ou Firefox) ou o app Android.");
    let st: MediaStream;
    try {
      st = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false });
    } catch {
      return; // usuário cancelou
    }
    this.screenStream = st;
    this.screenSender = this.pc.addTrack(st.getVideoTracks()[0], st);
    st.getVideoTracks()[0].addEventListener("ended", () => void this.stopShare());
    this.set({ sharing: true });
    await this.offerAgain();
  }

  async stopShare() {
    if (!this.state.sharing) return;
    this.screenStream?.getTracks().forEach((t) => t.stop());
    if (this.screenSender && this.pc && this.pc.signalingState !== "closed") this.pc.removeTrack(this.screenSender);
    this.screenSender = null;
    this.screenStream = null;
    this.set({ sharing: false });
    await this.offerAgain().catch(() => {});
  }

  private cleanup(info: string | null) {
    clearTimeout(this.timer);
    this.state.local?.getTracks().forEach((t) => t.stop());
    this.screenStream?.getTracks().forEach((t) => t.stop());
    try { this.pc?.close(); } catch { /* */ }
    this.pc = null; this.pending = null; this.screenSender = null; this.screenStream = null; this.mainId = null; this.makingOffer = false; this.facing = "user";
    this.set({ ...IDLE, info });
  }
}
