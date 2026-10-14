"use client";
import { useBoundedFetch } from "@/lib/bounded-fetch";

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Activity, AlertTriangle, BellRing, ChevronRight, ClipboardList, Database,
  HelpCircle, LayoutDashboard, Loader2, RefreshCw, Search, Settings, ShieldCheck,
  Sparkles, UploadCloud, Users,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton,
  SidebarMenuItem, SidebarProvider, SidebarTrigger,
} from "@/components/ui/sidebar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AuthGate } from "./auth-gate";
import type { DashboardSnapshot, SessionUser } from "./dashboard-types";
import type { PageKey } from "./secondary-pages";
import { useDashboardTools } from "./use-dashboard-tools";

const SecondaryPage = lazy(() => import("./secondary-pages").then((module) => ({ default: module.SecondaryPage })));

const navItems = [
  { label: "运营总览", icon: LayoutDashboard },
  { label: "待跟进客户", icon: BellRing },
  { label: "客户主数据", icon: Users },
  { label: "客户详情与日志", icon: ClipboardList },
  { label: "数据更新", icon: UploadCloud },
  { label: "数据质量", icon: Database },
  { label: "系统设置", icon: Settings },
];

type Metric = {
  label: string; value: string; note: string; accent: string;
  definition: string; formula: string; source: string;
  group?: "conversion" | "retention";
};

const percent = (numerator: number, denominator: number) => denominator ? `${(numerator / denominator * 100).toFixed(1)}%` : "—";

