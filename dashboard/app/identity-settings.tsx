"use client";
import { useEffect,useState } from 'react';
import { useBoundedFetch } from '@/lib/bounded-fetch';
import { Card,CardContent,CardHeader,CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
type Account={jobNumber:string;username:string;role:string;enabled:boolean};
export function IdentitySettings() {
  const request=useBoundedFetch();
  const [accounts,setAccounts]=useState<Account[]>([]),[mode,setMode]=useState('');
  const [job,setJob]=useState('EEO04410'),[password,setPassword]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();
    request('/api/consultant-accounts',{cache:'no-store',signal:controller.signal}).then(async response=>{
      const data=await response.json();if(!response.ok)throw new Error(data.error||'读取账号失败');
      setAccounts(data.accounts);setMode(data.authMode);
    }).catch(reason=>{if(!controller.signal.aborted)setMessage(reason instanceof Error?reason.message:'读取失败');});
    return ()=>controller.abort();
  },[request]);
  async function save() {
    setBusy(true);setMessage('');
    try {
      const response=await request('/api/auth/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jobNumber:job,password})});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'配置失败');
      setPassword('');setMessage('独立密码已设置，该账号此前的密码登录会话已失效。请通过安全方式告知本人。');
    }catch(reason){setMessage(reason instanceof Error?reason.message:'配置失败');}
    finally{setBusy(false);}
  }
  return <div className="space-y-5">
    <h1 className="text-2xl font-semibold">账号与权限</h1>
    <Card><CardHeader><CardTitle>统一身份与独立登录</CardTitle></CardHeader><CardContent className="space-y-3">
      <p>EEO04410 是本看板唯一管理员；销售只能查看归属自己的客户。工作台管理员身份不会自动扩大本看板权限。</p>
      <p>工作台密码由工作台维护。本看板的独立密码单独设置，只保存不可逆验证信息，不提供密码查看。</p>
      <p>新增授权和工号归属须经过管理员确认。未授权工号无客户数据权限。</p>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className="p-2 text-left">工号</th><th className="p-2 text-left">账号</th><th className="p-2 text-left">角色</th><th className="p-2 text-left">状态</th></tr></thead><tbody>{accounts.map(account=><tr key={account.jobNumber}><td className="p-2">{account.jobNumber}</td><td className="p-2">{account.username}</td><td className="p-2">{account.role==='admin'?'管理员':'销售'}</td><td className="p-2">{account.enabled?'启用':'停用'}</td></tr>)}</tbody></table></div>
    </CardContent></Card>
    {['hybrid','local'].includes(mode)&&<Card><CardHeader><CardTitle>为已授权账号设置独立密码</CardTitle></CardHeader><CardContent>
      <form className="space-y-4" onSubmit={event=>{event.preventDefault();void save();}}>
        <div className="space-y-2"><Label htmlFor="password-job">工号</Label><Input id="password-job" value={job} onChange={event=>setJob(event.target.value)} required /></div>
        <div className="space-y-2"><Label htmlFor="account-new-password">新密码（12–128位）</Label><Input id="account-new-password" type="password" value={password} onChange={event=>setPassword(event.target.value)} autoComplete="new-password" minLength={12} maxLength={128} required /></div>
        <Button type="submit" disabled={busy}>{busy?'保存中…':'设置独立密码'}</Button>
      </form>
    </CardContent></Card>}
    {message&&<p role="status" className="rounded-lg bg-slate-100 p-3 text-sm">{message}</p>}
  </div>;
}
