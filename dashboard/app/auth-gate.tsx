"use client";
import { useBoundedFetch } from '@/lib/bounded-fetch';
import { useEffect,useState,type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card,CardContent,CardHeader,CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { SessionUser } from './dashboard-types';
type Status={authenticated:boolean;user?:SessionUser|null;authMode?:string;passwordEnabled:boolean;loginUrl?:string};
export function AuthGate({children}:{children:ReactNode|((user:SessionUser)=>ReactNode)}) {
  const request=useBoundedFetch();
  const [status,setStatus]=useState<Status|null>(null),[username,setUsername]=useState(''),[password,setPassword]=useState('');
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[attempt,setAttempt]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();let active=true;
    document.documentElement.dataset.appReady='true';
    const timer=setTimeout(()=>controller.abort(),15000);
    request('/api/auth/status',{cache:'no-store',signal:controller.signal}).then(async response=>{
      const payload=await response.json();
      if(!response.ok)throw new Error(payload.error||'登录服务暂不可用');
      if(active){setStatus(payload);if(new URLSearchParams(window.location.search).has('login_error')){
        setError('工作台身份验证未通过或工号尚未授权，请联系管理员。');
        window.history.replaceState(null,'',window.location.pathname);
      }}
    }).catch(reason=>{if(active)setError(controller.signal.aborted?'登录服务响应超时，请稍后重试。':reason instanceof Error?reason.message:'登录状态读取失败');})
      .finally(()=>clearTimeout(timer));
    return ()=>{active=false;clearTimeout(timer);controller.abort();};
  },[request,attempt]);
  async function submit() {
    if(!status?.passwordEnabled||busy)return;setBusy(true);setError('');
    try {
      const response=await request('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
      const payload=await response.json();
      if(!response.ok)throw new Error(payload.error||'登录失败');
      setPassword('');setStatus({...status,authenticated:true,user:payload.user});
    }catch(reason){setError(reason instanceof Error?reason.message:'登录失败');}
    finally{setBusy(false);}
  }
  if(status?.authenticated&&status.user)return typeof children==='function'?children(status.user):children;
  return <main className="flex min-h-screen items-center justify-center bg-slate-50 p-5">
    <Card className="w-full max-w-md border-emerald-950/10">
      <CardHeader><p className="text-sm text-emerald-700">AI教学风险监测 · 客户运营中心</p><CardTitle className="text-2xl">登录看板</CardTitle><p className="text-sm text-slate-500">账号由管理员授权，不开放注册。</p></CardHeader>
      <CardContent className="space-y-5">
        {!status&&!error&&<p>正在检查登录服务…</p>}
        {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {!status&&error&&<Button onClick={()=>{setError('');setAttempt(value=>value+1);}}>重新检查</Button>}
        {status?.loginUrl&&<Button className="w-full" onClick={()=>window.location.assign(status.loginUrl!)}>通过工作台登录</Button>}
        {status?.passwordEnabled&&<form className="space-y-4" onSubmit={event=>{event.preventDefault();void submit();}}>
          {status.loginUrl&&<p className="text-center text-sm text-slate-500">或使用已开通的独立密码</p>}
          <div className="space-y-2"><Label htmlFor="username">工号 / 账号</Label><Input id="username" value={username} onChange={event=>setUsername(event.target.value)} autoComplete="username" maxLength={100} required /></div>
          <div className="space-y-2"><Label htmlFor="password">密码</Label><Input id="password" type="password" value={password} onChange={event=>setPassword(event.target.value)} autoComplete="current-password" maxLength={128} required /></div>
          <Button className="w-full" type="submit" disabled={busy}>{busy?'登录中…':'密码登录'}</Button>
        </form>}
        {status&&<p className="text-xs leading-5 text-slate-500">工作台和独立登录共用同一账号权限。没有授权或没有客户归属时，请联系管理员。</p>}
      </CardContent>
    </Card>
  </main>;
}