function metricsFor(snapshot: DashboardSnapshot, role: SessionUser["role"]): Metric[] {
  const b = snapshot.baselines;
  if (role === "consultant") return [
    { label: "名下客户", value: String(b.customerCount), note: "按当前归属回看全部历史", accent: "bg-[#1967ff]", definition: "当前归属该顾问的唯一UID数量。", formula: "当前顾问名下UID去重计数", source: `客户主数据｜截至 ${snapshot.asOf}` },
    { label: "历史已使用", value: String(b.historicalUsedCount), note: percent(b.historicalUsedCount, b.customerCount), accent: "bg-[#02a67a]", definition: "可用历史区间内至少产生1节成功监测课节的名下客户。", formula: "历史成功监测课节 > 0 的名下UID数", source: `EEOS后台｜截至 ${snapshot.asOf}` },
    { label: "正式期已使用", value: String(b.postLaunchUsedCount), note: "上线后产生成功监测课节", accent: "bg-[#00a7c4]", definition: "2026年8月18日后至少产生1节成功监测课节的名下客户。", formula: "正式期成功监测课节 > 0 的名下UID数", source: `EEOS后台｜截至 ${snapshot.asOf}` },
    { label: "免费AI额度领取", value: String(b.claimCount), note: percent(b.claimCount, b.customerCount), accent: "bg-[#7c4dff]", definition: "名下客户中已经领取活动免费额度的UID数。", formula: "已领取免费额度的名下UID去重计数", source: "免费额度领取数据" },
    { label: "付费客户", value: String(b.paidCount), note: `累计实收 ¥${b.paidAmount.toLocaleString()}`, accent: "bg-[#f59e0b]", definition: "名下客户中至少有1笔确认到账记录的唯一UID。", formula: "确认到账的名下付费UID去重计数", source: "AI额度售卖数据" },
    { label: "累计成功监测", value: b.totalLessons.toLocaleString(), note: "按课程发生日期", accent: "bg-[#ef5b5b]", definition: "名下客户在可用历史区间内成功完成监测的课节总数。", formula: "成功监测课节求和", source: `EEOS后台｜截至 ${snapshot.asOf}` },
  ];
  const paidAll = snapshot.customers.filter((row) => row.paid).length;
  const paidTrial = snapshot.customers.filter((row) => row.paid && row.trial).length;
  const paidClaim = snapshot.customers.filter((row) => row.paid && row.claim).length;
  const activatedPayment = snapshot.metricDefinitions.find((metric) => metric.code === "activated_customer_payment_rate");
  const postPaymentRetention = snapshot.metricDefinitions.find((metric) => metric.code === "post_payment_continued_usage_rate");
  const paidUsed = activatedPayment?.numerator ?? snapshot.customers.filter((row) => row.paid && row.used).length;
  const continued = postPaymentRetention?.numerator ?? snapshot.customers.filter((row) => row.paid && row.lessonsAfterPayment > 0).length;
  return [
    { label: "在册客户", value: String(b.customerCount), note: "三类业务来源UID并集", accent: "bg-[#1967ff]", definition: "当前纳入AI教学风险监测运营范围的唯一UID数量。", formula: "试用、免费领额、付费客户UID去重并集", source: `客户主数据｜截至 ${snapshot.asOf}` },
    { label: "历史已使用", value: String(b.historicalUsedCount), note: `${percent(b.historicalUsedCount, b.customerCount)} 的在册客户`, accent: "bg-[#02a67a]", definition: "可用历史区间内至少产生1节成功监测课节的UID。", formula: "历史成功监测课节 > 0 的UID数", source: `EEOS后台｜截至 ${snapshot.asOf}` },
    { label: "正式期已使用", value: String(b.postLaunchUsedCount), note: "上线后产生成功监测课节", accent: "bg-[#00a7c4]", definition: "2026年8月18日正式上线后至少产生1节成功监测课节的UID。", formula: "上线后成功监测课节 > 0 的UID数", source: `EEOS后台｜截至 ${snapshot.asOf}` },
    { label: "付费客户", value: String(b.paidCount), note: `累计实收 ¥${b.paidAmount.toLocaleString()}`, accent: "bg-[#7c4dff]", definition: "至少有1笔已确认到账记录的唯一UID。", formula: "确认到账的付费UID去重计数", source: "AI额度售卖数据" },
    { label: "全体客户付费率", value: percent(paidAll, b.customerCount), note: `${paidAll} / ${b.customerCount}`, accent: "bg-[#64748b]", definition: "全部在册客户中已经发生真实付费的客户比例。", formula: `付费UID ${paidAll} ÷ 在册UID ${b.customerCount}`, source: "客户主数据、付费事件", group: "conversion" },
    { label: "试用客户付费率", value: percent(paidTrial, b.trialCount), note: `${paidTrial} / ${b.trialCount}`, accent: "bg-[#8b5cf6]", definition: "灰度试用客户中已经发生真实付费的客户比例。", formula: `试用且付费UID ${paidTrial} ÷ 试用UID ${b.trialCount}`, source: "试用名单、付费事件", group: "conversion" },
    { label: "领额客户付费率", value: percent(paidClaim, b.claimCount), note: `${paidClaim} / ${b.claimCount}`, accent: "bg-[#0ea5e9]", definition: "领取免费额度的客户中已经发生真实付费的客户比例。", formula: `领额且付费UID ${paidClaim} ÷ 领额UID ${b.claimCount}`, source: "免费额度领取、付费事件", group: "conversion" },
    { label: activatedPayment?.label ?? "已激活客户付费率", value: percent(paidUsed, activatedPayment?.denominator ?? b.historicalUsedCount), note: `${paidUsed} / ${activatedPayment?.denominator ?? b.historicalUsedCount}`, accent: "bg-[#f59e0b]", definition: activatedPayment?.definition ?? "历史任意时段至少有1节成功监测课节的已激活客户中，已经发生真实付费的客户比例。", formula: `${activatedPayment?.formula ?? "历史已激活且已付费UID ÷ 历史已激活UID"}（当前 ${paidUsed} / ${activatedPayment?.denominator ?? b.historicalUsedCount}）`, source: activatedPayment?.source ?? "客户主数据、付费事件、EEOS后台", group: "conversion" },
    { label: postPaymentRetention?.label ?? "付费后继续使用率", value: percent(continued, postPaymentRetention?.denominator ?? b.paidCount), note: `${continued} / ${postPaymentRetention?.denominator ?? b.paidCount}`, accent: "bg-[#ef5b5b]", definition: postPaymentRetention?.definition ?? "全部付费客户中，在付款日当天或以后继续产生成功监测课节的比例。该指标观察付费后的留存，不属于转化率。", formula: `${postPaymentRetention?.formula ?? "付费后继续使用UID ÷ 全部付费UID"}（当前 ${continued} / ${postPaymentRetention?.denominator ?? b.paidCount}）`, source: `${postPaymentRetention?.source ?? "付费事件、EEOS后台"}｜截至 ${snapshot.asOf}`, group: "retention" },
  ];
}

