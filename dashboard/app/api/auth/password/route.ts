import { env } from '@/lib/node-runtime';
import { readLimitedJson } from '@/lib/bounded-request';
import { createPasswordRecord, requireAdmin, writeAudit } from '@/lib/local-auth';
import { passwordEnabled } from '@/lib/workbench-auth';
import { validIdentity } from '@/lib/identity-policy';
import { safeMutation } from '@/lib/auth-mutation';
export async function POST(request:Request) {
  if(!safeMutation(request))return Response.json({error:'请求来源不允许'},{status:403});
  if(!passwordEnabled())return Response.json({error:'独立密码登录未启用'},{status:410});
  const admin=await requireAdmin(request);
  if(!admin)return Response.json({error:'只有 EEO04410 管理员可配置密码'},{status:403});
  try {
    const payload=await readLimitedJson(request) as {jobNumber?:string;password?:string};
    if(typeof payload.jobNumber!=='string'||typeof payload.password!=='string')return Response.json({error:'工号和密码格式错误'},{status:400});
    const job=payload.jobNumber?.trim()||'',password=payload.password||'';
    if(!/^EEO\d{5,12}$/.test(job)||password.length<12||password.length>128)
      return Response.json({error:'请填写已授权工号及12–128位密码'},{status:400});
    const user=await env.DB.prepare('SELECT u.id,u.role,e.job_number AS jobNumber FROM user_account u JOIN external_identity e ON e.user_id=u.id WHERE e.job_number=? AND e.enabled=1 AND u.enabled=1').bind(job).first<{id:number;role:string;jobNumber:string}>();
    if(!user||!validIdentity(user))return Response.json({error:'该工号尚未配置有效业务授权'},{status:400});
    const record=await createPasswordRecord(password);
    await env.DB.batch([
      env.DB.prepare('UPDATE user_account SET password_salt=?,password_hash=?,encrypted_password=NULL,password_iv=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(record.salt,record.hash,user.id),
      env.DB.prepare('DELETE FROM auth_session WHERE user_id=?').bind(user.id),
    ]);
    await writeAudit(admin,'set_independent_password','user_account',String(user.id));
    return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});
  } catch {return Response.json({error:'密码配置失败，请检查输入或联系维护人员'},{status:400});}
}
