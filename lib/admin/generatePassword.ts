import { randomBytes } from "node:crypto";

/**
 * Gera senha provisoria alfanumerica criptograficamente segura.
 *
 * Uso: bootstrap de usuario novo (POST /api/admin/usuarios) ou reset
 * (POST /api/admin/usuarios/[id]/reset-password). A senha gerada eh
 * exibida UMA VEZ ao socio na UI e nunca persistida em texto claro pelo
 * Sistema RR — o Supabase Auth armazena apenas o hash em auth.users.
 *
 * Servidor-only (depende de node:crypto). NAO importar em codigo client.
 *
 * @param length numero de caracteres (default 16; ~95 bits de entropia
 *               com alfabeto de 62 chars, mais que suficiente).
 */
export function generateProvisionalPassword(length = 16): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}
