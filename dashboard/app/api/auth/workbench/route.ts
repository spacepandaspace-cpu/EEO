import { establishWorkbenchSession, workbenchEnabled, workbenchCookie } from '@/lib/workbench-auth';
import { expiredSessionCookie } from '@/lib/local-auth';
export async function GET(request:Request){
  if(!workbenchEnabled())return Response.json({error:'统一登录尚未启用'},{status:404});
  const headers:Record<string,string>={'Cache-Control':'no-store','Referrer-Policy':'no-referrer'};
  let session=null;
  try {session=await establishWorkbenchSession(new URL(request.url).searchParams.get('sso_token')||'');}catch{}
  if(!session){headers.Location='/?login_error=sso_denied';return new Response(null,{status:302,headers});}
  headers.Location='/';
  const responseHeaders=new Headers(headers);
  responseHeaders.append('Set-Cookie',workbenchCookie(session.token,session.expiresAt));
  responseHeaders.append('Set-Cookie',expiredSessionCookie());
  return new Response(null,{status:302,headers:responseHeaders});
}
