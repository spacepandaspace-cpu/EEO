import { readLimitedJson } from "@/lib/bounded-request";
import { env } from "@/lib/node-runtime";
import { getAuthenticatedUser, requireAdmin, writeAudit } from "@/lib/local-auth";
import { liveSnapshot } from "@/lib/live-snapshot";
import { canAccessCustomer } from "@/lib/customer-access";

type LogRow = {
  id: number;
  uid: string;
  type: string;
  recordTime: string;
  content: string;
  createdByName: string;
  createdAt: string;
};

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
    const uid = new URL(request.url).searchParams.get("uid")?.trim();
    if (!uid) return Response.json({ error: "缺少UID" }, { status: 400 });
    if (user.role === "consultant") {
      const snapshot = await liveSnapshot();
      const customer = snapshot.customers.find((row) => row.uid === uid);
      if (!customer || !canAccessCustomer(user, customer)) return Response.json({ error: "无权查看该客户" }, { status: 403 });
    }
    const result = await env.DB.prepare(`
      SELECT id, uid, type, record_time AS recordTime, content,
             created_by_name AS createdByName, created_at AS createdAt
      FROM customer_log WHERE uid = ? ORDER BY record_time DESC, id DESC LIMIT 50
    `).bind(uid).all<LogRow>();
    return Response.json({ logs: result.results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "日志读取失败";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAdmin(request);
    if (!user) return Response.json({ error: "仅管理员可新增日志" }, { status: 403 });
    const payload = await readLimitedJson(request) as { uid?: string; type?: string; recordTime?: string; content?: string };
    const uid = payload.uid?.trim() ?? "";
    const type = payload.type === "客户反馈" ? "客户反馈" : payload.type === "跟进记录" ? "跟进记录" : "";
    const recordTime = payload.recordTime?.trim() ?? "";
    const content = payload.content?.trim() ?? "";
    if (content.length > 4000) return Response.json({ error: "每条日志最多4000字，请分条记录" }, { status: 413 });
    if (!/^\d+$/.test(uid) || !type || !recordTime || !content) return Response.json({ error: "日志字段不完整" }, { status: 400 });
    const result = await env.DB.prepare(`
      INSERT INTO customer_log (uid, type, record_time, content, created_by_user_id, created_by_name)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(uid, type, recordTime, content, user.id, user.username).run();
    await writeAudit(user, "create_customer_log", "customer", uid, JSON.stringify({ logId: result.meta.last_row_id, type, recordTime }));
    return Response.json({ id: result.meta.last_row_id }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "日志保存失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
