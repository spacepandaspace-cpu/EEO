import { readLimitedJson } from "@/lib/bounded-request";
import "server-only";
import { env } from "cloudflare:workers";

import { liveSnapshot } from "@/lib/live-snapshot";
import { requireAdmin, writeAudit } from "@/lib/local-auth";

type RunRow = {
  id: number;
  source: "eeo" | "crm";
  trigger: string;
  status: string;
  dataAsOf: string | null;
  rowCount: number;
  fileName: string | null;
  summaryJson: string;
  errorMessage: string;
  startedAt: string;
  finishedAt: string | null;
};

function parseSummary(value: string) {
  try { return JSON.parse(value || "{}"); } catch { return {}; }
}

export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) return Response.json({ error: "仅管理员可查看数据更新状态" }, { status: 403 });
  const current = await liveSnapshot();
  const [runs, paymentSummary, configs] = await Promise.all([
    env.DB.prepare(`
      SELECT id, source, trigger, status, data_as_of AS dataAsOf, row_count AS rowCount,
             file_name AS fileName, summary_json AS summaryJson, error_message AS errorMessage,
             started_at AS startedAt, finished_at AS finishedAt
      FROM source_run ORDER BY id DESC LIMIT 30
    `).all<RunRow>(),
    env.DB.prepare(`
      SELECT COUNT(*) AS rowCount,
             COALESCE(SUM(amount_cents), 0) AS amountCents,
             COALESCE(SUM(CASE WHEN mapping_status = 'unmapped' THEN 1 ELSE 0 END), 0) AS unmappedCount
      FROM crm_payment_event WHERE active = 1
    `).first<{ rowCount: number; amountCents: number; unmappedCount: number }>(),
    env.DB.prepare("SELECT key, value FROM system_config ORDER BY key").all<{ key: string; value: string }>(),
  ]);
  const config = Object.fromEntries(configs.results.map((row) => [row.key, row.value]));
  return Response.json({
    sync: { mode: "local_collector", configured: Boolean(env.EEO_SYNC_TOKEN && env.EEO_SYNC_TOKEN.length >= 32) },
    schedule: {
      timezone: config["refresh.schedule.timezone"] ?? "Asia/Shanghai",
      weekday: Number(config["refresh.eeo.weekday"] ?? 1),
      time: config["refresh.eeo.time"] ?? "10:00",
      startupCatchup: true,
      crmMode: config["refresh.crm.mode"] ?? "cumulative_upload",
    },
    initialEeoAsOf: current.asOf,
    initialCrmAsOf: current.sourceMetadata?.crm?.dataAsOf ?? "2026-09-21 10:00",
    sourceMetadata: current.sourceMetadata ?? {},
    crmSummary: paymentSummary ?? { rowCount: 0, amountCents: 0, unmappedCount: 0 },
    runs: runs.results.map((row) => ({ ...row, summary: parseSummary(row.summaryJson), summaryJson: undefined })),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin(request);
    if (!admin) return Response.json({ error: "仅管理员可启动EEO更新" }, { status: 403 });
    const payload = await readLimitedJson(request) as { source?: string; trigger?: string; action?: string };
    if (payload.source !== "eeo") return Response.json({ error: "当前接口只接受EEO更新任务" }, { status: 400 });
    if (payload.action === "cancel_waiting") {
      const active = await env.DB.prepare(`
        SELECT id FROM source_run
        WHERE source = 'eeo' AND status = 'waiting_for_login'
        ORDER BY id DESC LIMIT 1
      `).first<{ id: number }>();
      if (!active) return Response.json({ cancelled: false, message: "没有等待登录的EEO任务。" });
      await env.DB.prepare(`
        UPDATE source_run
        SET status = 'failed', finished_at = CURRENT_TIMESTAMP,
            error_message = '管理员取消：浏览器采集器尚未接入，未读取或覆盖任何EEO数据。'
        WHERE id = ?
      `).bind(active.id).run();
      await writeAudit(admin, "cancel_eeo_refresh", "source_run", String(active.id), "cancel_waiting");
      return Response.json({ cancelled: true, runId: active.id });
    }
    return Response.json({ error: "采集已移至本电脑定时任务。请在采集电脑运行 npm run eeo:weekly；网页不会远程启动Chrome。" }, { status: 410 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "EEO更新任务创建失败" }, { status: 500 });
  }
}
