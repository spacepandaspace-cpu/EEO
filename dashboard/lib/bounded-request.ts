import "server-only";

/** Enforces the request budget before JSON/multipart parsing allocates objects. */
export async function readLimitedBody(request: Request, maxBytes = 16_384) {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { void reader.cancel().catch(() => {}); reject(new Error("请求读取超时，请分批重试")); }, 20_000);
  });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (Number(request.headers.get("content-length")) > maxBytes) throw new Error("请求超过大小预算，请分批处理");
    while (true) {
      const {done,value} = await Promise.race([reader.read(), expired]);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("请求超过大小预算，请分批处理");
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function readLimitedJson(request: Request) {
  return JSON.parse(new TextDecoder().decode(await readLimitedBody(request)));
}
