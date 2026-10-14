import { env } from "@/lib/node-runtime";
import { getAuthenticatedUser } from "@/lib/local-auth";
import { workbenchEnabled, workbenchLoginUrl } from '@/lib/workbench-auth';

export async function GET(request: Request) {
  try {
    if(workbenchEnabled()){const user=await getAuthenticatedUser(request);return Response.json({bootstrapRequired:false,authenticated:Boolean(user),user,authMode:'workbench',loginUrl:workbenchLoginUrl()},{headers:{'Cache-Control':'no-store'}});}
    const account = await env.DB.prepare("SELECT COUNT(*) AS count FROM user_account WHERE role = 'admin'").first<{ count: number }>();
    const user = await getAuthenticatedUser(request);
    return Response.json({ bootstrapRequired: Number(account?.count ?? 0) === 0, authenticated: Boolean(user), user });
  } catch (error) {
    const message = error instanceof Error ? error.message : "数据库暂不可用";
    return Response.json({ error: message }, { status: 500 });
  }
}
