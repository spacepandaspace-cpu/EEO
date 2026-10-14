"use client";
import { useCallback, useEffect, useRef } from "react";

/** Includes body reading in the timeout and 1 MB response budget. */
export async function boundedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const controller = new AbortController();
  const parent = init.signal;
  const cancel = () => controller.abort();
  if (parent?.aborted) cancel();
  parent?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(cancel, 20_000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    if (Number(response.headers.get("content-length")) > 1048576) throw new Error("数据超过1MB预算，请分批加载。");
    reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    if (reader) while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 1048576) throw new Error("数据超过1MB预算，请分批加载。");
      chunks.push(value);
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    if ([502, 503, 504].includes(response.status)) throw new Error("本地服务不可用或内存不足，请检查终端及电脑内存后重试。");
    return new Response(bytes ? body : null, { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (error) {
    if (controller.signal.aborted) throw new Error("请求已取消或超过20秒；请检查本地服务和可用内存。");
    if (error instanceof TypeError) throw new Error("本地服务已断开，可能内存不足或服务已退出，请检查终端后重试。");
    throw error;
  } finally {
    await reader?.cancel().catch(() => {});
    reader?.releaseLock();
    clearTimeout(timer);
    parent?.removeEventListener("abort", cancel);
  }
}

export function useBoundedFetch() {
  const pending = useRef(new Set<AbortController>());
  useEffect(() => {
    const requests = pending.current;
    return () => { for (const controller of requests) controller.abort(); requests.clear(); };
  }, []);
  return useCallback(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const controller = new AbortController();
    pending.current.add(controller);
    const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
    try { return await boundedFetch(input, { ...init, signal }); }
    finally { pending.current.delete(controller); }
  }, []);
}
