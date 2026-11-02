/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_BLOCKLIST_PUBKEY?: string;
  readonly VITE_REQUIRE_BLOCKLIST?: string;
  readonly VITE_CONTACT_EMAIL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
