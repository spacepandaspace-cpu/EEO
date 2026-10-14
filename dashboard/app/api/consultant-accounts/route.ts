import { readLimitedJson } from "@/lib/bounded-request";
import "server-only";
import { env } from "cloudflare:workers";
import { workbenchEnabled } from '@/lib/workbench-auth';
import snapshot from "@/app/data/snapshot.json";
import { createPasswordRecord, encryptRecoverablePassword, generateConsultantPassword, requireAdmin, verifyPassword, writeAudit } from "@/lib/local-auth";

type AdminRecord = { passwordSalt: string; passwordHash: string };

export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) return Response.json({ error: "仅管理员可管理顾问账号" }, { status: 403 });
  const result = await env.DB.prepare(`
    SELECT username, consultant_name AS consultantName, enabled, created_at AS createdAt
    FROM user_account WHERE role = 'consultant' ORDER BY consultant_name
  `).all<{ username: string; consultantName: string; enabled: number; createdAt: string }>();
  return Response.json({ authMode: workbenchEnabled()?'workbench':'local', accounts: result.results.map((row) => ({ ...row, enabled: Boolean(row.enabled) })) });
}

export async function POST(request: Request) {
  if(workbenchEnabled())return Response.json({error:'统一登录模式不允许生成本地密码'},{status:410});
  try {
    const admin = await requireAdmin(request);
    if (!admin) return Response.json({ error: "仅管理员可生成顾问账号" }, { status: 403 });
    const payload = await readLimitedJson(request) as { consultantName?: string; adminPassword?: string };
    const consultantName = payload.consultantName?.trim() ?? "";
    const adminPassword = payload.adminPassword ?? "";
    if (!snapshot.consultants.includes(consultantName)) return Response.json({ error: "顾问不在当前客户主数据中" }, { status: 400 });
    const adminRecord = await env.DB.prepare("SELECT password_salt AS passwordSalt, password_hash AS passwordHash FROM user_account WHERE id = ?").bind(admin.id).first<AdminRecord>();
    if (!adminRecord || !(await verifyPassword(adminPassword, adminRecord.passwordSalt, adminRecord.passwordHash))) return Response.json({ error: "管理员密码错误" }, { status: 401 });
    const existing = await env.DB.prepare("SELECT id FROM user_account WHERE consultant_name = ? OR username = ?").bind(consultantName, consultantName).first();
    if (existing) return Response.json({ error: "该顾问账号已存在" }, { status: 409 });

    const password = generateConsultantPassword();
    const loginRecord = await createPasswordRecord(password);
    const recovery = await encryptRecoverablePassword(password, adminPassword, adminRecord.passwordSalt);
    const result = await env.DB.prepare(`
      INSERT INTO user_account (username, role, consultant_name, password_salt, password_hash, encrypted_password, password_iv)
      VALUES (?, 'consultant', ?, ?, ?, ?, ?)
    `).bind(consultantName, consultantName, loginRecord.salt, loginRecord.hash, recovery.encryptedPassword, recovery.passwordIv).run();
    await writeAudit(admin, "create_consultant_account", "user_account", String(result.meta.last_row_id), JSON.stringify({ consultantName }));
    return Response.json({ account: { username: consultantName, consultantName, enabled: true }, password }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "顾问账号生成失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
