"use client";
import { IdentitySettings } from './identity-settings';
import { consultantOptions } from "@/lib/consultant-options";
import { useBoundedFetch } from "@/lib/bounded-fetch";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle, CheckCircle2, ChevronRight, Database,
  FileSpreadsheet, HelpCircle, Loader2, MessageSquareText, Play,
  RefreshCw, Save, Search, UploadCloud, Users,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";

import type { Customer, CustomerDaily, DashboardSnapshot } from "./dashboard-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type PageKey = "运营总览" | "待跟进客户" | "客户主数据" | "客户详情与日志" | "数据更新" | "数据质量" | "系统设置";
const number = new Intl.NumberFormat("zh-CN");
const aiCredits = (lessons: number | null) => lessons === null ? "待补齐" : number.format(lessons * 50) + " AI额度";
const currency = new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 0 });

const priorityStyle: Record<string, string> = {
  "立即关注": "border-red-200 bg-red-50 text-red-700",
  "重点跟进": "border-amber-200 bg-amber-50 text-amber-700",
  "持续观察": "border-emerald-200 bg-emerald-50 text-emerald-700",
  "常规": "border-slate-200 bg-slate-50 text-slate-600",
};

function PriorityBadge({ value }: { value: string }) {
  return <Badge variant="outline" className={`rounded-md ${priorityStyle[value] ?? priorityStyle["常规"]}`}>{value}</Badge>;
}

function ReasonBadges({ reasons, limit = 2 }: { reasons: string[]; limit?: number }) {
  if (!reasons.length) return <span className="text-sm text-slate-400">暂无异常</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {reasons.slice(0, limit).map((reason) => <Badge key={reason} variant="secondary" className="rounded-md bg-slate-100 text-slate-700">{reason}</Badge>)}
      {reasons.length > limit && <Badge variant="outline" className="rounded-md text-slate-500">+{reasons.length - limit}</Badge>}
    </div>
  );
}

function PageTitle({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div><h1 className="text-2xl font-semibold tracking-[-0.035em] text-emerald-950">{title}</h1><p className="mt-1.5 text-sm text-slate-500">{description}</p></div>
      {action}
    </div>
  );
}

function MetricHelp({label, description}: {label:string; description:string}) {
  return <Tooltip><TooltipTrigger asChild><button type="button" aria-label={label + '定义'} className="inline-flex items-center gap-1 text-left">{label}<HelpCircle className="h-3.5 w-3.5 shrink-0 text-slate-400" /></button></TooltipTrigger><TooltipContent className="max-w-xs whitespace-normal p-3 text-xs leading-5">{description}</TooltipContent></Tooltip>;
}
function QuotaStatus({customer}: {customer:Customer}) {
  const incomplete=customer.theoreticalNet<0;
  const explanation=incomplete
    ? '按已知入账和每课节50 AI额度计算仍无法对账。购买规则已确认：每元100 AI额度，单笔不足10000元赠送50%，达到10000元赠送100%。尚未取得平台期初AI额度、实际到账、额外赠送、人工调整、过期与扣减流水，无法确定缺失哪一项。不代表欠费、余额为负或AI额度不足。'
    : '购买和消耗规则已确认，但未取得平台实际AI额度余额和完整流水。规则计算的应获AI额度不等于实际余额，暂不展示可用AI额度，也不用于判断续费。';
  return <MetricHelp label={incomplete?'来源不完整':'余额待核验'} description={explanation} />;
}
function offsetDate(date:string, offset:number) { return new Date(Date.parse(date+'T00:00:00Z')+offset*86400000).toISOString().slice(0,10); }