function MetricHelp({ metric }: { metric: Metric }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button className="rounded-full text-slate-400 transition hover:text-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500" aria-label={`查看${metric.label}定义`}>
          <HelpCircle className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start" sideOffset={8} className="max-w-[330px] rounded-xl border border-emerald-800 bg-emerald-950 p-4 text-left text-white shadow-2xl">
        <p className="text-sm font-semibold">{metric.label}</p>
        <p className="mt-2 text-[13px] leading-5 text-slate-200">{metric.definition}</p>
        <p className="mt-2 text-[12px] leading-5 text-slate-400">公式：{metric.formula}</p>
        <p className="text-[12px] leading-5 text-slate-400">来源：{metric.source}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function MetricCard({ metric }: { metric: Metric }) {
  return (
    <Card className="group gap-3 rounded-2xl border-emerald-950/10 bg-white py-5 shadow-[0_12px_35px_rgba(15,74,55,.055)] transition duration-200 hover:-translate-y-0.5 hover:border-emerald-700/20 hover:shadow-[0_16px_38px_rgba(15,74,55,.09)]">
      <CardHeader className="gap-1 px-5">
        <div className="flex items-center gap-1.5 text-sm font-medium text-slate-500">
          <span>{metric.label}</span><MetricHelp metric={metric} />
        </div>
        <CardTitle className="mt-3 text-[2.05rem] font-semibold tracking-[-0.045em] text-emerald-950">{metric.value}</CardTitle>
      </CardHeader>
      <CardContent className="px-5 text-sm text-slate-500"><span className="inline-flex rounded-lg bg-emerald-50 px-2.5 py-1 text-emerald-800">{metric.note}</span></CardContent>
    </Card>
  );
}

function ConversionMetric({ metric, featured = false }: { metric: Metric; featured?: boolean }) {
  const retention = metric.group === "retention";
  return <div className={`min-w-0 px-4 py-5 ${featured ? "rounded-xl border border-rose-200 bg-rose-50/70" : "border-b border-emerald-950/8 last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0"}`}><div className="flex items-center gap-1.5 whitespace-nowrap text-sm font-medium text-slate-500"><span>{metric.label}</span><MetricHelp metric={metric} /></div><p className={`mt-3 text-2xl font-semibold tracking-[-0.04em] ${retention ? "text-rose-900" : "text-emerald-950"}`}>{metric.value}</p><p className={`mt-1 text-sm ${retention ? "text-rose-700/70" : "text-slate-400"}`}>{metric.note}</p></div>;
}

function StatusBadge({ tone, children }: { tone: string; children: React.ReactNode }) {
  const styles = tone === "danger" ? "border-red-200 bg-red-50 text-red-700" : tone === "warning" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-emerald-200 bg-emerald-50 text-emerald-700";
  return <Badge variant="outline" className={`rounded-md px-2 py-1 text-xs ${styles}`}>{children}</Badge>;
}

function Dashboard({ user }: { user: SessionUser }) {
  const request = useBoundedFetch();
  const [activePage, setActivePage] = useState<PageKey>("运营总览");
  const [selectedUid, setSelectedUid] = useState("");
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [loadError, setLoadError] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [refreshing, setRefreshing] = useState(true);
  const contentRef = useRef<HTMLElement>(null);
  useEffect(() => { contentRef.current?.scrollTo({ top: 0, left: 0 }); }, [activePage, selectedUid]);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 20000);
    request("/api/dashboard", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as DashboardSnapshot & { error?: string };
        if (!response.ok) throw new Error(payload.error || "看板数据读取失败");
        if (active) {
          setSnapshot(payload);
          setSelectedUid(payload.customers[0]?.uid ?? "");
        }
      })
      .catch((reason) => { if (active) setLoadError(controller.signal.aborted ? "看板数据读取超时，请刷新页面重试。" : reason instanceof Error ? reason.message : "看板数据读取失败"); })
      .finally(() => { clearTimeout(timeout); if(active) setRefreshing(false); });
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [request, refreshVersion]);
  const logout = async () => {
    try { const response=await request("/api/auth/logout", { method: "POST" }); if(!response.ok)throw new Error('退出失败'); if(response.status===200){const payload=await response.json() as {logoutUrl?:string};if(payload.logoutUrl){window.location.assign(payload.logoutUrl);return;}} window.location.reload(); }
    catch (reason) { setLoadError(reason instanceof Error ? reason.message : "退出失败"); }
  };
  const openCustomer = (uid: string) => {
    setSelectedUid(uid);
    setActivePage("客户详情与日志");
  };
  useDashboardTools(setActivePage, openCustomer, snapshot, user.role);
  if (!snapshot) return <main className="flex min-h-screen items-center justify-center bg-white text-emerald-950">{loadError ? <p className="rounded-xl border border-red-100 bg-red-50 px-5 py-4 text-red-700">{loadError}</p> : <div className="flex items-center gap-3"><Loader2 className="h-5 w-5 animate-spin text-emerald-600" />正在读取授权范围内的数据</div>}</main>;
  const trendData = snapshot.dailyAggregate.filter((row) => row.date >= "2026-09-01").map((row) => ({ ...row, date: `${Number(row.date.slice(5, 7))}/${Number(row.date.slice(8, 10))}` }));
  const metrics = metricsFor(snapshot, user.role);
  const headlineMetrics = user.role === "admin" ? metrics.slice(0, 4) : metrics;
  const conversionMetrics = user.role === "admin" ? metrics.filter((metric) => metric.group === "conversion") : [];
  const retentionMetrics = user.role === "admin" ? metrics.filter((metric) => metric.group === "retention") : [];
  const priorities = snapshot.customers.filter((row) => row.reasons.length > 0).slice(0, 4).map((row) => ({ customer: row.customerName, uid: row.uid, owner: row.consultant, tag: row.reasons[0], tone: row.priority === "立即关注" ? "danger" : row.priority === "重点跟进" ? "warning" : "info", detail: row.paid ? `付费¥${row.paymentTotal.toLocaleString()} · 正式期${row.postLaunchLessons.toLocaleString()}节` : `历史${row.analyzedLessons.toLocaleString()}节 · 近14天${row.last14Lessons.toLocaleString()}节` }));
  const visibleNavItems = user.role === "admin" ? navItems : navItems.filter((item) => !["数据更新", "数据质量", "系统设置"].includes(item.label));
  const attentionCount = snapshot.customers.filter((row) => row.reasons.length > 0).length;
  return (
    <TooltipProvider delayDuration={120}>
      <SidebarProvider defaultOpen className="h-dvh min-h-0 overflow-hidden">
        <Sidebar collapsible="icon" className="border-r border-emerald-950/10">
          <SidebarHeader className="border-b border-white/10 px-4 py-5">
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-400 text-emerald-950 shadow-[0_10px_24px_rgba(16,185,129,.2)]"><ShieldCheck className="h-5 w-5" /></div>
              <div className="min-w-0 group-data-[collapsible=icon]:hidden"><p className="truncate text-sm font-semibold text-white">AI教学风险监测</p><p className="mt-0.5 text-xs text-emerald-100/55">客户运营中心</p></div>
            </div>
          </SidebarHeader>
          <SidebarContent className="px-2 py-4">
            <SidebarGroup>
              <SidebarGroupLabel className="px-3 text-xs font-semibold tracking-[0.12em] text-emerald-100/40">工作台</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {visibleNavItems.map((item) => (
                    <SidebarMenuItem key={item.label}>
                      <SidebarMenuButton isActive={activePage === item.label} tooltip={item.label} onClick={() => setActivePage(item.label as PageKey)} className="h-11 rounded-xl px-3 text-emerald-50/70 hover:bg-white/8 hover:text-white data-[active=true]:bg-emerald-400 data-[active=true]:font-semibold data-[active=true]:text-emerald-950">
                        <item.icon className="h-[18px] w-[18px]" /><span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter className="border-t border-white/10 p-3">
            <button type="button" onClick={logout} title="退出登录" className="flex w-full items-center gap-3 rounded-xl border border-white/8 bg-white/5 p-3 text-left transition hover:bg-white/10 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-300/15 text-emerald-300"><Sparkles className="h-4 w-4" /></div>
              <div className="min-w-0 group-data-[collapsible=icon]:hidden"><p className="truncate text-sm font-medium text-white">{user.username}</p><p className="text-xs text-emerald-100/50">{user.role === "admin" ? "管理员" : user.consultantName} · 点击退出</p></div>
            </button>
          </SidebarFooter>
        </Sidebar>

        <SidebarInset className="h-dvh min-h-0 min-w-0 overflow-hidden bg-white">
          <header className="z-20 flex h-[72px] shrink-0 items-center justify-between border-b border-emerald-950/8 bg-white px-4 md:px-8">
            <div className="flex min-w-0 items-center gap-3"><SidebarTrigger className="text-emerald-800 hover:bg-emerald-50" /><div className="hidden h-5 w-px bg-emerald-950/10 sm:block" /><div className="min-w-0"><p className="truncate text-sm font-semibold text-emerald-950">{activePage}</p><p className="hidden text-xs text-slate-500 sm:block">数据截至 {snapshot.asOf}</p></div></div>
            <div className="flex items-center gap-2">
              <div className="relative hidden lg:block"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input disabled className="h-10 w-56 rounded-xl border-emerald-950/10 bg-emerald-50/50 pl-9" placeholder="请在客户页搜索" /></div>
              <Button variant="outline" size="sm" disabled={refreshing} onClick={() => { setLoadError(""); setRefreshing(true); setRefreshVersion(value => value + 1); }} title="读取最近发布的数据，不启动采集" className="h-10 rounded-xl border-emerald-950/10 bg-white text-emerald-800"><RefreshCw className="h-4 w-4" /><span className="hidden sm:inline">{refreshing ? "正在载入" : "重新载入"}</span></Button>
            </div>
          </header>

          <main ref={contentRef} data-dashboard-scroll className="mx-auto min-h-0 w-full max-w-[1580px] flex-1 space-y-6 overflow-y-auto overscroll-contain scrollbar-gutter-stable p-4 md:p-8">
            {snapshot.customers.some(customer=>customer.usageDataPending) && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">新增付费客户已纳入统计；其逐日使用数据待下次EEOS更新补齐，暂不判断未使用或低消耗。</p>}
            {activePage === "运营总览" ? <>
            <section className="flex flex-col gap-5 border-b border-emerald-950/8 pb-7 xl:flex-row xl:items-end xl:justify-between">
              <div><div className="mb-3 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" /><span className="text-xs font-semibold tracking-wide text-emerald-800">授权数据已载入</span></div><h1 className="text-3xl font-semibold tracking-[-0.045em] text-emerald-950 md:text-[2.35rem]">{user.role === "admin" ? "客户运营概览" : `${user.consultantName || user.username}的客户看板`}</h1><p className="mt-3 text-base text-slate-500">聚焦真实使用、付费转化和需要立即推进的客户。</p></div>
              <div className="flex flex-wrap gap-3 text-sm"><div className="min-w-32 rounded-2xl border border-emerald-950/10 bg-white px-4 py-3"><p className="text-xs text-slate-400">免费领额</p><p className="mt-1 text-lg font-semibold text-emerald-950">{snapshot.baselines.claimCount}<span className="ml-1 text-sm font-normal text-slate-400">家</span></p></div><div className="min-w-40 rounded-2xl bg-emerald-950 px-4 py-3 text-white"><p className="text-xs text-emerald-100/60">累计成功监测</p><p className="mt-1 text-lg font-semibold">{snapshot.baselines.totalLessons.toLocaleString()}<span className="ml-1 text-sm font-normal text-emerald-100/60">节</span></p></div></div>
            </section>

            <section><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold tracking-wide text-emerald-950">核心规模</h2><p className="text-xs text-slate-400">唯一UID口径</p></div><div className={`grid gap-4 sm:grid-cols-2 ${user.role === "admin" ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>{headlineMetrics.map((metric) => <MetricCard key={metric.label} metric={metric} />)}</div></section>

            {conversionMetrics.length > 0 && <section><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-sm font-semibold tracking-wide text-emerald-950">转化与留存</h2><p className="mt-1 text-xs text-slate-400">四项转化率独立计算；付费后使用单独观察留存。</p></div><div className="flex items-center gap-2 text-xs"><span className="rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-800">4 项转化率</span><span className="rounded-full bg-rose-50 px-2.5 py-1 font-medium text-rose-700">1 项留存率</span></div></div><Card className="overflow-hidden rounded-2xl border-emerald-950/10 bg-white p-0 shadow-[0_12px_35px_rgba(15,74,55,.045)]"><div className="grid md:grid-cols-4">{conversionMetrics.map((metric) => <ConversionMetric key={metric.label} metric={metric} />)}</div></Card>{retentionMetrics.map((metric) => <div key={metric.label} className="mt-3 flex flex-col gap-3 rounded-2xl border border-rose-200 bg-gradient-to-r from-rose-50 via-white to-white p-2 shadow-[0_10px_28px_rgba(225,29,72,.06)] md:flex-row md:items-center md:justify-between"><div className="px-3 pt-3 md:max-w-[48%] md:pt-0"><p className="text-xs font-semibold tracking-[0.1em] text-rose-700">付费后留存观察</p><p className="mt-1 text-sm leading-5 text-slate-600">付款后的继续使用与客户转化是两个独立问题，不纳入四项付费转化率。</p></div><div className="w-full md:w-[48%]"><ConversionMetric metric={metric} featured /></div></div>)}</section>}

            <section className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(380px,.9fr)]">
              <Card className="gap-3 rounded-2xl border-emerald-950/10 bg-white py-0 shadow-[0_12px_35px_rgba(15,74,55,.045)]">
                <CardHeader className="flex-row items-start justify-between border-b border-emerald-950/8 px-5 py-5 md:px-6">
                  <div><div className="flex items-center gap-2"><CardTitle className="text-base text-slate-900">每日成功监测课节</CardTitle><Tooltip><TooltipTrigger asChild><button aria-label="查看课节定义" className="text-slate-400 hover:text-slate-700"><HelpCircle className="h-4 w-4" /></button></TooltipTrigger><TooltipContent className="max-w-[300px] bg-slate-950 p-3 text-xs leading-5 text-white">每个成功完成监测的课节计1节，按课程发生日期汇总。失败、取消和最终返还的重跑不计入。</TooltipContent></Tooltip></div><p className="mt-1 text-sm text-slate-500">2026-09-01 至 {snapshot.asOf.slice(0, 10)} · {user.role === "admin" ? "全部在册客户" : "本人名下客户"}</p></div>
                  <Badge variant="outline" className="border-emerald-100 bg-emerald-50 text-emerald-700"><Activity className="h-3 w-3" /> 正式期</Badge>
                </CardHeader>
                <CardContent className="px-2 pb-4 pt-4 md:px-5"><div className="h-[290px] w-full"><ResponsiveContainer width="100%" height="100%"><AreaChart data={trendData} margin={{ top: 10, right: 12, left: -16, bottom: 0 }}><defs><linearGradient id="lessonsFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0b9f6e" stopOpacity={0.28} /><stop offset="100%" stopColor="#0b9f6e" stopOpacity={0.02} /></linearGradient></defs><CartesianGrid vertical={false} stroke="#e7efeb" strokeDasharray="3 5" /><XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: "#74857d", fontSize: 12 }} /><YAxis axisLine={false} tickLine={false} tick={{ fill: "#74857d", fontSize: 12 }} /><ChartTooltip cursor={{ stroke: "#0b9f6e", strokeDasharray: "4 4" }} contentStyle={{ borderRadius: 14, border: "1px solid #dfe9e4", boxShadow: "0 16px 30px rgba(15,74,55,.1)" }} formatter={(value) => [`${Number(value).toLocaleString()} 节`, "成功监测"]} /><Area type="monotone" dataKey="lessons" stroke="#0b9f6e" strokeWidth={2.5} fill="url(#lessonsFill)" activeDot={{ r: 5, strokeWidth: 3 }} /></AreaChart></ResponsiveContainer></div></CardContent>
              </Card>

              <Card className="gap-0 overflow-hidden rounded-2xl border-emerald-950 bg-emerald-950 py-0 text-white shadow-[0_18px_42px_rgba(7,59,43,.18)]">
                <CardHeader className="border-b border-white/10 px-5 py-5 md:px-6"><div className="flex items-center justify-between"><div><CardTitle className="flex items-center gap-2 text-base text-white"><AlertTriangle className="h-4 w-4 text-amber-400" />今日运营信号</CardTitle><p className="mt-1 text-sm text-slate-400">按客户价值、下降和转化机会综合排序</p></div><span className="rounded-lg bg-white/8 px-2.5 py-1 text-xs text-slate-300">{attentionCount} 个待关注</span></div></CardHeader>
                <CardContent className="space-y-3 px-4 py-4 md:px-5">{priorities.slice(0, 3).map((item, index) => <button key={item.uid} onClick={() => openCustomer(item.uid)} className="group flex w-full items-center gap-3 rounded-xl border border-white/8 bg-white/[0.05] p-3 text-left transition hover:border-emerald-300/30 hover:bg-white/[0.09]"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-300/15 text-sm font-semibold text-emerald-200">{String(index + 1).padStart(2, "0")}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-white">{item.customer}</span><span className="mt-0.5 block truncate text-xs text-emerald-100/55">{item.detail}</span></span><ChevronRight className="h-4 w-4 text-emerald-100/30 transition group-hover:translate-x-0.5 group-hover:text-emerald-300" /></button>)}<Button variant="ghost" onClick={() => setActivePage("待跟进客户")} className="mt-1 w-full justify-between rounded-xl text-emerald-100/70 hover:bg-white/8 hover:text-white">查看全部待跟进客户<ChevronRight className="h-4 w-4" /></Button></CardContent>
              </Card>
            </section>

            <Card className="gap-3 rounded-2xl border-emerald-950/10 bg-white py-0 shadow-[0_12px_35px_rgba(15,74,55,.045)]">
              <CardHeader className="border-b border-emerald-950/8 px-5 py-5 md:px-6"><div className="flex items-center gap-2"><CardTitle className="text-base text-emerald-950">每日风险总数</CardTitle><Tooltip><TooltipTrigger asChild><button aria-label="查看风险趋势定义" className="text-slate-400 hover:text-emerald-700"><HelpCircle className="h-4 w-4" /></button></TooltipTrigger><TooltipContent className="max-w-[340px] bg-emerald-950 p-3 text-xs leading-5 text-white">按课程发生日期汇总 EEOS 返回的 riskLessonCount。当前接口不提供逐日风险等级、已查看或误报，缺失值不代表零；顾问登录时仅汇总本人当前名下客户。</TooltipContent></Tooltip></div><p className="mt-1 text-sm text-slate-500">2026-09-01 至 {snapshot.asOf.slice(0, 10)} · 按课程发生日期 · 当天尚未结束</p></CardHeader>
              <CardContent className="px-2 pb-4 pt-4 md:px-5"><p className="mb-3 px-3 text-xs leading-5 text-amber-700">显示 EEOS 实际返回的每日风险总数。逐日风险等级、已查看、误报：当前接口未提供，不按 0 展示。</p><div className="h-[320px] w-full"><ResponsiveContainer width="100%" height="100%"><AreaChart data={trendData} margin={{ top: 10, right: 12, left: -16, bottom: 0 }}><CartesianGrid vertical={false} stroke="#e7efeb" strokeDasharray="3 5" /><XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: "#74857d", fontSize: 12 }} /><YAxis axisLine={false} tickLine={false} tick={{ fill: "#74857d", fontSize: 12 }} /><ChartTooltip contentStyle={{ borderRadius: 14, border: "1px solid #dfe9e4", boxShadow: "0 16px 30px rgba(15,74,55,.1)" }} formatter={(value, name) => [`${Number(value).toLocaleString()} 节`, name]} /><Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} /><Area type="linear" name="风险总数" dataKey="risk" connectNulls={false} isAnimationActive={false} stroke="#0b9f6e" fill="#0b9f6e18" strokeWidth={2.2} /></AreaChart></ResponsiveContainer></div></CardContent>
            </Card>

            <Card className="gap-0 overflow-hidden rounded-2xl border-emerald-950/10 bg-white py-0 shadow-[0_12px_35px_rgba(15,74,55,.045)]">
              <CardHeader className="flex-row items-center justify-between border-b border-emerald-950/8 px-5 py-5 md:px-6"><div><CardTitle className="text-base text-emerald-950">优先跟进客户</CardTitle><p className="mt-1 text-sm text-slate-500">一个客户可同时命中多个运营原因</p></div><Button variant="outline" size="sm" className="rounded-xl border-emerald-950/10 text-emerald-800 hover:bg-emerald-50" onClick={() => setActivePage("待跟进客户")}>查看完整列表</Button></CardHeader>
              <Table><TableHeader><TableRow className="bg-emerald-50/50 hover:bg-emerald-50/50"><TableHead className="h-11 pl-5 text-slate-500 md:pl-6">客户</TableHead><TableHead className="text-slate-500">顾问</TableHead><TableHead className="text-slate-500">主要原因</TableHead><TableHead className="text-slate-500">触发依据</TableHead><TableHead className="pr-5 text-right text-slate-500 md:pr-6">操作</TableHead></TableRow></TableHeader><TableBody>{priorities.map((item) => <TableRow key={item.uid} className="h-[66px] border-emerald-950/8"><TableCell className="pl-5 md:pl-6"><p className="font-medium text-emerald-950">{item.customer}</p><p className="mt-0.5 text-xs text-slate-400">UID {item.uid}</p></TableCell><TableCell className="text-slate-600">{item.owner}</TableCell><TableCell><StatusBadge tone={item.tone}>{item.tag}</StatusBadge></TableCell><TableCell className="text-slate-500">{item.detail}</TableCell><TableCell className="pr-5 text-right md:pr-6"><Button variant="ghost" size="sm" onClick={() => openCustomer(item.uid)} className="rounded-lg text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800">查看客户</Button></TableCell></TableRow>)}</TableBody></Table>
            </Card>
            </> : <Suspense fallback={<div className="flex items-center gap-2 p-6 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />正在打开页面</div>}><SecondaryPage page={activePage} selectedUid={selectedUid} onOpenCustomer={openCustomer} snapshot={snapshot} readOnly={user.role === "consultant"} /></Suspense>}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}

export default function Home() {
  return <AuthGate>{(user) => <Dashboard user={user} />}</AuthGate>;
}
