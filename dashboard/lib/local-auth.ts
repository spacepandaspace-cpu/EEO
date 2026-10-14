import "server-only";
import { env } from "@/lib/node-runtime";
import { workbenchEnabled, passwordEnabled, getWorkbenchUser, clearWorkbenchSession } from './workbench-auth';
import { ADMIN_JOB_NUMBER, validIdentity } from './identity-policy';

export const SESSION_COOKIE = "ai_risk_session";
const SESSION_HOURS = 0.5;
const PASSWORD_ITERATIONS = 160_000;

export type AuthUser = {
  id: number;
  username: string;
  role: "admin" | "consultant";
  consultantName: string | null;
  jobNumber?: string | null;
  authSource?: 'password' | 'workbench';
};

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function randomToken(byteLength = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64(new Uint8Array(digest));
}

async function derivePasswordHash(password: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const stableSalt = new Uint8Array(new ArrayBuffer(salt.byteLength));
  stableSalt.set(salt);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: stableSalt, iterations: PASSWORD_ITERATIONS }, material, 256);
  return bytesToBase64(new Uint8Array(bits));
}

async function deriveRecoveryKey(adminPassword: string, adminSalt: string) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(adminPassword), "PBKDF2", false, ["deriveKey"]);
  const salt = new Uint8Array([...base64ToBytes(adminSalt), ...new TextEncoder().encode("consultant-password-recovery-v1")]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PASSWORD_ITERATIONS }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function encryptRecoverablePassword(value: string, adminPassword: string, adminSalt: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await deriveRecoveryKey(adminPassword, adminSalt), new TextEncoder().encode(value));
  return { encryptedPassword: bytesToBase64(new Uint8Array(encrypted)), passwordIv: bytesToBase64(iv) };
}

export async function decryptRecoverablePassword(value: string, iv: string, adminPassword: string, adminSalt: string) {
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(iv) }, await deriveRecoveryKey(adminPassword, adminSalt), base64ToBytes(value));
  return new TextDecoder().decode(decrypted);
}

export function generateConsultantPassword(length = 14) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export async function createPasswordRecord(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: bytesToBase64(salt), hash: await derivePasswordHash(password, salt) };
}

export async function verifyPassword(password: string, salt: string, expectedHash: string) {
  const actual = await derivePasswordHash(password, base64ToBytes(salt));
  if (actual.length !== expectedHash.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) difference |= actual.charCodeAt(index) ^ expectedHash.charCodeAt(index);
  return difference === 0;
}

function parseCookie(request: Request, name: string) {
  const cookie = request.headers.get("cookie") ?? "";
  for (const item of cookie.split(";")) {
    const [key, ...value] = item.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

export async function createSession(userId: number) {
  const token = randomToken();
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000).toISOString();
  await env.DB.prepare("INSERT INTO auth_session (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(tokenHash, userId, expiresAt).run();
  return { token, expiresAt };
}

export function sessionCookie(token: string, expiresAt: string) {
  if(workbenchEnabled())return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=${new Date(expiresAt).toUTCString()}`;
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Expires=${new Date(expiresAt).toUTCString()}`;
}

export function expiredSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

export async function clearSession(request: Request) {
  if(workbenchEnabled())await clearWorkbenchSession(request);
  const token = parseCookie(request, SESSION_COOKIE);
  if (!token) return;
  await env.DB.prepare("DELETE FROM auth_session WHERE token_hash = ?").bind(await sha256(token)).run();
}

export async function getAuthenticatedUser(request: Request): Promise<AuthUser | null> {
  if(workbenchEnabled()){
    const user=await getWorkbenchUser(request);
    if(user)return user;
  }
  if(!passwordEnabled())return null;
  const token = parseCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const row = await env.DB.prepare(`
    SELECT u.id, u.username, u.role, u.consultant_name AS consultantName,
           e.job_number AS jobNumber
    FROM auth_session s
    JOIN user_account u ON u.id = s.user_id
    JOIN external_identity e ON e.user_id = u.id AND e.enabled = 1
    WHERE s.token_hash = ? AND s.expires_at > ? AND datetime(s.created_at) > datetime('now','-30 minutes') AND u.enabled = 1
    LIMIT 1
  `).bind(await sha256(token), new Date().toISOString()).first<AuthUser>();
  return row && validIdentity(row) ? {...row,authSource:'password'} : null;
}

export async function requireAdmin(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user || user.role !== "admin" || user.jobNumber !== ADMIN_JOB_NUMBER) return null;
  return user;
}

export async function writeAudit(user: AuthUser, action: string, objectType: string, objectId: string, detail = "") {
  await env.DB.prepare(`
    INSERT INTO audit_log (actor_user_id, actor_name, action, object_type, object_id, detail)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(user.id, user.username, action, objectType, objectId, detail).run();
}
