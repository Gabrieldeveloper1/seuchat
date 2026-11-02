import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import sodium from "libsodium-wrappers-sumo";
import { ApiError, SUPABASE_ANON, SUPABASE_URL, login, register } from "./api";
import { userIdFromIdKey, type Keys } from "./crypto";
import { hexToBytes, fromB64 } from "./util";

export interface RelayRow {
  id: string;
  sender_id: string;
  recipient_id: string;
  ciphertext: string; // bytea em hex
  franking_tag: string;
  server_mac: string;
  sender_sig: string;
  sent_at: number;
}

export interface Session {
  userId: string;
  client: SupabaseClient;
  getJwt(): string;
  /** Faz login de novo (token expira em 1h) e atualiza o canal em tempo real. */
  refresh(): Promise<void>;
  fetchPending(): Promise<RelayRow[]>;
  ack(id: string): Promise<void>;
  subscribe(onRow: (r: RelayRow) => void, onStatus?: (live: boolean) => void): void;
  stop(): void;
}

const isAuthErr = (e: unknown) => {
  const x = e as { message?: string; code?: string; status?: number } | null;
  return !!x && (x.status === 401 || /jwt|token|expired|PGRST30\d|401/i.test(`${x.code ?? ""} ${x.message ?? ""}`));
};

export async function startSession(keys: Keys): Promise<Session> {
  let jwt: string;
  try {
    jwt = await login(keys);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      await register(keys);
      jwt = await login(keys);
    } else throw e;
  }

  const client = createClient(SUPABASE_URL, SUPABASE_ANON, {
    accessToken: async () => jwt,
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 5 } },
  });

  let inflight: Promise<void> | null = null;
  const refresh = () =>
    (inflight ??= (async () => {
      try {
        jwt = await login(keys);
        client.realtime.setAuth(jwt);
      } finally {
        inflight = null;
      }
    })());

  /** Executa; se o token tiver expirado, renova e tenta mais uma vez. */
  async function authed<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (!isAuthErr(e)) throw e;
      await refresh();
      return fn();
    }
  }

  // Renova bem antes de vencer (token de 1h) e quando a aba volta ao primeiro plano.
  const timer = window.setInterval(() => void refresh().catch(() => {}), 40 * 60 * 1000);
  let channel: ReturnType<SupabaseClient["channel"]> | null = null;

  return {
    userId: keys.userId,
    client,
    getJwt: () => jwt,
    refresh,
    fetchPending: () =>
      authed(async () => {
        const { data, error } = await client
          .from("relay_messages")
          .select("*")
          .eq("recipient_id", keys.userId)
          .order("sent_at", { ascending: true })
          .limit(100);
        if (error) throw error;
        return (data ?? []) as RelayRow[];
      }),
    ack: (id: string) =>
      authed(async () => {
        const { error } = await client.from("relay_messages").delete().eq("id", id);
        if (error && isAuthErr(error)) throw error;
      }),
    subscribe(onRow, onStatus) {
      channel = client
        .channel("inbox")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "relay_messages", filter: `recipient_id=eq.${keys.userId}` },
          (p) => onRow(p.new as RelayRow),
        )
        .subscribe((status) => onStatus?.(status === "SUBSCRIBED"));
    },
    stop() {
      clearInterval(timer);
      if (channel) void client.removeChannel(channel);
      void client.removeAllChannels();
    },
  };
}

export interface PeerIdentity {
  idKey: Uint8Array;
  spk: Uint8Array;
}

/** Busca e VALIDA a identidade pública de outro usuário (ID = hash da chave, prekey assinada). */
export async function fetchIdentity(client: SupabaseClient, id: string): Promise<PeerIdentity | null> {
  await sodium.ready;
  const { data, error } = await client.rpc("get_identity", { target_user: id });
  if (error) throw error;
  const r = (data as { identity_key: string; signed_prekey: string; signed_prekey_sig: string }[] | null)?.[0];
  if (!r) return null;
  const idKey = hexToBytes(r.identity_key);
  const spk = hexToBytes(r.signed_prekey);
  const sig = hexToBytes(r.signed_prekey_sig);
  if (userIdFromIdKey(idKey) !== id) return null;
  if (!sodium.crypto_sign_verify_detached(sig, spk, idKey)) return null;
  return { idKey, spk };
}

export { fromB64 };
