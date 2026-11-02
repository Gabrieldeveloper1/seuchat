export interface Contact {
  id: string;
  alias: string;
  idKey: string; // Ed25519 pública (base64)
  spk: string; // X25519 pública (base64)
  name?: string; // nome que o próprio contato escolheu
  phone?: string; // E.164, salvo só neste aparelho
  blocked?: boolean;
  requested?: boolean; // contato desconhecido que escreveu primeiro
  ttl: number; // segundos após a leitura (0 = não apagar)
  addedAt: number;
  avatar?: string;
  banner?: string;
  profSent?: boolean; // já enviamos nosso perfil a este contato
}

export interface Group {
  id: string;
  name: string;
  owner: string;
  members: string[]; // IDs, inclui o nosso
  ttl: number;
  addedAt: number;
  requested?: boolean;
}

export interface FrankInfo {
  key: string;
  tag: string;
  sig: string;
  mac: string;
  sentAt: number;
  payload: string;
}

export interface Msg {
  id: string;
  peer: string;
  dir: "in" | "out";
  kind: "text" | "image" | "audio";
  text?: string;
  image?: string; // data:image/jpeg;base64,...
  audio?: string; // data:audio/...;base64,...
  dur?: number; // segundos
  from?: string; // remetente (em grupos)
  ts: number;
  ttl: number;
  readAt?: number;
  expiresAt?: number;
  frank?: FrankInfo;
  reported?: boolean;
  pending?: boolean; // envio otimista ainda aguardando confirmação do relay
  reply?: { id: string; text: string };
}

export interface Settings {
  autolockMin: number; // 0 = nunca
  theme: "auto" | "light" | "dark";
  backupDone: boolean;
  callRelayOnly?: boolean;
  /** Exibe o aviso de migração apenas para contas antigas sem número vinculado. */
  phoneMigrationRequired?: boolean;
}

export interface Profile {
  name: string;
  phone?: string;
  phoneVerified?: boolean;
  avatar?: string;
  banner?: string;
}

export interface LocalState {
  v: 1;
  mnemonic: string;
  profile: Profile;
  contacts: Contact[];
  groups: Group[];
  messages: Msg[];
  settings: Settings;
}

export const TTL_OPTIONS: { label: string; value: number }[] = [
  { label: "Desligado", value: 0 },
  { label: "5 segundos", value: 5 },
  { label: "30 segundos", value: 30 },
  { label: "5 minutos", value: 300 },
  { label: "1 hora", value: 3600 },
  { label: "1 dia", value: 86400 },
  { label: "7 dias", value: 604800 },
];
