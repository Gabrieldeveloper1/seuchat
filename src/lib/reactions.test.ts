import { describe, expect, it } from "vitest";
import { applyReaction, type ReactionEvent } from "./reactions";
import type { Msg } from "../types";
const msg: Msg = { id:"a", peer:"g:group", from:"author", dir:"in", kind:"text", ts:1, ttl:0 };
const e: ReactionEvent = {id:"a", peer:"g:group", author:"author", actor:"bob", emoji:"👍", ts:10};
describe("encrypted reaction state", () => {
  it("scopes reactions by conversation, message and author", () => {
    expect(applyReaction(msg,{...e,author:"other"})).toBe(msg);
    expect(applyReaction(msg,{...e,peer:"g:other"})).toBe(msg);
    expect(applyReaction(msg,{...e,id:"other"})).toBe(msg);
    expect(applyReaction(msg,e).reactions?.bob.emoji).toBe("👍");
  });
  it("keeps latest per actor and respects removals", () => {
    const a = applyReaction(msg,e); const b = applyReaction(a,{...e,emoji:"",ts:20});
    expect(applyReaction(b,{...e,emoji:"😂",ts:15}).reactions?.bob.emoji).toBe("");
    expect(applyReaction(b,{...e,actor:"ana",emoji:"❤️",ts:21}).reactions?.ana.emoji).toBe("❤️");
  });
});
