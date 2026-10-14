import { establishWorkbenchSession, workbenchEnabled, workbenchLoginUrl } from '@/lib/workbench-auth';
import { sessionCookie } from '@/lib/local-auth';
export async function GET(request:Request){
  if(!workbenchEnabled())return Response.json({error:'统一登录尚未启用'},{status:404});
  const headers:Record<string,string>={'Cache-Control':'no-store','Referrer-Policy':'no-referrer'};
  let session=null;
  try {session=await establishWorkbenchSession(new URL(request.url).searchParams.get('sso_token')||'');}catch{}
  if(!session){headers.Location=workbenchLoginUrl();return new Response(null,{status:302,headers});}
  headers['Set-Cookie']=sessionCookie(session.token,session.expiresAt);headers.Location='/';
  return new Response(null,{status:302,headers});
}
