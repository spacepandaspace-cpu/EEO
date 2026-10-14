import { timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/node-runtime';
import { readLimitedJson } from '@/lib/bounded-request';
import { validIdentity } from '@/lib/identity-policy';

// This machine endpoint can revoke an existing grant, never grant a new one.
export async function POST(request:Request) {
  const expected=env.WORKBENCH_ACCOUNT_TOKEN;
  if(!expected)return Response.json({error:'账号停用同步尚未配置'},{status:503});
  const authorization=request.headers.get('authorization')||'';
  if(!authorization.startsWith('Bearer '))return Response.json({error:'未授权'},{status:401});
  const supplied=authorization.slice(7);
  const a=Buffer.from(supplied),b=Buffer.from(expected);
  if(a.length!==b.length||!timingSafeEqual(a,b))return Response.json({error:'未授权'},{status:401});
  try {
    const body=await readLimitedJson(request) as {jobNumber?:string;enabled?:number};
    if(!/^EEO\d{5,12}$/.test(body.jobNumber||'')||body.enabled!==0)return Response.json({error:'仅支持按工号停用既有账号'},{status:400});
    const user=await env.DB.prepare('SELECT u.id,u.role,e.job_number AS jobNumber FROM user_account u JOIN external_identity e ON e.user_id=u.id WHERE e.job_number=?').bind(body.jobNumber).first<{id:number;role:string;jobNumber:string}>();
    if(!user||!validIdentity(user))return Response.json({error:'工号未配置有效映射'},{status:404});
    await env.DB.batch([
      env.DB.prepare('UPDATE external_identity SET enabled=0 WHERE job_number=?').bind(body.jobNumber),
      env.DB.prepare('UPDATE user_account SET enabled=0 WHERE id=?').bind(user.id),
      env.DB.prepare('DELETE FROM auth_session WHERE user_id=?').bind(user.id),
      env.DB.prepare('DELETE FROM workbench_session WHERE user_id=?').bind(user.id),
      env.DB.prepare("INSERT INTO audit_log(actor_name,action,object_type,object_id) VALUES('workbench-status','disable_account','user_account',?)").bind(String(user.id)),
    ]);
    return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});
  }catch{return Response.json({error:'停用同步失败'},{status:400});}
}
