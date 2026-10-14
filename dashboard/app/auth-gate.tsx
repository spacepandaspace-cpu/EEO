"use client";
import { useBoundedFetch } from "@/lib/bounded-fetch";

import { useEffect, useState, type ReactNode } from "react";
import { BarChart3, CheckCircle2, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { SessionUser } from "./dashboard-types";

type Status = { bootstrapRequired: boolean; authenticated: boolean; user?: SessionUser | null; authMode?:string; loginUrl?:string };

export function AuthGate({ children }: { children: ReactNode | ((user: SessionUser) => ReactNode) }) {
  const request = useBoundedFetch();
  const [status, setStatus] = useState<Status | null>(null);
  const [username, setUsername] = useState("管理员");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    document.documentElement.dataset.appReady = "true";
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 15000);
    request("/api/auth/status", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as Status & { error?: string };
        if (!response.ok) throw new Error(payload.error || "登录状态读取失败");
        if (active) {
          setStatus(payload);
          if(payload.authMode==='workbench'&&!payload.authenticated&&payload.loginUrl)window.location.replace(payload.loginUrl);
        }
      })
      .catch((reason) => {
        if (!active) return;
        setError(controller.signal.aborted ? "本地服务响应超时，请确认开发服务正在运行。" : reason instanceof Error ? reason.message : "登录状态读取失败");
      })
      .finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [attempt, request]);

  const submit = async () => {
    if (!status) return;
    if (status.bootstrapRequired && password !== confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const endpoint = status.bootstrapRequired ? "/api/auth/bootstrap" : "/api/auth/login";
      const response = await request(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
      const payload = await response.json() as { user?: SessionUser; error?: string };
      if (!response.ok) throw new Error(payload.error || "操作失败");
      setStatus({ bootstrapRequired: false, authenticated: true, user: payload.user });
      setPassword("");
      setConfirmPassword("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作失败");
    } finally {
      setSubmitting(false);
    }
  };

  if (status?.authenticated && status.user) return typeof children === "function" ? children(status.user) : children;
  if(status?.authMode==='workbench')return <main className="flex min-h-screen items-center justify-center"><p>正在返回统一工作台；未授权工号请联系本系统管理员。</p></main>;

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-white p-5 md:p-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_10%,rgba(16,185,129,.08),transparent_26%),radial-gradient(circle_at_90%_90%,rgba(5,90,64,.07),transparent_30%)]" />
      <Card className="relative grid w-full max-w-[920px] overflow-hidden rounded-[28px] border-emerald-950/10 bg-white p-0 shadow-[0_30px_90px_rgba(12,72,53,.14)] md:grid-cols-[1.05fr_.95fr]">
        <section className="relative hidden min-h-[620px] overflow-hidden bg-[#0b4635] p-10 text-white md:flex md:flex-col md:justify-between">
          <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full border border-white/10 bg-emerald-300/10" />
          <div className="absolute -bottom-28 -left-20 h-72 w-72 rounded-full border border-white/10 bg-emerald-950/30" />
          <div className="relative">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-400 text-emerald-950 shadow-[0_12px_28px_rgba(16,185,129,.24)]"><ShieldCheck className="h-6 w-6" /></div>
            <p className="mt-8 text-sm font-semibold tracking-[0.18em] text-emerald-200">CLASSIN · AI RISK OPS</p>
            <h1 className="mt-4 max-w-sm text-[2.45rem] font-semibold leading-[1.18] tracking-[-0.045em]">把客户使用、风险与转化放在同一个决策界面。</h1>
            <p className="mt-5 max-w-sm text-base leading-7 text-emerald-100/75">面向AI教学风险监测的本机运营工作台。</p>
          </div>
          <div className="relative grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-white/10 bg-white/[0.07] p-4"><BarChart3 className="h-5 w-5 text-emerald-300" /><p className="mt-4 text-2xl font-semibold">92</p><p className="mt-1 text-sm text-emerald-100/65">在册客户</p></div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.07] p-4"><CheckCircle2 className="h-5 w-5 text-emerald-300" /><p className="mt-4 text-2xl font-semibold">11</p><p className="mt-1 text-sm text-emerald-100/65">已付费客户</p></div>
          </div>
        </section>
        <section className="flex min-h-[560px] flex-col justify-center px-7 py-10 sm:px-12 md:min-h-[620px]">
          <CardHeader className="px-0 text-left">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 md:hidden"><ShieldCheck className="h-5 w-5" /></div>
            <p className="mt-5 text-sm font-semibold text-emerald-700">客户运营中心</p>
            <CardTitle className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-emerald-950">{status?.bootstrapRequired ? "创建管理员账号" : "欢迎回来"}</CardTitle>
            <p className="mt-2 text-sm leading-6 text-slate-500">{status?.bootstrapRequired ? "首次使用只需完成一次初始化。" : "登录后查看你有权限访问的客户数据。"}</p>
          </CardHeader>
          <CardContent className="mt-5 space-y-5 px-0">
            {!status && !error ? <div className="space-y-3 py-8 text-sm text-slate-500"><div className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin text-emerald-600" />正在检查本地数据</div><p className="text-xs">首次启动可能需要十几秒。若一直停在这里，请检查本地服务。</p><form action="/"><button type="submit" className="text-xs text-emerald-700 underline">刷新页面</button></form></div> : error && !status ? <div className="space-y-3 py-8"><p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p><Button variant="outline" onClick={() => { setError(""); setAttempt((value) => value + 1); }}>重新检查</Button></div> : <>
              <div className="space-y-2"><Label htmlFor="username" className="text-sm font-medium text-emerald-950">{status?.bootstrapRequired ? "管理员名称" : "账号"}</Label><Input id="username" value={username} onChange={(event) => setUsername(event.target.value)} className="h-12 rounded-xl border-emerald-950/15 bg-white px-4 focus-visible:ring-emerald-500" autoComplete="username" /></div>
              <div className="space-y-2"><Label htmlFor="password" className="text-sm font-medium text-emerald-950">密码</Label><Input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !status?.bootstrapRequired) void submit(); }} className="h-12 rounded-xl border-emerald-950/15 bg-white px-4 focus-visible:ring-emerald-500" autoComplete={status?.bootstrapRequired ? "new-password" : "current-password"} /></div>
              {status?.bootstrapRequired && <div className="space-y-2"><Label htmlFor="confirmPassword" className="text-sm font-medium text-emerald-950">确认密码</Label><Input id="confirmPassword" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submit(); }} className="h-12 rounded-xl border-emerald-950/15 bg-white px-4 focus-visible:ring-emerald-500" autoComplete="new-password" /></div>}
              {error && <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>}
              <Button onClick={submit} disabled={submitting || !status} className="h-12 w-full rounded-xl bg-emerald-600 text-base font-medium shadow-[0_10px_24px_rgba(5,150,105,.22)] hover:bg-emerald-700"><KeyRound className="h-4 w-4" />{submitting ? "处理中…" : status?.bootstrapRequired ? "创建并进入系统" : "登录系统"}</Button>
              <p className="text-xs leading-5 text-slate-400">{status?.bootstrapRequired ? "密码至少8位。账号数据仅保存在本机。" : "账号权限由管理员按顾问归属配置。"}</p>
            </>}
          </CardContent>
        </section>
      </Card>
    </main>
  );
}
