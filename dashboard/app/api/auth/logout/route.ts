import { clearSession, expiredSessionCookie } from "@/lib/local-auth";
import { env } from '@/lib/node-runtime';
import { workbenchEnabled } from '@/lib/workbench-auth';

export async function POST(request: Request) {
  if(workbenchEnabled()){
    await clearSession(request);
    return Response.json({logoutUrl:env.WORKBENCH_LOGOUT_URL},{headers:{'Set-Cookie':expiredSessionCookie(),'Cache-Control':'no-store'}});
  }
  try {
    await clearSession(request);
  } finally {
    return new Response(null, { status: 204, headers: { "Set-Cookie": expiredSessionCookie() } });
  }
}
