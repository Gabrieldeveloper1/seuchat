// Chamadas de voz/vídeo com sinalização cifrada pelo relay. A versão de grupo usa uma conexão
// WebRTC independente por participante (malha), mantendo áudio/vídeo de ponta a ponta.
export type CallPhase = "idle" | "incoming" | "calling" | "connected";

export interface CallParticipant { id: string; stream: MediaStream | null; connected: boolean; }
export interface CallState {
  phase: CallPhase;
  peer: string | null;
  groupId: string | null;
  groupName: string | null;
  video: boolean;
  mic: boolean;
  cam: boolean;
  sharing: boolean;
  local: MediaStream | null;
  remote: MediaStream | null;
  remoteScreen: MediaStream | null;
  remotes: Record<string, MediaStream>;
  participants: string[];
  startedAt: number | null;
  info: string | null;
}

export const screenShareSupported = () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;
export const IDLE: CallState = { phase: "idle", peer: null, groupId: null, groupName: null, video: false, mic: true, cam: false, sharing: false, local: null, remote: null, remoteScreen: null, remotes: {}, participants: [], startedAt: null, info: null };

interface Sig { t: "call"; op: "offer" | "answer" | "end" | "reject"; cid: string; gid?: string; members?: string[]; sdp?: string; video?: boolean; reneg?: boolean; reason?: string }
const turnUrl = import.meta.env.VITE_TURN_URL as string | undefined;
export const turnConfigured = !!turnUrl;
function iceConfig(relayOnly: boolean): RTCConfiguration {
  const servers: RTCIceServer[] = [{ urls: (import.meta.env.VITE_STUN_URL as string) || "stun:stun.l.google.com:19302" }];
  if (turnUrl) servers.push({ urls: turnUrl, username: import.meta.env.VITE_TURN_USER as string, credential: import.meta.env.VITE_TURN_PASS as string });
  return { iceServers: servers, iceTransportPolicy: relayOnly && turnUrl ? "relay" : "all" };
}
function gathered(pc: RTCPeerConnection, ms = 4000): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((res) => { const done = () => { pc.removeEventListener("icegatheringstatechange", chk); clearTimeout(t); res(); }; const chk = () => pc.iceGatheringState === "complete" && done(); const t = setTimeout(done, ms); pc.addEventListener("icegatheringstatechange", chk); });
}

export class CallEngine {
  state: CallState = IDLE;
  private pcs = new Map<string, RTCPeerConnection>();
  private pending = new Map<string, { sdp: string; video: boolean; cid: string; gid?: string; members?: string[] }>();
  private cids = new Map<string, string>();
  private timer: number | undefined;
  private localStream: MediaStream | null = null;
  private groupMembers: string[] = [];
  private screenSender: RTCRtpSender | null = null;
  private screenStream: MediaStream | null = null;
  private facing: "user" | "environment" = "user";