function Followups({ snapshot, onOpenCustomer }: { snapshot: DashboardSnapshot; onOpenCustomer: (uid: string) => void }) {
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  const [priority, setPriority] = useState("全部优先级");
  const [focus, setFocus] = useState("全部跟进方向");
  const [consultant, setConsultant] = useState("全部顾问");
  const rows = useMemo(() => snapshot.customers.filter((customer) => {
    const matchesQuery = `${customer.customerName}${customer.uid}${customer.eeoAccountName}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (focus === "全部跟进方向" || customer.holidayFollowup === focus) && (priority === "全部优先级" || customer.priority === priority) && (consultant === "全部顾问" || (customer.consultantJobNumber ?? "unassigned") === consultant) && customer.reasons.length > 0;
  }), [snapshot.customers, query, priority, consultant, focus]);
  const completeTo=snapshot.usageFocus?.completeTo ?? offsetDate(snapshot.asOf.slice(0,10),-1);
  const recent7From=offsetDate(completeTo,-6), recent14From=offsetDate(completeTo,-13);

  return (
    <div className="space-y-5">
      <PageTitle title="待跟进客户" description={snapshot.usageFocus?.description ?? "同一客户可以命中多个原因，排序同时考虑价值、使用下降、转化机会和AI额度紧迫度。"} action={<div className="rounded-xl border border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700"><strong>{snapshot.customers.filter((row) => row.priority === "立即关注").length}</strong> 个立即关注</div>} />
      <Card className="gap-4 rounded-2xl border-emerald-950/10 py-4 shadow-none">
        <CardContent className="flex flex-col flex-wrap gap-3 px-4 md:flex-row md:items-center">
          <div className="relative min-w-[220px] flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} className="rounded-xl pl-9" placeholder="搜索客户、UID或EEO账号名" /></div>
          {snapshot.usageFocus && <NativeSelect value={focus} onChange={(event) => { setFocus(event.target.value); setPage(0); }} className="w-full rounded-xl md:w-48"><NativeSelectOption>全部跟进方向</NativeSelectOption><NativeSelectOption>高消耗需求跟进</NativeSelectOption><NativeSelectOption>充值低消耗排查</NativeSelectOption></NativeSelect>}
          <NativeSelect value={priority} onChange={(event) => { setPriority(event.target.value); setPage(0); }} className="w-full rounded-xl md:w-40"><NativeSelectOption>全部优先级</NativeSelectOption>{["立即关注", "重点跟进", "持续观察", "常规"].map((item) => <NativeSelectOption key={item}>{item}</NativeSelectOption>)}</NativeSelect>
          <NativeSelect value={consultant} onChange={(event) => { setConsultant(event.target.value); setPage(0); }} className="w-full rounded-xl md:w-40"><NativeSelectOption>全部顾问</NativeSelectOption>{consultantOptions(snapshot.customers).map((item) => <NativeSelectOption key={item.value} value={item.value}>{item.label}</NativeSelectOption>)}</NativeSelect>
        </CardContent>
      </Card>
      <Card className="gap-0 overflow-hidden rounded-2xl border-emerald-950/10 py-0 shadow-[0_10px_30px_rgba(15,74,55,.04)]">
        <div className="overflow-x-auto">
          <Table className="min-w-[1360px] table-fixed [&_th]:whitespace-normal"><colgroup><col className="w-[115px]" /><col className="w-[190px]" /><col className="w-[90px]" /><col className="w-[300px]" />{snapshot.usageFocus && <col className="w-[165px]" />}<col className="w-[145px]" /><col className="w-[125px]" /><col className="w-[145px]" /><col className="w-[85px]" /></colgroup><TableHeader><TableRow className="border-emerald-950/10 bg-emerald-50/50 hover:bg-emerald-50/50"><TableHead className="pl-5">优先级</TableHead><TableHead>客户</TableHead><TableHead>顾问</TableHead><TableHead>原因</TableHead>{snapshot.usageFocus && <TableHead><MetricHelp label="本期 / 上期AI额度消耗" description={`本期：${snapshot.usageFocus.holidayFrom} 至 ${snapshot.usageFocus.holidayTo}；上一期：${snapshot.usageFocus.previousFrom} 至 ${snapshot.usageFocus.previousTo}。两段各7天的AI额度消耗（成功监测课节×50 AI额度），互不重叠；不含采集当天。`} /></TableHead>}<TableHead><MetricHelp label="最近7天 / 14天AI额度消耗" description={`均截至最近完整日 ${completeTo}。7天：${recent7From} 至 ${completeTo}；14天：${recent14From} 至 ${completeTo}。14天包含这7天，两数不能相加。单位为AI额度，按成功监测课节×50计算，不是金额或活跃天数。`} /></TableHead><TableHead><MetricHelp label="历史7日峰值" description="在已有逐日使用数据中，任意连续7个自然日的成功监测课节合计的最大值，不是某一天的峰值。" /></TableHead><TableHead>AI额度核验状态</TableHead><TableHead className="pr-5 text-right">操作</TableHead></TableRow></TableHeader><TableBody>
            {rows.slice(page * 25, (page + 1) * 25).map((customer) => <TableRow key={customer.uid} className="h-[70px] border-emerald-950/8"><TableCell className="pl-5"><PriorityBadge value={customer.priority} /><p className="mt-1 text-xs text-slate-400">{customer.score}分</p></TableCell><TableCell className="whitespace-normal break-words"><p className="font-medium text-emerald-950">{customer.customerName}</p><p className="mt-0.5 text-xs text-slate-400">UID {customer.uid}</p></TableCell><TableCell className="text-slate-600">{customer.consultant}</TableCell><TableCell className="whitespace-normal break-words align-top py-4"><div className="w-full min-w-0 max-w-[284px]"><ReasonBadges reasons={customer.reasons} />{customer.followupAction && <p className="mt-2 text-xs leading-5 text-slate-500">{customer.followupAction}</p>}</div></TableCell>{snapshot.usageFocus && <TableCell className="whitespace-normal"><p className="font-semibold text-emerald-800">本期 {aiCredits(customer.usageDataPending ? null : customer.holidayLessons ?? 0)}</p><p className="mt-1 text-sm text-slate-600">上期 {aiCredits(customer.usageDataPending ? null : customer.previousHolidayWeekLessons ?? 0)}</p><p className="text-xs text-slate-400">期间活跃 {customer.usageDataPending ? "待补齐" : `${customer.holidayActiveDays ?? 0} 天`}</p></TableCell>}<TableCell className="whitespace-normal"><p className="font-medium text-slate-800">7天 {aiCredits(customer.usageDataPending ? null : customer.last7Lessons)}</p><p className="mt-1 text-sm text-slate-600">14天 {aiCredits(customer.usageDataPending ? null : customer.last14Lessons)}</p><p className="text-xs text-slate-400">按每课节50 AI额度</p></TableCell><TableCell>{customer.usageDataPending ? "待补齐" : `${number.format(customer.maxRolling7Lessons)}节`}</TableCell><TableCell className="whitespace-normal text-slate-600"><QuotaStatus customer={customer} /></TableCell><TableCell className="pr-5 text-right"><Button variant="ghost" size="sm" className="text-emerald-700 hover:bg-emerald-50" onClick={() => onOpenCustomer(customer.uid)}>查看 <ChevronRight className="h-4 w-4" /></Button></TableCell></TableRow>)}
          </TableBody></Table>
        </div>
        <div className="border-t border-slate-100 px-5 py-3 text-sm text-slate-500">当前筛选结果 {rows.length} 个客户，每页25个。</div>
      </Card>
      <div className="flex items-center gap-3"><Button disabled={page === 0} onClick={() => setPage(page - 1)}>上一页</Button><span>第 {page + 1} 页 · 共 {rows.length} 条 · 每页25条</span><Button disabled={(page + 1) * 25 >= rows.length} onClick={() => setPage(page + 1)}>下一页</Button></div>
    </div>
  );
}

function CustomerMaster({ snapshot, onOpenCustomer, readOnly }: { snapshot: DashboardSnapshot; onOpenCustomer: (uid: string) => void; readOnly: boolean }) {
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  const [consultant, setConsultant] = useState("全部顾问");
  const rows = useMemo(() => snapshot.customers.filter((customer) => `${customer.customerName}${customer.uid}${customer.eeoAccountName}`.toLowerCase().includes(query.toLowerCase()) && (consultant === "全部顾问" || (customer.consultantJobNumber ?? "unassigned") === consultant)), [snapshot.customers, query, consultant]);
  return (
    <div className="space-y-5">
      <PageTitle title="客户主数据" description="以UID为唯一主键查看客户身份、当前归属、领额、付费和使用状态。" action={!readOnly ? <Button disabled className="rounded-xl"><Users className="h-4 w-4" /> 编辑接入中</Button> : undefined} />
      <Card className="gap-4 rounded-2xl border-emerald-950/10 py-4 shadow-none"><CardContent className="flex flex-col gap-3 px-4 md:flex-row"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} className="rounded-xl pl-9" placeholder="搜索客户、UID或EEO账号名" /></div><NativeSelect value={consultant} onChange={(event) => { setConsultant(event.target.value); setPage(0); }} className="w-full rounded-xl md:w-44"><NativeSelectOption>全部顾问</NativeSelectOption>{consultantOptions(snapshot.customers).map((item) => <NativeSelectOption key={item.value} value={item.value}>{item.label}</NativeSelectOption>)}</NativeSelect></CardContent></Card>
      <Card className="gap-0 overflow-hidden rounded-2xl border-emerald-950/10 py-0 shadow-[0_10px_30px_rgba(15,74,55,.04)]"><div className="overflow-x-auto"><Table className="min-w-[1080px]"><TableHeader><TableRow className="border-emerald-950/10 bg-emerald-50/50 hover:bg-emerald-50/50"><TableHead className="pl-5">客户</TableHead><TableHead>EEO账号名</TableHead><TableHead>当前顾问</TableHead><TableHead>来源</TableHead><TableHead>免费领额</TableHead><TableHead>付费</TableHead><TableHead>最后使用</TableHead><TableHead className="pr-5 text-right">操作</TableHead></TableRow></TableHeader><TableBody>
        {rows.slice(page * 25, (page + 1) * 25).map((customer) => <TableRow key={customer.uid} className="h-[66px] border-emerald-950/8"><TableCell className="pl-5"><p className="font-medium text-emerald-950">{customer.customerName}</p><p className="text-xs text-slate-400">UID {customer.uid}</p></TableCell><TableCell className={customer.eeoAccountName ? "text-slate-700" : "text-amber-600"}>{customer.eeoAccountName || "确认从缺"}</TableCell><TableCell>{customer.consultant}</TableCell><TableCell><div className="flex gap-1">{customer.trial && <Badge variant="outline">试用</Badge>}{customer.claim && <Badge variant="outline">领额</Badge>}</div></TableCell><TableCell>{customer.claim ? customer.claimDate : "—"}</TableCell><TableCell>{customer.paid ? currency.format(customer.paymentTotal) : "—"}</TableCell><TableCell>{customer.lastUsage || "尚未使用"}</TableCell><TableCell className="pr-5 text-right"><Button variant="ghost" size="sm" className="text-emerald-700 hover:bg-emerald-50" onClick={() => onOpenCustomer(customer.uid)}>详情</Button></TableCell></TableRow>)}
      </TableBody></Table></div><div className="border-t border-slate-100 px-5 py-3 text-sm text-slate-500">共 {rows.length} 个UID；同一现实机构的不同UID分别管理。</div></Card>
      <div className="flex items-center gap-3"><Button disabled={page === 0} onClick={() => setPage(page - 1)}>上一页</Button><span>第 {page + 1} 页 · 共 {rows.length} 条 · 每页25条</span><Button disabled={(page + 1) * 25 >= rows.length} onClick={() => setPage(page + 1)}>下一页</Button></div>
    </div>
  );
}

function CustomerDetail({ uid, snapshot, readOnly }: { uid: string; snapshot: DashboardSnapshot; readOnly: boolean }) {
  const request = useBoundedFetch();
  const [selectedUid, setSelectedUid] = useState(uid);
  const [logText, setLogText] = useState("");
  const [logType, setLogType] = useState("跟进记录");
  const [recordTime, setRecordTime] = useState(() => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 16);
  });
  const [logs, setLogs] = useState<Array<{ id: number; type: string; recordTime: string; content: string; createdByName: string; createdAt: string }>>([]);
  const [logLoading, setLogLoading] = useState(false);
  const [logSaving, setLogSaving] = useState(false);
  const [logError, setLogError] = useState("");
  const customer = snapshot.customers.find((row) => row.uid === selectedUid) ?? snapshot.customers[0];
  const [daily, setDaily] = useState<CustomerDaily[]>([]);
  const chartData = daily.filter((row) => row.uid === customer.uid && row.date >= "2026-08-18").slice(-45).map((row) => ({ ...row, date: row.date.slice(5) }));
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const loadLogs = async () => {
      setLogLoading(true);
      setLogError("");
      try {
        const trend = await request(`/api/dashboard?uid=${encodeURIComponent(customer.uid)}`, { cache: "no-store", signal: controller.signal });
        if (!trend.ok) throw new Error("客户趋势读取失败");
        const trendPayload = await trend.json() as { customerDaily: CustomerDaily[] };
        if (!cancelled) setDaily(trendPayload.customerDaily);
        const response = await request(`/api/customer-logs?uid=${encodeURIComponent(customer.uid)}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json() as { logs?: typeof logs; error?: string };
        if (!response.ok) throw new Error(payload.error || "日志读取失败");
        if (!cancelled) setLogs(payload.logs ?? []);
      } catch (reason) {
        if (!cancelled) setLogError(reason instanceof Error ? reason.message : "日志读取失败");
      } finally {
        if (!cancelled) setLogLoading(false);
      }
    };
    void loadLogs();
    return () => { cancelled = true; controller.abort(); };
  }, [customer.uid, request]);
  const addLog = async () => {
    if (!logText.trim()) return;
    setLogSaving(true);
    setLogError("");
    try {
      const response = await request("/api/customer-logs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uid: customer.uid, type: logType, recordTime: new Date(recordTime).toISOString(), content: logText.trim() }) });
      const payload = await response.json() as { id?: number; error?: string };
      if (!response.ok || !payload.id) throw new Error(payload.error || "日志保存失败");
      setLogs((current) => [{ id: payload.id!, type: logType, recordTime: new Date(recordTime).toISOString(), content: logText.trim(), createdByName: "管理员", createdAt: new Date().toISOString() }, ...current].slice(0, 50));
      setLogText("");
    } catch (reason) {
      setLogError(reason instanceof Error ? reason.message : "日志保存失败");
    } finally {
      setLogSaving(false);
    }
  };
  return (
    <div className="space-y-5">
      <PageTitle title="客户详情与简单日志" description="查看客户完整经营时间线、使用趋势、风险汇总和管理员跟进记录。" action={<NativeSelect value={selectedUid} onChange={(event) => setSelectedUid(event.target.value)} className="w-[280px] rounded-xl">{snapshot.customers.map((row) => <NativeSelectOption key={row.uid} value={row.uid}>{row.customerName} · {row.uid}</NativeSelectOption>)}</NativeSelect>} />
      {snapshot.usageFocus && <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4 text-sm"><p className="font-semibold text-emerald-950">{snapshot.usageFocus?.periodLabel ?? "十一"}消耗 {aiCredits(customer.usageDataPending ? null : customer.holidayLessons ?? 0)} · 前周 {aiCredits(customer.usageDataPending ? null : customer.previousHolidayWeekLessons ?? 0)} · {customer.holidayFollowup || "常规观察"}</p>{customer.followupAction && <p className="mt-2 leading-6 text-slate-600">{customer.followupAction}</p>}<p className="mt-2 text-xs text-slate-500">成功监测量和每日风险总数已更新；当前接口不提供逐日风险等级、已查看、误报，缺失值不按零展示。</p></div>}
      <Card className="gap-0 overflow-hidden border-slate-200 py-0"><div className="grid lg:grid-cols-[1.4fr_1fr]"><div className="p-5 md:p-6"><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-semibold text-slate-950">{customer.customerName}</h2><PriorityBadge value={customer.priority} /></div><p className="mt-1 text-sm text-slate-500">UID {customer.uid} · EEO账号名：{customer.eeoAccountName || "确认从缺"}</p><div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4"><Info label="当前顾问" value={customer.consultant} /><Info label="历史监测" value={`${number.format(customer.analyzedLessons)}节`} /><Info label="累计支付金额（元）" value={currency.format(customer.paymentTotal)} /><Info label="最后使用" value={customer.lastUsage || "尚未使用"} /></div></div><div className="border-t border-slate-200 bg-slate-50 p-5 lg:border-l lg:border-t-0"><p className="text-sm font-medium text-slate-700">当前运营信号</p><div className="mt-3"><ReasonBadges reasons={customer.reasons} limit={8} /></div><p className="mt-4 text-xs leading-5 text-slate-500">优先级分数 {customer.score}；所有原因均展示触发依据，AI额度流水尚未核实；旧估算为负不代表欠费，也不用于AI额度不足或续费判断。</p></div></div></Card>
      <Card className="border-emerald-100 bg-emerald-50/40"><CardHeader><CardTitle className="text-base">购买获得与使用消耗（AI额度）</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2"><Info label="基础购买AI额度" value={customer.purchasedAiCredits == null ? "订单明细待核对" : number.format(customer.purchasedAiCredits)+" AI额度"} /><Info label="促销赠送AI额度" value={customer.bonusAiCredits == null ? "订单明细待核对" : number.format(customer.bonusAiCredits)+" AI额度"} /><Info label="购买应获得AI额度（含赠送）" value={customer.paidAiCredits == null ? "订单明细待核对" : number.format(customer.paidAiCredits)+" AI额度"} /><Info label="正式期消耗AI额度" value={aiCredits(customer.postLaunchLessons)} /><p className="sm:col-span-2 text-xs leading-5 text-slate-500">每笔订单独立计算：1元购买100 AI额度；不足10,000元赠送50%，达到10,000元赠送100%。每成功监测课节消耗50 AI额度。应获得AI额度不代表平台实际到账或当前余额。</p></CardContent></Card>
      <Tabs defaultValue="usage" className="gap-4"><TabsList><TabsTrigger value="usage">使用与风险</TabsTrigger><TabsTrigger value="timeline">客户历程</TabsTrigger><TabsTrigger value="logs">简单日志</TabsTrigger></TabsList>
        <TabsContent value="usage"><Card className="gap-3 border-emerald-950/10 py-0"><CardHeader className="border-b border-emerald-950/8 px-5 py-5"><CardTitle className="text-base text-emerald-950">每日监测与风险课节</CardTitle><p className="text-xs leading-5 text-slate-500">两张图日期相同、纵轴独立，均从0开始。风险图放大刻度便于观察；不能直接比较两条曲线的高度。</p></CardHeader><CardContent className="space-y-6 px-3 py-5 md:px-5">{[{key:"lessons",label:"成功监测课节",color:"#0b9f6e"},{key:"risk",label:"风险课节",color:"#d97706"}].map(metric=><div key={metric.key}><p className="mb-2 px-3 text-sm font-medium text-slate-700">{metric.label}（节）</p><div className="h-[220px]"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} syncId="customer-usage-risk" margin={{top:8,right:12,left:-12,bottom:0}}><CartesianGrid vertical={false} stroke="#e7efeb" strokeDasharray="3 5" /><XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fontSize:12,fill:"#74857d"}} /><YAxis domain={[0,"auto"]} allowDecimals={false} axisLine={false} tickLine={false} tick={{fontSize:12,fill:"#74857d"}} /><ChartTooltip formatter={(value)=>[`${number.format(Number(value))} 节`,metric.label]} /><Area type="linear" name={metric.label} dataKey={metric.key} stroke={metric.color} fill={metric.color+"18"} strokeWidth={2} isAnimationActive={false} connectNulls={false} /></AreaChart></ResponsiveContainer></div></div>)}</CardContent></Card></TabsContent>
        <TabsContent value="timeline"><Card className="border-slate-200"><CardContent className="space-y-5 px-6"><Timeline date={customer.claimDate || "—"} title={customer.claim ? "领取免费AI额度" : "未领取免费AI额度"} detail={customer.claim ? "领取2,000 AI额度" : "当前无领取记录"} /><Timeline date={customer.paymentDate || "—"} title={customer.paid ? "付费到账" : "尚未付费"} detail={customer.paid ? `支付金额${currency.format(customer.paymentTotal)}；付款后消耗${aiCredits(customer.usageDataPending ? null : customer.lessonsAfterPayment)}（监测${number.format(customer.lessonsAfterPayment)}课节）` : "当前无到账记录"} /><Timeline date={customer.lastUsage || "—"} title="最近使用" detail={`历史累计${number.format(customer.analyzedLessons)}节，正式期${number.format(customer.postLaunchLessons)}节`} /></CardContent></Card></TabsContent>
        <TabsContent value="logs"><div className={`grid gap-5 ${readOnly ? "" : "lg:grid-cols-[1fr_1.2fr]"}`}>{!readOnly && <Card className="border-slate-200"><CardHeader><CardTitle className="text-base">新增记录</CardTitle></CardHeader><CardContent className="space-y-3"><NativeSelect value={logType} onChange={(event) => setLogType(event.target.value)} className="w-full rounded-xl"><NativeSelectOption>跟进记录</NativeSelectOption><NativeSelectOption>客户反馈</NativeSelectOption></NativeSelect><Input type="datetime-local" value={recordTime} onChange={(event) => setRecordTime(event.target.value)} className="rounded-xl" /><Textarea value={logText} onChange={(event) => setLogText(event.target.value)} className="min-h-32 rounded-xl" placeholder="记录客户反馈或跟进内容" />{logError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{logError}</p>}<Button onClick={() => void addLog()} disabled={logSaving} className="w-full rounded-xl"><Save className="h-4 w-4" /> {logSaving ? "保存中…" : "保存记录"}</Button></CardContent></Card>}<Card className="border-slate-200"><CardHeader><CardTitle className="text-base">历史记录{readOnly ? "（只读）" : ""}</CardTitle></CardHeader><CardContent>{logLoading ? <div className="flex min-h-52 items-center justify-center text-sm text-slate-400">正在读取日志…</div> : logs.length ? <div className="space-y-3">{logs.map((log) => <div key={log.id} className="rounded-xl border border-slate-200 p-4"><div className="flex items-center justify-between"><Badge variant="outline">{log.type}</Badge><span className="text-xs text-slate-400">{new Date(log.recordTime).toLocaleString("zh-CN", { hour12: false })}</span></div><p className="mt-3 text-sm leading-6 text-slate-700">{log.content}</p><p className="mt-2 text-xs text-slate-400">创建人：{log.createdByName} · 系统创建 {new Date(log.createdAt).toLocaleString("zh-CN", { hour12: false })}</p></div>)}</div> : <div className="flex min-h-52 flex-col items-center justify-center text-center text-slate-400"><MessageSquareText className="h-8 w-8" /><p className="mt-3 text-sm">暂无日志。</p></div>}</CardContent></Card></div></TabsContent>
      </Tabs>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) { return <div><p className="text-xs text-slate-400">{label}</p><p className="mt-1 text-sm font-semibold text-slate-800">{value}</p></div>; }
