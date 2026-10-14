import { env } from '@/lib/node-runtime';
import { getAuthenticatedUser } from '@/lib/local-auth';
import { passwordEnabled, workbenchEnabled, workbenchLoginUrl } from '@/lib/workbench-auth';
export async function GET(request:Request) {
  try {
    const user=await getAuthenticatedUser(request);
    return Response.json({bootstrapRequired:false,registrationEnabled:false,
      authenticated:Boolean(user),user,authMode:env.AUTH_MODE,passwordEnabled:passwordEnabled(),
      loginUrl:workbenchEnabled()?workbenchLoginUrl():undefined},
      {headers:{'Cache-Control':'no-store, private'}});
  } catch {
    return Response.json({error:'登录服务暂不可用，请联系管理员。'},{status:503,headers:{'Cache-Control':'no-store'}});
  }
}
