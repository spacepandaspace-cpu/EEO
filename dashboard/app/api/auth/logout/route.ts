import { clearSession, expiredSessionCookie, getAuthenticatedUser } from '@/lib/local-auth';
import { env } from '@/lib/node-runtime';
import { expiredWorkbenchCookie } from '@/lib/workbench-auth';
import { safeMutation } from '@/lib/auth-mutation';
export async function POST(request:Request) {
  if(!safeMutation(request))return Response.json({error:'请求来源不允许'},{status:403});
  const user=await getAuthenticatedUser(request);
  await clearSession(request);
  const headers=new Headers({'Cache-Control':'no-store'});
  headers.append('Set-Cookie',expiredSessionCookie());
  headers.append('Set-Cookie',expiredWorkbenchCookie());
  return Response.json({logoutUrl:user?.authSource==='workbench'?env.WORKBENCH_LOGOUT_URL:undefined},{headers});
}