function Timeline({ date, title, detail }: { date: string; title: string; detail: string }) { return <div className="grid grid-cols-[100px_16px_1fr] gap-3"><span className="pt-0.5 text-sm text-slate-400">{date}</span><span className="mt-1 h-3 w-3 rounded-full border-[3px] border-emerald-100 bg-emerald-500" /><div><p className="font-medium text-slate-800">{title}</p><p className="mt-1 text-sm text-slate-500">{detail}</p></div></div>; }

function DataQuality({ snapshot }: { snapshot: DashboardSnapshot }) {
  const incomplete=snapshot.customers.filter(customer=>customer.theoreticalNet<0).length;
  const paid=snapshot.customers.filter(customer=>customer.paid);
  const completePurchases=paid.every(customer=>customer.paidAiCredits!=null);
  const totalPaidCredits=paid.reduce((sum,customer)=>sum+(customer.paidAiCredits??0),0);
  const missing=[{key:"low" as const,label:"逐日低 / 中 / 高风险课节"},{key:"reviewed" as const,label:"逐日已查看风险课节"},{key:"falsePositive" as const,label:"逐日误报课节"}].map(metric=>({...metric,days:snapshot.dailyAggregate.filter(row=>row[metric.key]===null)}));
  return <div className="space-y-5"><PageTitle title="数据质量与更新时间" description="EEO消耗数据与CRM订单数据分开记录；失败批次不会覆盖各自最后一次成功数据。" /><section className="grid gap-4 md:grid-cols-3"><QualityCard icon={CheckCircle2} title="EEO消耗数据截至" value={snapshot.asOf} tone="green" /><QualityCard icon={Database} title="CRM订单数据截至" value="2026-09-21 10:00" tone="blue" /><QualityCard icon={AlertCircle} title="未提供的逐日指标" value={missing.some(metric=>metric.days.length)?"风险等级、已查看、误报":"已有日期均完整"} tone="amber" /></section>
    <Card className="border-slate-200"><CardHeader><CardTitle className="text-base">具体缺失项与影响范围</CardTitle><p className="text-sm leading-6 text-slate-500">成功监测课节和每日风险总数已对账。下面列出的指标在当前汇总接口中未提供，不能用累计值反推每天，也不能补成0。</p></CardHeader><CardContent className="space-y-3">{missing.map(metric=><div key={metric.key} className="rounded-xl border border-amber-100 bg-amber-50/50 p-4"><p className="font-medium text-slate-800">{metric.label}</p><p className="mt-1 text-sm leading-6 text-slate-600">{metric.days.length?<>缺失日期：{metric.days[0].date} 至 {metric.days.at(-1)!.date}，共 {metric.days.length} 天（当前账号可见客户的汇总）。历史已验证值保留，缺失日期显示为空。</>:"已有日期没有空缺。"}</p></div>)}</CardContent></Card>
    <Card className="border-slate-200"><CardHeader><CardTitle className="text-base">AI额度数据待核验</CardTitle></CardHeader><CardContent className="space-y-4 text-sm leading-6 text-slate-600"><div className="grid gap-4 sm:grid-cols-2"><Info label="平台实际AI额度余额 / 入账总额" value="未取得，不展示估算数值" /><Info label="按已核对订单应获得AI额度（含赠送）" value={completePurchases ? number.format(totalPaidCredits)+" AI额度" : "订单明细待核对"} /><Info label="正式期消耗AI额度" value={aiCredits(snapshot.baselines.postLaunchLessons)} /><Info label="旧估算无法对账的客户" value={String(incomplete)+" 个（当前账号可见范围）"} /></div><p>尚未取得：期初AI额度、逐笔充值到账、实际赠送、人工调整、过期和扣减流水。目前无法确认具体缺了哪一笔，也无法据此判断欠费或余额不足。</p><p>购买规则现已由业务确认：标准价1元购买100 AI额度；每笔订单不足10,000元赠送50%，达到10,000元赠送100%。每成功监测课节消耗50 AI额度。金额与AI额度分别显示，应获AI额度与平台实际余额分别标注。此前21,744,000的单位是AI额度（包含购买、赠送及免费领额），不是元，也不是平台实际余额。</p></CardContent></Card>
  </div>;
}

