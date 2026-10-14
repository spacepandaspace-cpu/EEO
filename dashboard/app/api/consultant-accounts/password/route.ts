export async function POST() {
  return Response.json({error:'密码查看已关闭。管理员只能为已授权工号重新设置独立密码。'},
    {status:410,headers:{'Cache-Control':'no-store'}});
}
