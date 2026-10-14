import { env } from '@/lib/node-runtime';
export async function GET(){
  try {
    const tables = ['user_account','customer_log','audit_log','source_run','crm_payment_event','system_config','eeo_snapshot'];
    if(env.AUTH_MODE==='workbench')tables.push('external_identity','workbench_session');
    for(const table of tables)await env.DB.prepare(`SELECT 1 FROM ${table} LIMIT 1`).first();
    return Response.json({status:'ok'},{headers:{'Cache-Control':'no-store'}});
  }
  catch{return Response.json({status:'unavailable'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
