import { readLimitedBody } from "@/lib/bounded-request";
import "server-only";
import { env } from "@/lib/node-runtime";

import { liveSnapshot, liveCustomerDaily } from "@/lib/live-snapshot";
import { applyCrmPayments } from "@/lib/crm-snapshot";
import snapshotSource from "@/app/data/snapshot.json";
import type { DashboardSnapshot } from "@/app/dashboard-types";
import { parseCrmWorkbook } from "@/lib/crm-import";
import { requireAdmin, writeAudit } from "@/lib/local-auth";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

async function sha256Hex(bytes: ArrayBuffer) {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: Request) {
  let runId = 0;
  try {
    const admin = await requireAdmin(request);
    if (!admin) return Response.json({ error: "仅管理员可导入CRM付费表" }, { status: 403 });
    if (Number(request.headers.get("content-length")) > MAX_FILE_SIZE + 65536) return Response.json({ error: "CRM请求超过10MB，请分批导入" }, {status:413});
    const body = await readLimitedBody(request, MAX_FILE_SIZE + 65536);
    const form = await new Response(body, {headers:{"Content-Type":request.headers.get("content-type") || ""}}).formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "请选择CRM付费明细文件" }, { status: 400 });
    if (!/\.(xlsx|xls)$/i.test(file.name)) return Response.json({ error: "仅支持 .xlsx 或 .xls 文件" }, { status: 400 });
    if (file.size <= 0 || file.size > MAX_FILE_SIZE) return Response.json({ error: "CRM文件必须大于0且不超过10MB" }, { status: 400 });

    const bytes = await file.arrayBuffer();
    const fileHash = await sha256Hex(bytes);
    const existing = await env.DB.prepare(`
      SELECT id, status, summary_json AS summaryJson FROM source_run
      WHERE source = 'crm' AND file_hash = ? AND status IN ('success', 'success_with_warnings')
      ORDER BY id DESC LIMIT 1
    `).bind(fileHash).first<{ id: number; status: string; summaryJson: string }>();
    if (existing) return Response.json({ runId: existing.id, status: existing.status, duplicateFile: true, summary: JSON.parse(existing.summaryJson || "{}") });

    const created = await env.DB.prepare(`
      INSERT INTO source_run (source, trigger, status, file_name, file_hash, created_by_user_id)
      VALUES ('crm', 'upload', 'validating', ?, ?, ?)
    `).bind(file.name, fileHash, admin.id).run();
    runId = Number(created.meta.last_row_id);
    const current: DashboardSnapshot = {...await liveSnapshot(),customerAliases:(snapshotSource as DashboardSnapshot).customerAliases};
    const parsed = parseCrmWorkbook(bytes, current);
    if(parsed.unmappedCount)throw new Error("订单客户尚未关联UID，保留旧数据；请先补齐客户关联");
    const daily = (await Promise.all([...new Set(parsed.rows.map(row=>row.uid!))].map(uid=>liveCustomerDaily(uid)))).flat();
    const importedAt = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'medium',hour12:false}).format(new Date());
    const updated = applyCrmPayments({...current,customerDaily:daily} as DashboardSnapshot,parsed,importedAt);
    const overview=JSON.stringify({...updated,customerDaily:[],customerAliases:[]});
    if(new TextEncoder().encode(overview).byteLength>250000)throw new Error("汇总超过250KB预算，保留旧数据");
    const statements = [env.DB.prepare("UPDATE crm_payment_event SET active=0 WHERE active=1"), ...parsed.rows.map((row) => env.DB.prepare(`
      INSERT INTO crm_payment_event (
        source_record_key, uid, customer_name, consultant_name, order_no, paid_date,
        amount_cents, mapping_status, source_run_id, source_row, raw_json, active, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(source_record_key) DO UPDATE SET
        uid = excluded.uid,
        customer_name = excluded.customer_name,
        consultant_name = excluded.consultant_name,
        order_no = excluded.order_no,
        paid_date = excluded.paid_date,
        amount_cents = excluded.amount_cents,
        mapping_status = excluded.mapping_status,
        source_run_id = excluded.source_run_id,
        source_row = excluded.source_row,
        raw_json = excluded.raw_json,
        active = 1,
        updated_at = CURRENT_TIMESTAMP
    `).bind(row.sourceRecordKey, row.uid, row.customerName, row.consultantName, row.orderNo, row.paidDate, row.amountCents, row.mappingStatus, runId, row.sourceRow, row.rawJson)), env.DB.prepare("INSERT OR REPLACE INTO eeo_snapshot(key,json) VALUES('overview',?)").bind(overview)];
    const summary = {
      sheetName: parsed.sheetName,
      rowCount: parsed.rows.length,
      amount: parsed.amountCents / 100,
      matchedCount: parsed.matchedCount,
      unmappedCount: parsed.unmappedCount,
      warnings: parsed.warnings.slice(0, 20),
      corrections: parsed.corrections,
      analysisRefreshPending: false,
    };
    const status = parsed.unmappedCount || parsed.warnings.length ? "success_with_warnings" : "success";
    statements.push(env.DB.prepare(`
      UPDATE source_run SET status = ?, data_as_of = ?, row_count = ?, summary_json = ?, finished_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(status, importedAt, parsed.rows.length, JSON.stringify(summary), runId));
    await env.DB.batch(statements);
    await writeAudit(admin, "import_crm_payments", "source_run", String(runId), JSON.stringify({ fileName: file.name, fileHash, ...summary }));
    return Response.json({ runId, status, summary }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CRM付费表导入失败";
    if (runId) {
      await env.DB.prepare("UPDATE source_run SET status = 'failed', error_message = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?").bind(message, runId).run();
    }
    return Response.json({ error: message, runId: runId || undefined }, { status: 400 });
  }
}