  constructor(private send: (peer: string, sig: Sig) => Promise<void>, private onChange: (s: CallState) => void, private relayOnly: () => boolean) {}
  private set(p: Partial<CallState>) { this.state = { ...this.state, ...p }; this.onChange(this.state); }
  private async media(video: boolean): Promise<MediaStream> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Chamadas não são suportadas neste navegador (use HTTPS)");
    try { return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: video ? { facingMode: this.facing, width: { ideal: 1280 }, height: { ideal: 720 } } : false }); }
    catch { throw new Error(video ? "Permita câmera e microfone para chamar" : "Permita o uso do microfone para chamar"); }
  }
  private makePc(peer: string) {
    const pc = new RTCPeerConnection(iceConfig(this.relayOnly()));
    pc.ontrack = (e) => { const st = e.streams[0]; if (!st) return; this.set({ remote: this.state.remote ?? st, remotes: { ...this.state.remotes, [peer]: st } }); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") this.set({ phase: "connected", startedAt: this.state.startedAt ?? Date.now(), participants: [...new Set([...this.state.participants, peer])] });
      if (pc.connectionState === "failed" || pc.connectionState === "closed") { this.pcs.delete(peer); const remotes = { ...this.state.remotes }; delete remotes[peer]; this.set({ remotes, participants: this.state.participants.filter((x) => x !== peer) }); if (!this.pcs.size && this.state.phase !== "idle") this.cleanup("A conexão da chamada caiu"); }
    };
    this.pcs.set(peer, pc); return pc;
  }
  private async offer(peer: string, video: boolean, gid?: string, members?: string[]) {
    const pc = this.makePc(peer); this.cids.set(peer, crypto.randomUUID());
    this.localStream?.getTracks().forEach((t) => pc.addTrack(t, this.localStream!));
    await pc.setLocalDescription(await pc.createOffer()); await gathered(pc);
    await this.send(peer, { t: "call", op: "offer", cid: this.cids.get(peer)!, gid, members, sdp: pc.localDescription!.sdp, video });
  }
  async start(peer: string, video: boolean, group?: { id: string; name: string; members: string[] }) {
    if (this.state.phase !== "idle") throw new Error("Você já está em uma chamada");
    this.localStream = await this.media(video); this.groupMembers = group?.members ?? [peer];
    this.set({ ...IDLE, phase: "calling", peer: group ? null : peer, groupId: group?.id ?? null, groupName: group?.name ?? null, video, cam: video, local: this.localStream, participants: group?.members ?? [peer] });
    try { await Promise.all(this.groupMembers.map((id) => this.offer(id, video, group?.id, group?.members))); }
    catch (e) { this.cleanup("Não foi possível iniciar a chamada"); throw e; }
    this.timer = window.setTimeout(() => void this.hangup("Sem resposta"), 45_000);
  }
  async handle(from: string, p: Sig, sentAt: number) {
    if (p.op === "offer" && p.sdp) {
      if (Date.now() - sentAt > 60_000) return;
      const groupIncoming = !!p.gid;
      if (this.state.phase === "idle") { this.pending.set(from, { sdp: p.sdp, video: !!p.video, cid: p.cid, gid: p.gid, members: p.members }); this.groupMembers = p.members ?? [from]; this.set({ ...IDLE, phase: "incoming", peer: groupIncoming ? null : from, groupId: p.gid ?? null, participants: p.members ?? [from], video: !!p.video }); this.timer = window.setTimeout(() => void this.reject(), 45_000); return; }
      if (this.state.groupId === p.gid && !this.pcs.has(from)) { this.pending.set(from, { sdp: p.sdp, video: !!p.video, cid: p.cid, gid: p.gid, members: p.members }); await this.acceptPeer(from); }
      return;
    }
    const cid = this.cids.get(from);
    if (!cid || p.cid !== cid) return;
    if (p.op === "answer" && p.sdp) await this.pcs.get(from)?.setRemoteDescription({ type: "answer", sdp: p.sdp }).catch(() => {});
    else if (p.op === "end" || p.op === "reject") { this.pcs.get(from)?.close(); this.pcs.delete(from); if (!this.pcs.size) this.cleanup(p.reason === "busy" ? "Contato ocupado" : "Chamada encerrada"); }
  }
  private async acceptPeer(peer: string) {
    const pend = this.pending.get(peer); if (!pend || !this.localStream) return;
    const pc = this.makePc(peer); this.cids.set(peer, pend.cid); await pc.setRemoteDescription({ type: "offer", sdp: pend.sdp }); this.localStream.getTracks().forEach((t) => pc.addTrack(t, this.localStream!)); await pc.setLocalDescription(await pc.createAnswer()); await gathered(pc);
    await this.send(peer, { t: "call", op: "answer", cid: pend.cid, gid: pend.gid, sdp: pc.localDescription!.sdp }); this.pending.delete(peer); this.set({ phase: "connected", startedAt: this.state.startedAt ?? Date.now(), local: this.localStream, cam: pend.video });
  }
  async accept() {
    if (this.state.phase !== "incoming") return;
    clearTimeout(this.timer);
    try { this.localStream = await this.media(this.state.video); const peers = [...this.pending.keys()]; for (const peer of peers) await this.acceptPeer(peer); this.set({ local: this.localStream, phase: "connected", startedAt: Date.now(), cam: this.state.video }); }
    catch (e) { await this.reject(); throw e; }
  }
  async reject() { for (const [peer, pend] of this.pending) await this.send(peer, { t: "call", op: "reject", cid: pend.cid, gid: pend.gid }).catch(() => {}); this.cleanup(null); }
  async hangup(info: string | null = null) { for (const [peer, cid] of this.cids) await this.send(peer, { t: "call", op: "end", cid, gid: this.state.groupId ?? undefined }).catch(() => {}); this.cleanup(info); }
  toggleMic() { const on = !this.state.mic; this.localStream?.getAudioTracks().forEach((t) => (t.enabled = on)); this.set({ mic: on }); }
  async toggleCam() { const l = this.localStream; if (!l) return; const cur = l.getVideoTracks()[0]; if (cur) { cur.enabled = !cur.enabled; return this.set({ cam: cur.enabled }); } const v = (await this.media(true)).getVideoTracks()[0]; l.addTrack(v); for (const pc of this.pcs.values()) pc.addTrack(v, l); this.set({ cam: true, video: true }); }
  async switchCamera() { const l = this.localStream, cur = l?.getVideoTracks()[0]; if (!l || !cur) return; const next = this.facing === "user" ? "environment" : "user"; let st: MediaStream; try { st = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: next } }, audio: false }); } catch { throw new Error("Não foi possível trocar de câmera"); } const nv = st.getVideoTracks()[0]; for (const pc of this.pcs.values()) { const sender = pc.getSenders().find((x) => x.track === cur); if (sender) await sender.replaceTrack(nv); } nv.enabled = cur.enabled; cur.stop(); l.removeTrack(cur); l.addTrack(nv); this.facing = next; this.set({ local: new MediaStream(l.getTracks()) }); }
  async shareScreen() { if (this.state.phase !== "connected") return; if (this.state.sharing) return this.stopShare(); let st: MediaStream; try { st = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false }); } catch { return; } this.screenStream = st; for (const pc of this.pcs.values()) this.screenSender = pc.addTrack(st.getVideoTracks()[0], st); st.getVideoTracks()[0].addEventListener("ended", () => void this.stopShare()); this.set({ sharing: true }); }
  async stopShare() { this.screenStream?.getTracks().forEach((t) => t.stop()); this.screenSender = null; this.screenStream = null; this.set({ sharing: false }); }
  private cleanup(info: string | null) { clearTimeout(this.timer); this.localStream?.getTracks().forEach((t) => t.stop()); this.screenStream?.getTracks().forEach((t) => t.stop()); for (const pc of this.pcs.values()) pc.close(); this.pcs.clear(); this.pending.clear(); this.cids.clear(); this.localStream = null; this.groupMembers = []; this.set({ ...IDLE, info }); }
}
