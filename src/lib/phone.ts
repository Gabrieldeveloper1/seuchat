/** Normaliza para E.164. Sem "+", assume Brasil (+55). Retorna null se inválido. */
export function normalizePhone(raw: string): string | null {
  const t = raw.trim();
  let d = t.replace(/\D/g, "");
  if (!d) return null;
  if (t.startsWith("+")) return /^[1-9]\d{7,14}$/.test(d) ? `+${d}` : null;
  if (d.startsWith("00")) d = d.slice(2);
  else {
    d = d.replace(/^0+/, ""); // prefixo de tronco (ex.: 021 99999-0000)
    if (d.length <= 11) d = `55${d}`; // DDD + número
  }
  return /^[1-9]\d{7,14}$/.test(d) ? `+${d}` : null;
}

export function formatPhone(e164: string): string {
  const m = /^\+55(\d{2})(9?\d{4})(\d{4})$/.exec(e164);
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : e164;
}

/** Número interno, sem telefone/SMS: 9 dígitos exibidos como 10259-5251. */
export function normalizeAppNumber(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (!/^[1-9]\d{8}$/.test(digits)) return null;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

export function formatAppNumber(value?: string): string {
  if (!value) return "";
  return normalizeAppNumber(value) ?? value;
}
