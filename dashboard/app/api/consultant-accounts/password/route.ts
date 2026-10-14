import { readLimitedJson } from "@/lib/bounded-request";
import "server-only";
import { env } from "cloudflare:workers";
import { workbenchEnabled } from '@/lib/workbench-auth';
import { decryptRecoverablePassword, requireAdmin, verifyPassword, writeAudit } from "@/lib/local-auth";

type AdminRecord = { passwordSalt: string; passwordHash: string };
type ConsultantRecord = { id: number; encryptedPassword: string; passwordIv: string };

export async function POST(request: Request) {
  if(workbenchEnabled())return Response.json({error:'统一登录模式不提供本地密码'},{status:410});
  try {
    const admin = await requireAdmin(request);
    if (!admin) return Response.json({ error: "仅管理员可查看顾问密码" }, { status: 403 });
    const payload = await readLimitedJson(request) as { consultantName?: string; adminPassword?: string };
    const consultantName = payload.consultantName?.trim() ?? "";
    const adminPassword = payload.adminPassword ?? "";
    const adminRecord = await env.DB.prepare("SELECT password_salt AS passwordSalt, password_hash AS passwordHash FROM user_account WHERE id = ?").bind(admin.id).first<AdminRecord>();
    if (!adminRecord || !(await verifyPassword(adminPassword, adminRecord.passwordSalt, adminRecord.passwordHash))) return Response.json({ error: "管理员密码错误" }, { status: 401 });
    const account = await env.DB.prepare(`
      SELECT id, encrypted_password AS encryptedPassword, password_iv AS passwordIv
      FROM user_account WHERE role = 'consultant' AND consultant_name = ? AND enabled = 1 LIMIT 1
    `).bind(consultantName).first<ConsultantRecord>();
    if (!account?.encryptedPassword || !account.passwordIv) return Response.json({ error: "未找到可恢复的顾问密码" }, { status: 404 });
    const password = await decryptRecoverablePassword(account.encryptedPassword, account.passwordIv, adminPassword, adminRecord.passwordSalt);
    await writeAudit(admin, "reveal_consultant_password", "user_account", String(account.id), JSON.stringify({ consultantName }));
    return Response.json({ password });
  } catch (error) {
    const message = error instanceof Error ? error.message : "密码读取失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