function QualityCard({ icon: Icon, title, value, tone }: { icon: typeof Database; title: string; value: string; tone: string }) { const color = tone === "green" ? "bg-emerald-50 text-emerald-600" : tone === "amber" ? "bg-amber-50 text-amber-600" : "bg-teal-50 text-teal-700"; return <Card className="gap-3 border-emerald-950/10 py-5"><CardContent className="flex items-center gap-4 px-5"><div className={`rounded-xl p-3 ${color}`}><Icon className="h-5 w-5" /></div><div><p className="text-sm text-slate-500">{title}</p><p className="mt-1 font-semibold text-emerald-950">{value}</p></div></CardContent></Card>; }

type RefreshRun = {
  id: number;
  source: "eeo" | "crm";
  trigger: string;
  status: string;
  dataAsOf: string | null;
  rowCount: number;
  fileName: string | null;
  errorMessage: string;
  startedAt: string;
  finishedAt: string | null;
  summary: Record<string, unknown>;
};

type RefreshState = {
  schedule: { timezone: string; weekday: number; time: string; startupCatchup: boolean; crmMode: string };
  initialEeoAsOf: string;
  initialCrmAsOf: string;
  sourceMetadata?: { eeo?: { capturedAt?: string; dataAsOf?: string }; crm?: { dataAsOf?: string; checkedAt?: string; status?: string } };
  sync?: { mode: string; configured: boolean };
  crmSummary: { rowCount: number; amountCents: number; unmappedCount: number };
  runs: RefreshRun[];
};

