"use client";

import { useEffect } from "react";
import type { DashboardSnapshot, SessionUser } from "./dashboard-types";
import type { PageKey } from "./secondary-pages";

type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
  execute: (input: unknown) => unknown | Promise<unknown>;
};

type ModelContext = {
  registerTool: (tool: ToolDefinition, options?: { signal?: AbortSignal }) => void | Promise<void>;
};

const adminPages: PageKey[] = ["运营总览", "待跟进客户", "客户主数据", "客户详情与日志", "数据质量", "系统设置"];
const consultantPages: PageKey[] = ["运营总览", "待跟进客户", "客户主数据", "客户详情与日志"];

export function useDashboardTools(setPage: (page: PageKey) => void, openCustomer: (uid: string) => void, snapshot: DashboardSnapshot | null, role: SessionUser["role"]) {
  useEffect(() => {
    if (!snapshot) return;
    const context = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const pages = role === "admin" ? adminPages : consultantPages;

    void Promise.resolve(context.registerTool({
      name: "open_dashboard_page",
      title: "打开看板页面",
      description: "在AI教学风险监测客户运营看板中打开指定页面。",
      inputSchema: { type: "object", properties: { page: { type: "string", enum: pages } }, required: ["page"], additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute(input) {
        const page = (input as { page?: string }).page;
        if (!pages.includes(page as PageKey)) throw new Error("未知页面");
        setPage(page as PageKey);
        return { page };
      },
    }, { signal: lifecycle.signal }));

    void Promise.resolve(context.registerTool({
      name: "open_customer_detail",
      title: "打开客户详情",
      description: "按UID打开客户详情、使用趋势和经营时间线。",
      inputSchema: { type: "object", properties: { uid: { type: "string" } }, required: ["uid"], additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute(input) {
        const uid = (input as { uid?: string }).uid;
        const customer = snapshot.customers.find((row) => row.uid === uid);
        if (!customer) throw new Error("未找到该UID");
        openCustomer(customer.uid);
        return { uid: customer.uid, customerName: customer.customerName, consultant: customer.consultant };
      },
    }, { signal: lifecycle.signal }));

    return () => lifecycle.abort();
  }, [openCustomer, role, setPage, snapshot]);
}
