export type WorkbenchClaims = { iss:string; aud:string; exp:number; iat:number; job_number:string; enabled:1; display_name?:string };
function decode(value:string) {
  if(!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid encoding');
  return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
}
export async function verifyWorkbenchToken(raw:string,secret:string,now=Date.now()):Promise<WorkbenchClaims|null> {
  try {
    if(!secret || !raw || raw.length>4096) return null;
    const parts=raw.split('.');if(parts.length!==3)return null;
    const header=JSON.parse(new TextDecoder().decode(decode(parts[0])));
    if(header.alg!=='HS256'||(header.typ!==undefined&&header.typ!=='JWT')||header.crit!==undefined)return null;
    const signature=decode(parts[2]);if(signature.length!==32)return null;
    const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
    if(!await crypto.subtle.verify('HMAC',key,signature,new TextEncoder().encode(`${parts[0]}.${parts[1]}`)))return null;
    const claims=JSON.parse(new TextDecoder().decode(decode(parts[1])));
    const seconds=now/1000;
    if(claims.iss!=='sales-workbench'||claims.aud!=='ai-risk-dashboard'||claims.enabled!==1||
      !/^EEO\d{5,12}$/.test(claims.job_number)||!Number.isSafeInteger(claims.exp)||!Number.isSafeInteger(claims.iat)||
      claims.exp<=seconds||claims.iat>seconds+60||claims.exp<=claims.iat||claims.exp-claims.iat>86400||
      (claims.nbf!==undefined&&(!Number.isFinite(claims.nbf)||claims.nbf>seconds+60)))return null;
    return claims;
  }catch{return null;}
}
