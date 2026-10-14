import { readLimitedJson } from "@/lib/bounded-request";
import { env } from "cloudflare:workers";
import { workbenchEnabled } from '@/lib/workbench-auth';
import { createSession, sessionCookie, verifyPassword, writeAudit, type AuthUser } from "@/lib/local-auth";

type AccountRow = AuthUser & { passwordSalt: string; passwordHash: string };

export async function POST(request: Request) {
  if(workbenchEnabled())return Response.json({error:'统一登录模式不接受本地密码'},{status:410});
  try {
    const payload = await readLimitedJson(request) as { username?: string; password?: string };
    const username = payload.username?.trim() ?? "";
    const password = payload.password ?? "";
    const account = await env.DB.prepare(`
      SELECT id, username, role, consultant_name AS consultantName,
             password_salt AS passwordSalt, password_hash AS passwordHash
      FROM user_account WHERE username = ? AND enabled = 1 LIMIT 1
    `).bind(username).first<AccountRow>();
    if (!account || !(await verifyPassword(password, account.passwordSalt, account.passwordHash))) {
      return Response.json({ error: "账号或密码错误" }, { status: 401 });
    }
    const user: AuthUser = { id: account.id, username: account.username, role: account.role, consultantName: account.consultantName };
    const session = await createSession(user.id);
    await writeAudit(user, "login", "user_account", String(user.id));
    return new Response(JSON.stringify({ user }), { headers: { "Content-Type": "application/json", "Set-Cookie": sessionCookie(session.token, session.expiresAt) } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "登录失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