const runStatus: Record<string, { label: string; className: string }> = {
  running: { label: "运行中", className: "border-blue-200 bg-blue-50 text-blue-700" },
  waiting_for_login: { label: "等待登录验证", className: "border-amber-200 bg-amber-50 text-amber-700" },
  validating: { label: "校验中", className: "border-violet-200 bg-violet-50 text-violet-700" },
  success: { label: "成功", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  success_with_warnings: { label: "成功，有待处理项", className: "border-amber-200 bg-amber-50 text-amber-700" },
  failed: { label: "失败", className: "border-red-200 bg-red-50 text-red-700" },
};

function SourceBadge({ status }: { status: string }) {
  const item = runStatus[status] ?? { label: status, className: "border-slate-200 bg-slate-50 text-slate-600" };
  return <Badge variant="outline" className={item.className}>{item.label}</Badge>;
}

function DataRefreshPage() {
  const request = useBoundedFetch();
  const [state, setState] = useState<RefreshState | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"eeo" | "crm" | "">("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const response = await request("/api/data-refresh", { cache: "no-store" });
      const payload = await response.json() as RefreshState & { error?: string };
      if (!response.ok) throw new Error(payload.error || "更新状态读取失败");
      setState(payload);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "更新状态读取失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    request("/api/data-refresh", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as RefreshState & { error?: string };
        if (!response.ok) throw new Error(payload.error || "更新状态读取失败");
        if (!cancelled) setState(payload);
      })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "更新状态读取失败"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [request]);

  const startEeo = async () => {
    setMessage("请在采集电脑的dashboard目录执行 npm run eeo:weekly；会话失效时先执行 npm run eeo:login。只重传已采集数据可执行 npm run eeo:sync。网页不会远程启动Chrome。");
  };

  const cancelWaitingEeo = async () => {
    setBusy("eeo"); setError(""); setMessage("");
    try {
      const response = await request("/api/data-refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: "eeo", action: "cancel_waiting" }) });
      const payload = await response.json() as { cancelled?: boolean; error?: string };
      if (!response.ok) throw new Error(payload.error || "未完成任务清除失败");
      setMessage(payload.cancelled ? "已清除未完成的EEO登录待办；未读取或覆盖任何数据。" : "没有需要清除的EEO登录待办。");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "未完成任务清除失败"); }
    finally { setBusy(""); }
  };

  const uploadCrm = async () => {
    if (!file) return;
    setBusy("crm"); setError(""); setMessage("");
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await request("/api/data-refresh/crm", { method: "POST", body: form });
      const payload = await response.json() as { duplicateFile?: boolean; summary?: { rowCount?: number; amount?: number; unmappedCount?: number }; error?: string };
      if (!response.ok) throw new Error(payload.error || "CRM付费表导入失败");
      const summary = payload.summary ?? {};
      setMessage(payload.duplicateFile ? "该文件已成功导入过，本次未重复写入。" : `CRM导入完成：${summary.rowCount ?? 0}条，金额${currency.format(summary.amount ?? 0)}，待映射${summary.unmappedCount ?? 0}条。`);
      setFile(null);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "CRM付费表导入失败"); }
    finally { setBusy(""); }
  };

  const latestEeo = state?.runs.find((run) => run.source === "eeo");
  const latestCrm = state?.runs.find((run) => run.source === "crm");
  const eeoAsOf = latestEeo?.dataAsOf || state?.sourceMetadata?.eeo?.dataAsOf || state?.initialEeoAsOf || "读取中";
  const crmAsOf = latestCrm?.dataAsOf || state?.sourceMetadata?.crm?.dataAsOf || state?.initialCrmAsOf || "读取中";
  return <div className="space-y-5">
    <PageTitle title="数据更新中心" description="EEO使用与风险、CRM付费明细分别更新；任一来源失败都不会覆盖最后一次成功数据。" action={<Button variant="outline" className="rounded-xl" onClick={() => void load()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />刷新状态</Button>} />
    {message && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div>}
    {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
    <section className="grid gap-5 xl:grid-cols-2">
      <Card className="border-emerald-950/10"><CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-base"><Database className="h-4 w-4 text-emerald-700" /> EEO使用与风险</CardTitle><p className="mt-1 text-sm text-slate-500">由采集电脑定时读取EEOS，完成校验后同步线上；更新时间只代表消耗与风险数据。</p></div>{latestEeo ? <SourceBadge status={latestEeo.status} /> : <Badge variant="outline">沿用初始快照</Badge>}</div></CardHeader><CardContent className="space-y-4"><SettingRow label="消耗数据截至" value={eeoAsOf} /><SettingRow label="最近抓取" value={state?.sourceMetadata?.eeo?.capturedAt ? new Date(state.sourceMetadata.eeo.capturedAt).toLocaleString("zh-CN", { hour12: false }) : "—"} /><SettingRow label="更新方式" value="本电脑采集 → 校验 → 线上同步" /><SettingRow label="服务器同步配置" value={state?.sync?.configured ? "服务器已配置同步密钥（连接需实测）" : "服务器未配置同步密钥；本地更新仍可运行"} /><SettingRow label="登录处理" value="使用已登录的EEO平台浏览器会话" /><div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-5 text-emerald-900">采集在你的电脑运行；服务器接收完整汇总后自动发布。失败保留上次有效数据，不上传班级、教师或课程原始明细。</div><Button className="w-full rounded-xl bg-emerald-700 hover:bg-emerald-800" onClick={() => void startEeo()} disabled={busy !== ""}>{busy === "eeo" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}查看本地执行方法</Button>{latestEeo?.status === "waiting_for_login" && <Button variant="outline" className="w-full rounded-xl" onClick={() => void cancelWaitingEeo()} disabled={busy !== ""}>清除未完成待办</Button>}</CardContent></Card>
      <Card className="border-emerald-950/10"><CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-base"><FileSpreadsheet className="h-4 w-4 text-violet-700" /> CRM订单数据</CardTitle><p className="mt-1 text-sm text-slate-500">订单同步入口独立于EEO消耗同步；本次没有新订单。</p></div>{latestCrm ? <SourceBadge status={latestCrm.status} /> : <Badge variant="outline">沿用上一版</Badge>}</div></CardHeader><CardContent className="space-y-4"><SettingRow label="订单数据截至" value={crmAsOf} /><SettingRow label="本次同步结果" value="无新增订单，沿用上一版订单明细" /><div className="rounded-xl border border-violet-200 bg-violet-50/60 p-4 text-sm leading-5 text-violet-900">CRM当前未产生新订单，因此不会伪造新的订单批次或更新时间；下一次上传累计付费表时再更新该时间。</div><div className="grid grid-cols-3 gap-2"><Info label="已入库明细" value={`${state?.crmSummary.rowCount ?? 0}条`} /><Info label="累计金额" value={currency.format((state?.crmSummary.amountCents ?? 0) / 100)} /><Info label="待映射" value={`${state?.crmSummary.unmappedCount ?? 0}条`} /></div><Button className="w-full rounded-xl bg-violet-700 hover:bg-violet-800" onClick={() => void uploadCrm()} disabled={!file || busy !== ""}>{busy === "crm" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}导入并校验CRM</Button></CardContent></Card>
    </section>
    <Card className="gap-0 overflow-hidden border-slate-200 py-0"><CardHeader className="border-b border-slate-100 px-5 py-5"><CardTitle className="text-base">最近更新批次</CardTitle><p className="mt-1 text-sm text-slate-500">EEO与CRM分别记录真实同步批次；没有新订单时CRM沿用上一版数据。</p></CardHeader>{loading ? <div className="flex min-h-44 items-center justify-center text-sm text-slate-400"><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在读取</div> : <div className="overflow-x-auto"><Table className="min-w-[900px]"><TableHeader><TableRow className="bg-slate-50 hover:bg-slate-50"><TableHead className="pl-5">批次</TableHead><TableHead>数据源</TableHead><TableHead>触发方式</TableHead><TableHead>状态</TableHead><TableHead>数据截至</TableHead><TableHead>记录数</TableHead><TableHead>开始时间</TableHead><TableHead className="pr-5">说明</TableHead></TableRow></TableHeader><TableBody>{state?.runs.length ? state.runs.map((run) => <TableRow key={run.id}><TableCell className="pl-5 font-mono text-xs">#{run.id}</TableCell><TableCell>{run.source === "eeo" ? "EEO" : "CRM"}</TableCell><TableCell>{run.trigger === "upload" ? "文件上传" : run.trigger === "scheduled" ? "定时" : run.trigger === "startup_catchup" ? "开机补跑" : "手动"}</TableCell><TableCell><SourceBadge status={run.status} /></TableCell><TableCell>{run.dataAsOf || "—"}</TableCell><TableCell>{run.rowCount}</TableCell><TableCell>{new Date(`${run.startedAt}Z`).toLocaleString("zh-CN", { hour12: false })}</TableCell><TableCell className="max-w-[260px] truncate pr-5 text-sm text-slate-500" title={run.errorMessage || run.fileName || ""}>{run.errorMessage || run.fileName || (run.status === "waiting_for_login" ? "仅登录待办，尚未采集" : "—")}</TableCell></TableRow>) : <TableRow><TableCell colSpan={8} className="h-32 text-center text-slate-400">尚无更新批次。</TableCell></TableRow>}</TableBody></Table></div>}</Card>
  </div>;
}

function SettingsPage() { return <IdentitySettings />; }

function SettingRow({ label, value, success }: { label: string; value: string; success?: boolean }) { return <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3"><span className="text-sm text-slate-500">{label}</span><span className={`text-sm font-medium ${success ? "text-emerald-600" : "text-slate-800"}`}>{value}</span></div>; }

export function SecondaryPage({ page, selectedUid, onOpenCustomer, snapshot, readOnly }: { page: PageKey; selectedUid: string; onOpenCustomer: (uid: string) => void; snapshot: DashboardSnapshot; readOnly: boolean }) {
  if (page === "待跟进客户") return <Followups snapshot={snapshot} onOpenCustomer={onOpenCustomer} />;
  if (page === "客户主数据") return <CustomerMaster snapshot={snapshot} readOnly={readOnly} onOpenCustomer={onOpenCustomer} />;
  if (page === "客户详情与日志" && !snapshot.customers.length) return <p>当前没有授权客户。</p>;
  if (page === "客户详情与日志") return <CustomerDetail uid={selectedUid} snapshot={snapshot} readOnly={readOnly} />;
  if (page === "数据更新") return <DataRefreshPage />;
  if (page === "数据质量") return <DataQuality snapshot={snapshot} />;
  if (page === "系统设置") return <SettingsPage />;
  return null;
}
