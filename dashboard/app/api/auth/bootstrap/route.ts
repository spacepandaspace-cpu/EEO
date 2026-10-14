import { readLimitedJson } from "@/lib/bounded-request";
import { env } from "cloudflare:workers";
import { createPasswordRecord, createSession, sessionCookie, writeAudit } from "@/lib/local-auth";

export async function POST(request: Request) {
  if(workbenchEnabled())return Response.json({error:'统一登录模式不允许创建密码管理员'},{status:410});
  try {
    const existing = await env.DB.prepare("SELECT COUNT(*) AS count FROM user_account WHERE role = 'admin'").first<{ count: number }>();
    if (Number(existing?.count ?? 0) > 0) return Response.json({ error: "管理员已初始化" }, { status: 409 });
    const payload = await readLimitedJson(request) as { username?: string; password?: string };
    const username = payload.username?.trim() || "管理员";
    const password = payload.password ?? "";
    if (username.length < 2 || username.length > 30) return Response.json({ error: "管理员名称需为2–30个字符" }, { status: 400 });
    if (password.length < 8) return Response.json({ error: "密码至少8位" }, { status: 400 });
    const record = await createPasswordRecord(password);
    const result = await env.DB.prepare(`
      INSERT INTO user_account (username, role, password_salt, password_hash)
      VALUES (?, 'admin', ?, ?)
    `).bind(username, record.salt, record.hash).run();
    const user = { id: Number(result.meta.last_row_id), username, role: "admin" as const, consultantName: null };
    await writeAudit(user, "bootstrap_admin", "user_account", String(user.id));
    const session = await createSession(user.id);
    return new Response(JSON.stringify({ user }), { status: 201, headers: { "Content-Type": "application/json", "Set-Cookie": sessionCookie(session.token, session.expiresAt) } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "初始化失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
import { workbenchEnabled } from '@/lib/workbench-auth';
