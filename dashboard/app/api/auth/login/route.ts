import { readLimitedJson } from "@/lib/bounded-request";
import { env } from "@/lib/node-runtime";
import { passwordEnabled, expiredWorkbenchCookie } from '@/lib/workbench-auth';
import { validIdentity } from '@/lib/identity-policy';
import { allowPasswordAttempt } from '@/lib/password-attempts';
import { safeMutation } from '@/lib/auth-mutation';
import { createSession, sessionCookie, verifyPassword, writeAudit, type AuthUser } from "@/lib/local-auth";

type AccountRow = AuthUser & { passwordSalt: string; passwordHash: string };

export async function POST(request: Request) {
  if(!safeMutation(request))return Response.json({error:'请求来源不允许'},{status:403});
  if(!passwordEnabled())return Response.json({error:'独立密码登录未启用'},{status:410});
  try {
    const payload = await readLimitedJson(request) as { username?: string; password?: string };
    if(typeof payload.username!=='string'||typeof payload.password!=='string')return Response.json({error:'账号或密码格式错误'},{status:400});
    const username = payload.username?.trim() ?? "";
    const password = payload.password ?? "";
    if(username.length<2||username.length>100||password.length>128)return Response.json({error:'账号或密码格式错误'},{status:400});
    const account = await env.DB.prepare(`
      SELECT u.id, u.username, u.role, u.consultant_name AS consultantName,
             e.job_number AS jobNumber, u.password_salt AS passwordSalt, u.password_hash AS passwordHash
      FROM user_account u JOIN external_identity e ON e.user_id=u.id
      WHERE ${/^EEO\d{5,12}$/.test(username)?'e.job_number = ?':'u.username = ?'} AND u.enabled = 1 AND e.enabled = 1 LIMIT 1
    `).bind(username).first<AccountRow>();
    if(!allowPasswordAttempt(account?.jobNumber||username.toUpperCase()))return Response.json({error:'登录尝试过多，请10分钟后重试'},{status:429,headers:{'Retry-After':'600'}});
    if (!account || !validIdentity(account) || !account.passwordSalt || !account.passwordHash || !(await verifyPassword(password, account.passwordSalt, account.passwordHash))) {
      return Response.json({ error: "账号或密码错误" }, { status: 401 });
    }
    const user: AuthUser = { id: account.id, username: account.username, role: account.role, consultantName: account.consultantName, jobNumber: account.jobNumber, authSource:'password' };
    const session = await createSession(user.id);
    await writeAudit(user, "login", "user_account", String(user.id));
    const headers=new Headers({'Content-Type':'application/json','Cache-Control':'no-store'});
    headers.append('Set-Cookie',sessionCookie(session.token,session.expiresAt));
    headers.append('Set-Cookie',expiredWorkbenchCookie());
    return new Response(JSON.stringify({ user }), { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "登录失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
