// Chamadas de voz/vídeo e compartilhamento de tela (WebRTC). A sinalização (SDP) viaja DENTRO das
// mensagens seladas e assinadas do relay; o fingerprint DTLS fica autenticado de ponta a ponta.
export type CallPhase = "idle" | "incoming" | "calling" | "connected";

export interface CallState {
  phase: CallPhase;
  peer: string | null;
  groupId: string | null;
  participants: GroupCallParticipant[];
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

export interface GroupCallParticipant {
  id: string;
  stream: MediaStream | null;
  status: "calling" | "connected";
}

/** Navegadores de celular (Chrome/Safari mobile) não expõem getDisplayMedia; no computador sim. */
export const screenShareSupported = () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;

export const IDLE: CallState = { phase: "idle", peer: null, groupId: null, participants: [], video: false, mic: true, cam: false, sharing: false, local: null, remote: null, remoteScreen: null, startedAt: null, info: null };

interface Sig { t: "call"; op: "offer" | "answer" | "end" | "reject" | "join"; cid: string; gid?: string; sdp?: string; video?: boolean; reneg?: boolean; reason?: string }

const turnUrl = import.meta.env.VITE_TURN_URL as string | undefined;
export const turnConfigured = import.meta.env.VITE_TURN_ENABLED === "true" || (!!turnUrl && !!import.meta.env.VITE_TURN_USER && !!import.meta.env.VITE_TURN_PASS);

function staticTurnServer(): RTCIceServer | null {
  if (!turnUrl) return null;
  return { urls: turnUrl, username: import.meta.env.VITE_TURN_USER as string, credential: import.meta.env.VITE_TURN_PASS as string };
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
  private groupPcs = new Map<string, RTCPeerConnection>();
  private groupCid = "";
  private groupMembers: string[] = [];
  private groupActivePeers = new Set<string>();
  private groupPending: { from: string; gid: string; cid: string; sdp: string; video: boolean } | null = null;
  private groupScreens = new Map<string, RTCRtpSender>();
  private groupLocal: MediaStream | null = null;
  private turnCache: { servers: RTCIceServer[]; expiresAt: number } | null = null;

  constructor(
    private send: (peer: string, sig: Sig) => Promise<void>,
    private onChange: (s: CallState) => void,
    private relayOnly: () => boolean,
    private getTurnServers: () => Promise<RTCIceServer[]>,
    private getGroupMembers: (gid: string) => string[],
    private getMyId: () => string | null,
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

  private async getCachedTurnServers(): Promise<RTCIceServer[]> {
    if (this.turnCache && this.turnCache.expiresAt > Date.now()) return this.turnCache.servers;
    const servers = await this.getTurnServers();
    this.turnCache = { servers, expiresAt: Date.now() + 50 * 60_000 };
    return servers;
  }

  private async newPeerConnection() {
    const relayOnly = this.relayOnly();
    let turnServers: RTCIceServer[] = [];
    if (turnConfigured) {
      try { turnServers = await this.getCachedTurnServers(); } catch (e) {
        const staticServer = staticTurnServer();
        if (staticServer) turnServers = [staticServer];
        else if (relayOnly) throw new Error(e instanceof Error ? e.message : "Servidor TURN indisponível.");
      }
    } else if (staticTurnServer()) turnServers = [staticTurnServer()!];
    if (relayOnly && (!turnServers.length || turnServers.some((s) => !String(s.urls).toLowerCase().startsWith("turn")))) {
      throw new Error("TURN não configurado. A chamada foi bloqueada para não expor seu IP.");
    }
    const servers: RTCIceServer[] = relayOnly
      ? turnServers
      : [{ urls: (import.meta.env.VITE_STUN_URL as string) || "stun:stun.l.google.com:19302" }, ...turnServers];
    return new RTCPeerConnection({ iceServers: servers, iceTransportPolicy: relayOnly ? "relay" : "all" });
  }

  private async makePc() {
    const pc = await this.newPeerConnection();
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
    const pc = await this.makePc();
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

  async startGroup(gid: string, members: string[], video: boolean) {
    if (this.state.phase !== "idle") throw new Error("Você já está em uma chamada");
    const me = this.getMyId();
    const peers = [...new Set(members)].filter((id) => id !== me);
    if (!me || !peers.length) throw new Error("O grupo não tem outros membros para chamar");
    if (peers.length > 4) throw new Error("Chamadas em grupo suportam até 5 participantes nesta versão");
    const local = await this.media(video);
    this.groupCid = crypto.randomUUID();
    this.cid = this.groupCid;
    this.groupMembers = [...peers, me];
    this.groupActivePeers = new Set([me]);
    this.groupLocal = local;
    this.set({
      ...IDLE, phase: "calling", peer: `g:${gid}`, groupId: gid, video, cam: video,
      local, participants: peers.map((id) => ({ id, stream: null, status: "calling" })),
    });
    try {
      const results = await Promise.allSettled(peers.map((id) => this.offerGroupPeer(id)));
      if (results.every((r) => r.status === "rejected")) throw new Error("Não foi possível chamar os membros do grupo");
    } catch (e) {
      this.cleanup("Não foi possível iniciar a chamada em grupo");
      throw e;
    }
    this.timer = window.setTimeout(() => {
      if (this.state.phase === "calling") void this.hangup("Sem resposta");
    }, 45_000);
  }

  private async makeGroupPc(peer: string): Promise<RTCPeerConnection> {
    const existing = this.groupPcs.get(peer);
    if (existing) return existing;
    const pc = await this.newPeerConnection();
    this.groupPcs.set(peer, pc);
    this.groupLocal?.getTracks().forEach((track) => pc.addTrack(track, this.groupLocal!));
    pc.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      const participants = this.state.participants.map((p) => p.id === peer ? { ...p, stream } : p);
      if (!participants.some((p) => p.id === peer)) participants.push({ id: peer, stream, status: "calling" });
      this.set({ participants });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        clearTimeout(this.timer);
        const participants = this.state.participants.map((p) => p.id === peer ? { ...p, status: "connected" as const } : p);
        if (!participants.some((p) => p.id === peer)) participants.push({ id: peer, stream: null, status: "connected" });
        this.set({ phase: "connected", startedAt: this.state.startedAt ?? Date.now(), participants });
      } else if (pc.connectionState === "failed" || pc.connectionState === "closed") this.removeGroupPeer(peer);
    };
    return pc;
  }

  private async offerGroupPeer(peer: string) {
    if (!this.groupLocal || this.groupPcs.has(peer)) return;
    const pc = await this.makeGroupPc(peer);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await gathered(pc);
    await this.send(peer, { t: "call", op: "offer", gid: this.state.groupId!, cid: this.groupCid, sdp: pc.localDescription?.sdp, video: this.state.video });
  }

  private async answerGroupOffer(from: string, gid: string, cid: string, sdp: string) {
    if (!this.groupLocal || this.state.groupId !== gid || this.groupCid !== cid) return;
    const pc = await this.makeGroupPc(from);
    if (pc.signalingState !== "stable") return;
    await pc.setRemoteDescription({ type: "offer", sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await gathered(pc);
    await this.send(from, { t: "call", op: "answer", gid, cid, sdp: pc.localDescription?.sdp });
  }

  private async joinGroupCall() {
    const gid = this.state.groupId;
    const me = this.getMyId();
    if (!gid || !me) return;
    this.groupActivePeers.add(me);
    this.groupMembers = this.getGroupMembers(gid);
    await Promise.allSettled(this.groupMembers.filter((id) => id !== me).map((id) =>
      this.send(id, { t: "call", op: "join", gid, cid: this.groupCid }),
    ));
    await Promise.allSettled([...this.groupActivePeers].filter((id) => id !== me && me < id).map((id) => this.offerGroupPeer(id)));
  }

  private removeGroupPeer(peer: string) {
    const pc = this.groupPcs.get(peer);
    this.groupPcs.delete(peer);
    this.groupActivePeers.delete(peer);
    if (pc) {
      pc.onconnectionstatechange = null;
      try { pc.close(); } catch { /* */ }
    }
    this.groupScreens.delete(peer);
    const participants = this.state.participants.filter((p) => p.id !== peer);
    this.set({ participants });
    if (this.state.phase === "connected" && !participants.length) {
      this.cleanup("A chamada em grupo terminou");
    }
  }

  private async handleGroup(from: string, p: Sig, sentAt: number) {
    const gid = p.gid!;
    if (p.op === "offer" && p.sdp) {
      if (this.state.groupId !== gid || this.groupCid !== p.cid) {
        if (this.state.phase !== "idle") {
          void this.send(from, { t: "call", op: "reject", gid, cid: p.cid, reason: "busy" }).catch(() => {});
          return;
        }
        if (Date.now() - sentAt > 60_000) return;
        this.groupCid = p.cid;
        this.cid = p.cid;
        this.groupMembers = this.getGroupMembers(gid);
        this.groupActivePeers = new Set([from]);
        this.groupPending = { from, gid, cid: p.cid, sdp: p.sdp, video: !!p.video };
        this.set({
          ...IDLE, phase: "incoming", peer: `g:${gid}`, groupId: gid, video: !!p.video,
          participants: [{ id: from, stream: null, status: "calling" }],
        });
        this.timer = window.setTimeout(() => void this.reject(), 45_000);
        return;
      }
      // Once accepted, add the caller or another active participant automatically.
      if (this.groupLocal) await this.answerGroupOffer(from, gid, p.cid, p.sdp);
      return;
    }
    if (this.state.groupId !== gid || this.groupCid !== p.cid) return;
    if (p.op === "answer" && p.sdp) {
      const pc = this.groupPcs.get(from);
      if (pc && pc.signalingState === "have-local-offer") await pc.setRemoteDescription({ type: "answer", sdp: p.sdp }).catch(() => {});
    } else if (p.op === "join") {
      this.groupActivePeers.add(from);
      const me = this.getMyId();
      if (this.groupLocal && me && me < from && !this.groupPcs.has(from)) {
        await this.offerGroupPeer(from).catch(() => {});
      }
    } else if (p.op === "reject" || p.op === "end") this.removeGroupPeer(from);
  }

  /** Chamado pelo store ao receber um sinal de um contato aceito. */
  async handle(from: string, p: Sig, sentAt: number) {
    if (p.gid) return this.handleGroup(from, p, sentAt);
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
    if (this.groupPending) {
      const pend = this.groupPending;
      clearTimeout(this.timer);
      try {
        this.groupLocal = await this.media(pend.video);
        this.groupCid = pend.cid;
        this.cid = pend.cid;
        this.groupMembers = this.getGroupMembers(pend.gid);
        this.set({
          ...this.state, phase: "calling", video: pend.video, cam: pend.video, local: this.groupLocal,
          participants: [{ id: pend.from, stream: null, status: "calling" }],
        });
        await this.answerGroupOffer(pend.from, pend.gid, pend.cid, pend.sdp);
        this.groupPending = null;
        await this.joinGroupCall();
      } catch (e) {
        void this.send(pend.from, { t: "call", op: "reject", gid: pend.gid, cid: pend.cid }).catch(() => {});
        this.cleanup(null);
        throw e;
      }
      return;
    }
    const pend = this.pending;
    const peer = this.state.peer;
    if (!pend || !peer || this.state.phase !== "incoming") return;
    clearTimeout(this.timer);
    try {
      const local = await this.media(pend.video);
      const pc = await this.makePc();
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
    if (this.groupPending) {
      const pend = this.groupPending;
      await this.send(pend.from, { t: "call", op: "reject", gid: pend.gid, cid: pend.cid }).catch(() => {});
      this.cleanup(null);
      return;
    }
    const peer = this.state.peer;
    if (peer && this.state.phase === "incoming") await this.send(peer, { t: "call", op: "reject", cid: this.cid }).catch(() => {});
    this.cleanup(null);
  }

  async hangup(info: string | null = null) {
    if (this.state.groupId) {
      const gid = this.state.groupId;
      const cid = this.groupCid;
      const me = this.getMyId();
      const peers = [...new Set([...this.groupMembers, ...this.groupPcs.keys(), ...this.state.participants.map((p) => p.id)])].filter((id) => id !== me);
      await Promise.allSettled(peers.map((peer) => this.send(peer, { t: "call", op: "end", gid, cid })));
      this.cleanup(info);
      return;
    }
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

  private async offerGroupAgain(peer: string) {
    const pc = this.groupPcs.get(peer);
    if (!pc || pc.signalingState !== "stable" || !this.state.groupId) return;
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    await this.send(peer, { t: "call", op: "offer", gid: this.state.groupId, cid: this.groupCid, sdp: pc.localDescription?.sdp, video: this.state.video, reneg: true });
  }

  toggleMic() {
    const on = !this.state.mic;
    this.state.local?.getAudioTracks().forEach((t) => (t.enabled = on));
    this.set({ mic: on });
  }

  async toggleCam() {
    const l = this.state.local;
    if (!l || (!this.pc && !this.groupPcs.size)) return;
    const cur = l.getVideoTracks()[0];
    if (cur) {
      cur.enabled = !cur.enabled;
      return this.set({ cam: cur.enabled });
    }
    const extra = await this.media(true);
    const v = extra.getVideoTracks()[0];
    extra.getAudioTracks().forEach((t) => t.stop());
    l.addTrack(v);
    if (this.pc) this.pc.addTrack(v, l);
    for (const [peer, pc] of this.groupPcs) pc.addTrack(v, l);
    this.set({ cam: true, video: true });
    if (this.pc) await this.offerAgain();
    else await Promise.all([...this.groupPcs.keys()].map((peer) => this.offerGroupAgain(peer)));
  }

  /** Alterna entre câmera frontal e traseira sem renegociar a chamada. */
  async switchCamera() {
    const l = this.state.local;
    const cur = l?.getVideoTracks()[0];
    if (!l || !cur || (!this.pc && !this.groupPcs.size)) return;
    const next = this.facing === "user" ? "environment" : "user";
    let st: MediaStream;
    try {
      st = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: next }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    } catch {
      throw new Error("Não foi possível trocar de câmera");
    }
    const nv = st.getVideoTracks()[0];
    const senders = [
      ...(this.pc ? [this.pc] : []),
      ...this.groupPcs.values(),
    ].map((pc) => pc.getSenders().find((x) => x.track === cur)).filter((s): s is RTCRtpSender => !!s);
    await Promise.all(senders.map((sender) => sender.replaceTrack(nv)));
    nv.enabled = cur.enabled;
    cur.stop();
    l.removeTrack(cur);
    l.addTrack(nv);
    this.facing = next;
    this.set({ local: new MediaStream(l.getTracks()) });
  }

  async shareScreen() {
    if (this.state.phase !== "connected" || (!this.pc && !this.groupPcs.size)) return;
    if (this.state.sharing) return this.stopShare();
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Este navegador não permite compartilhar a tela. Use o computador (Chrome, Edge ou Firefox) ou o app Android.");
    let st: MediaStream;
    try {
      st = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false });
    } catch {
      return; // usuário cancelou
    }
    this.screenStream = st;
    if (this.pc) this.screenSender = this.pc.addTrack(st.getVideoTracks()[0], st);
    for (const [peer, pc] of this.groupPcs) this.groupScreens.set(peer, pc.addTrack(st.getVideoTracks()[0], st));
    st.getVideoTracks()[0].addEventListener("ended", () => void this.stopShare());
    this.set({ sharing: true });
    if (this.pc) await this.offerAgain();
    else await Promise.all([...this.groupPcs.keys()].map((peer) => this.offerGroupAgain(peer)));
  }

  async stopShare() {
    if (!this.state.sharing) return;
    this.screenStream?.getTracks().forEach((t) => t.stop());
    if (this.screenSender && this.pc && this.pc.signalingState !== "closed") this.pc.removeTrack(this.screenSender);
    this.screenSender = null;
    for (const [peer, sender] of this.groupScreens) {
      const pc = this.groupPcs.get(peer);
      if (pc && pc.signalingState !== "closed") pc.removeTrack(sender);
    }
    const groupPeers = [...this.groupScreens.keys()];
    this.groupScreens.clear();
    this.screenStream = null;
    this.set({ sharing: false });
    if (this.pc) await this.offerAgain().catch(() => {});
    else await Promise.all(groupPeers.map((peer) => this.offerGroupAgain(peer).catch(() => {})));
  }

  private cleanup(info: string | null) {
    clearTimeout(this.timer);
    this.state.local?.getTracks().forEach((t) => t.stop());
    this.screenStream?.getTracks().forEach((t) => t.stop());
    const direct = this.pc;
    this.pc = null;
    if (direct) {
      direct.onconnectionstatechange = null;
      try { direct.close(); } catch { /* */ }
    }
    this.groupPcs.forEach((pc) => {
      pc.onconnectionstatechange = null;
      try { pc.close(); } catch { /* */ }
    });
    this.groupPcs.clear();
    this.groupScreens.clear();
    this.groupLocal = null;
    this.groupMembers = [];
    this.groupActivePeers.clear();
    this.groupPending = null;
    this.groupCid = "";
    this.pending = null; this.screenSender = null; this.screenStream = null; this.mainId = null; this.makingOffer = false; this.facing = "user";
    this.set({ ...IDLE, info });
  }
}
