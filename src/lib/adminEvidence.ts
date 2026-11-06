import sodium from 'libsodium-wrappers-sumo';
import { dec, hexToBytes } from './util';

/** A chave privada nunca sai do aparelho; o servidor fornece apenas dados cifrados. */
export async function decryptAdminEvidence(value: string, secret: Uint8Array): Promise<string> {
  await sodium.ready;
  const buf = hexToBytes(value);
  if (secret.length !== 32 || buf.length < 72) throw new Error('Evidência inválida.');
  return dec.decode(sodium.crypto_box_open_easy(buf.slice(56), buf.slice(32, 56), buf.slice(0, 32), secret));
}
