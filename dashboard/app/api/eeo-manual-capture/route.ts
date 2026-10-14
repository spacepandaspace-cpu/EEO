// Retired unbounded URL/clipboard transfer; explicit local CLI only.
export function GET() {
  return Response.json({ error: "旧EEO传输接口已关闭。请在终端显式运行 npm run eeo:collect 或 npm run eeo:bridge。" }, { status: 410 });
}
export const POST = GET;
