// No visitor can create an account, including on a new empty database.
export async function POST() {
  return Response.json({error:'公开注册已关闭，请联系管理员配置工号账号。'},
    {status:410,headers:{'Cache-Control':'no-store'}});
}
