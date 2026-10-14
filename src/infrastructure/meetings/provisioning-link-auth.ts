import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Autenticação do canal do navegador temporário de login:
 * - VIEWER: token aleatório entregue só a quem iniciou a conexão; o banco guarda apenas o hash.
 * - API → WORKER: token HMAC curto, ligado à sessão, com chave derivada do segredo mestre
 *   (nunca o segredo em si).
 */

export function newViewerToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashViewerToken(token) };
}

export function hashViewerToken(token: string): string {
  return createHash("sha256").update(`vorix:recorder-provisioning:viewer:${token}`).digest("hex");
}

function linkKey(masterSecret: string): Buffer {
  return createHmac("sha256", masterSecret).update("vorix:recorder-provisioning:link:v1").digest();
}

export function signWorkerLinkToken(masterSecret: string, sessionId: string, now: Date, ttlMs = 60_000): string {
  const exp = now.getTime() + ttlMs;
  const mac = createHmac("sha256", linkKey(masterSecret)).update(`${sessionId}.${exp}`).digest("base64url");
  return `${exp}.${mac}`;
}

export function verifyWorkerLinkToken(masterSecret: string, sessionId: string, token: string | undefined, now: Date): boolean {
  if (!token) return false;
  const [expRaw, mac] = token.split(".");
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || !mac || exp < now.getTime()) return false;
  const expected = createHmac("sha256", linkKey(masterSecret)).update(`${sessionId}.${exp}`).digest();
  const given = Buffer.from(mac, "base64url");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
