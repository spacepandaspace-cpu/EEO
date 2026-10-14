import 'server-only';
import { env } from '@/lib/node-runtime';
import { readLimitedBody } from './bounded-request';
import { verifyWorkbenchToken } from './workbench-token';
import { validIdentity } from './identity-policy';
export const workbenchEnabled=()=>['workbench','hybrid'].includes(env.AUTH_MODE||'');
export const passwordEnabled=()=>['local','hybrid'].includes(env.AUTH_MODE||'');
export const WORKBENCH_COOKIE='ai_risk_workbench_session';
const digest=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
function cookie(request:Request){const match=(request.headers.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(WORKBENCH_COOKIE+'='));return match?.slice(WORKBENCH_COOKIE.length+1)||'';}
export function workbenchCookie(token:string,expiresAt:string){return `${WORKBENCH_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=${new Date(expiresAt).toUTCString()}`;}
export function expiredWorkbenchCookie(){return `${WORKBENCH_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;}
async function cryptKey(){return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`risk-session-v1:${env.WORKBENCH_SECRET}`)),'AES-GCM',false,['encrypt','decrypt']);}
async function encrypt(value:string){const iv=crypto.getRandomValues(new Uint8Array(12));const data=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await cryptKey(),new TextEncoder().encode(value)));return JSON.stringify({iv:Array.from(iv),data:Array.from(data)});}
async function decrypt(value:string){const parts=JSON.parse(value);return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(parts.iv)},await cryptKey(),new Uint8Array(parts.data)));}
export function workbenchLoginUrl(){return env.WORKBENCH_LOGIN_URL||'';}
async function active(raw:string,job:string) {
  if(env.WORKBENCH_REVOKE_MODE==='ttl')return true;
  if(env.WORKBENCH_REVOKE_MODE!=='introspect'||!env.WORKBENCH_INTROSPECT_URL||!env.WORKBENCH_INTROSPECT_TOKEN)return false;
  const target=new URL(env.WORKBENCH_INTROSPECT_URL);
  if(target.protocol!=='https:'||target.origin!==new URL(workbenchLoginUrl()).origin)return false;
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),5000);
  try {
    const response=await fetch(target,{method:'POST',redirect:'error',signal:controller.signal,headers:{authorization:`Bearer ${env.WORKBENCH_INTROSPECT_TOKEN}`,'content-type':'application/json'},body:JSON.stringify({token:raw,job_number:job})});
    if(!response.ok)return false;
    const data=JSON.parse(new TextDecoder().decode(await readLimitedBody(new Request(target,{method:'POST',body:response.body,signal:controller.signal}),4096)));
    return data.active===true&&data.job_number===job&&data.enabled===1;
  }catch{return false;}finally{clearTimeout(timer);}
}
export async function establishWorkbenchSession(raw:string) {
  const claims=await verifyWorkbenchToken(raw,env.WORKBENCH_SECRET||'');
  if(!claims||(env.WORKBENCH_REVOKE_MODE==='ttl'&&claims.exp-claims.iat>1800)||!await active(raw,claims.job_number))return null;
  const user=await env.DB.prepare("SELECT u.id,u.role FROM external_identity e JOIN user_account u ON u.id=e.user_id WHERE e.job_number=? AND e.enabled=1 AND u.enabled=1").bind(claims.job_number).first<{id:number;role:string}>();
  if(!user||!validIdentity({...user,jobNumber:claims.job_number}))return null;
  const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
  const expiresAt=new Date(Math.min(claims.exp*1000,Date.now()+1800_000)).toISOString();
  await env.DB.prepare('DELETE FROM workbench_ticket WHERE expires_at<=?').bind(new Date().toISOString()).run();
  const count=await env.DB.prepare('SELECT COUNT(*) n FROM workbench_ticket').first<{n:number}>();
  if((count?.n||0)>=10000)return null;
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO workbench_ticket(jti,expires_at) VALUES(?,?)').bind(claims.jti,expiresAt),
      env.DB.prepare('INSERT INTO workbench_session(token_hash,user_id,job_number,expires_at,checked_at,token_cipher) VALUES(?,?,?,?,?,?)').bind(await digest(token),user.id,claims.job_number,expiresAt,new Date().toISOString(),env.WORKBENCH_REVOKE_MODE==='introspect'?await encrypt(raw):''),
    ]);
  }catch{return null;}
  return {token,expiresAt};
}
export async function getWorkbenchUser(request:Request) {
  const token=cookie(request);if(!/^[a-f0-9]{64}$/.test(token))return null;
  const key=await digest(token);
  const row=await env.DB.prepare(`SELECT u.id,u.username,u.role,u.consultant_name AS consultantName,s.job_number AS jobNumber,s.token_cipher AS cipher,s.checked_at AS checkedAt FROM workbench_session s JOIN user_account u ON u.id=s.user_id JOIN external_identity e ON e.user_id=u.id AND e.job_number=s.job_number WHERE s.token_hash=? AND s.expires_at>? AND u.enabled=1 AND e.enabled=1`).bind(key,new Date().toISOString()).first<{id:number;username:string;role:'admin'|'consultant';consultantName:string|null;jobNumber:string;cipher:string;checkedAt:string}>();
  if(!row||!validIdentity(row))return null;
  if(env.WORKBENCH_REVOKE_MODE==='introspect'&&Date.now()-Date.parse(row.checkedAt)>=300_000){
    let ok=false;try{ok=await active(await decrypt(row.cipher),row.jobNumber);}catch{}
    if(!ok){await env.DB.prepare('DELETE FROM workbench_session WHERE token_hash=?').bind(key).run();return null;}
    await env.DB.prepare('UPDATE workbench_session SET checked_at=? WHERE token_hash=?').bind(new Date().toISOString(),key).run();
  }
  if(!['ttl','introspect'].includes(env.WORKBENCH_REVOKE_MODE||''))return null;
  return {id:row.id,username:row.username,role:row.role,consultantName:row.consultantName,jobNumber:row.jobNumber,authSource:'workbench' as const};
}
export async function clearWorkbenchSession(request:Request){const token=cookie(request);if(token)await env.DB.prepare('DELETE FROM workbench_session WHERE token_hash=?').bind(await digest(token)).run();}
