import type { Msg } from "../types";
export const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;
export interface ReactionEvent { peer: string; id: string; author: string; actor: string; emoji: string; ts: number }
export function applyReaction(m: Msg, e: ReactionEvent): Msg {
  if (m.peer !== e.peer || m.id !== e.id || (m.from ?? m.peer) !== e.author) return m;
  if ((m.reactions?.[e.actor]?.ts ?? -1) > e.ts) return m;
  return { ...m, reactions: { ...m.reactions, [e.actor]: { emoji: e.emoji, ts: e.ts } } };
}
