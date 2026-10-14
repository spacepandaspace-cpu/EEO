import { env } from '@/lib/node-runtime';
import { requireAdmin } from '@/lib/local-auth';
export async function GET(request:Request) {
  if(!await requireAdmin(request))return Response.json({error:'仅管理员可管理账号'},{status:403});
  const rows=await env.DB.prepare('SELECT u.username,u.consultant_name AS consultantName,u.role,u.enabled,u.created_at AS createdAt,e.job_number AS jobNumber FROM user_account u JOIN external_identity e ON e.user_id=u.id WHERE e.enabled=1 ORDER BY e.job_number').all<{username:string;consultantName:string|null;role:string;enabled:number;createdAt:string;jobNumber:string}>();
  return Response.json({authMode:env.AUTH_MODE,accounts:rows.results.map(row=>({...row,enabled:Boolean(row.enabled)}))},{headers:{'Cache-Control':'no-store'}});
}
export async function POST() {
  return Response.json({error:'不再按姓名生成未绑定工号的账号。请通过已批准的工号映射配置账号。'},{status:410});
}
