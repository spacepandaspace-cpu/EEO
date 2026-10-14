/*
 * EEO risk-monitor collector
 *
 * This is deliberately a local, attended collector: it opens a dedicated Chrome
 * profile and waits for the operator to complete the EEO login.  It never reads
 * cookies, passwords, SMS codes, classroom names, teacher/student data, replay
 * links, or ASR/risk-text content.  It only saves the aggregates listed below.
 *
 * Usage:
 *   npm.cmd run eeo:collect
 *   $env:EEO_CAPTURE_FROM='2026-09-01'; npm.cmd run eeo:collect
 */

import { fork } from "node:child_process";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import fs from "node:fs";
import process from "node:process";
import WebSocket from "ws";
import { safeNumber, sparseCount } from './eeo-values.mjs';

let chromeOwner;
let liveClient;
let cleaning=false;
const ROOT = path.resolve(import.meta.dirname, "..");
const WORKSPACE = path.resolve(ROOT, "..");
const collectorLock = path.join(ROOT, ".eeo-collector.lock");
let ownsCollectorLock = false;
const DEBUG_PORT = Number(process.env.EEO_DEBUG_PORT || 9231);
// Login must begin at the EEO administration home page. The operator selects
// their normal login method there; only after a successful login do we open the
// risk-monitor console route.
const WRAPPER_URL = "https://zxjsmgr.eeo.cn/eeos_admin/admin.php";
const CONSOLE_URL = "https://console.eeo.cn/saas/admin/basic/aiRiskMonitor";
const API_PATH = "/saasajax/admin/aiRisk.ajax.php?action=";
const LOGIN_WAIT_MS = 20 * 60 * 1000;
const UNATTENDED = process.env.EEO_UNATTENDED === '1';
const PAGE_SIZE = 100;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function log(message) {
  console.log(`[EEO collector] ${message}`);
}

function chinaDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

function dateDaysAgo(days) {
  const parts = chinaDate().split("-").map(Number);
  const utc = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] - days));
  return utc.toISOString().slice(0, 10);
}

function startUnix(day) {
  return Math.floor(new Date(`${day}T00:00:00+08:00`).getTime() / 1000);
}

function endUnix(day) {
  return Math.floor(new Date(`${day}T23:59:59+08:00`).getTime() / 1000);
}

function firstDefined(object, keys) {
  for (const key of keys) {
    if (object?.[key] !== undefined && object?.[key] !== null && object[key] !== "") return object[key];
  }
  return null;
}

function safeText(value, limit = 80) {
  if (value === null || value === undefined) return null;
  return String(value).replace(/[\r\n\t]+/g, " ").trim().slice(0, limit) || null;
}

function extractPayload(response) {
  if (!response || typeof response !== "object") return {};
  return response.data && typeof response.data === "object" ? response.data : response;
}

function listFrom(payload) {
  const source = extractPayload(payload);
  for (const key of ["list", "rows", "items", "dataList"]) {
    if (Array.isArray(source?.[key])) return source[key];
  }
  return Array.isArray(source) ? source : [];
}

function totalFrom(payload, fallback) {
  const source = extractPayload(payload);
  return safeNumber(firstDefined(source, ["total", "totalCount", "count", "records"])) ?? fallback;
}

function sanitizeSchool(row) {
  const uid = safeText(firstDefined(row, ["schoolUid", "school_uid", "uid", "sid"]), 32);
  if (!uid) return null;
  return {
    uid,
    // EEO institution display name only; not a classroom, person, or contact.
    schoolName: safeText(firstDefined(row, ["schoolName", "school_name", "name"])),
    monitorEnabled: safeNumber(firstDefined(row, ["monitorStatus", "monitor_status", "isMonitor", "is_monitor"])),
    createdAt: safeText(firstDefined(row, ["createdAt", "createTime", "create_time"]), 40),
    lastActiveAt: safeText(firstDefined(row, ["lastActiveAt", "lastActiveTime", "last_active_time"]), 40),
    analyzedLessonCount: safeNumber(firstDefined(row, ["analyzedLessonCount", "analyzed_count", "totalAnalyzedCount", "total_analyzed_count"])),
    periodAnalyzedLessonCount: safeNumber(firstDefined(row, ["weekAnalyzedCount", "periodAnalyzedCount", "week_analyzed_count"])),
    riskLessonCount: safeNumber(firstDefined(row, ["riskLessonCount", "risk_count", "risk_lesson_count"])),
    falsePositiveCount: safeNumber(firstDefined(row, ["falsePositiveCount", "false_positive_count"])),
    falsePositiveRate: safeNumber(firstDefined(row, ["falsePositiveRate", "false_positive_rate"])),
  };
}

function sanitizeTrendRow(row) {
  return {
    date: safeText(firstDefined(row, ["date", "day", "statDate", "stat_date"]), 20),
    analyzedLessonCount: sparseCount(row, ["analyzedLessonCount", "lessonCount", "analyzed_count", "count"]),
    riskLessonCount: sparseCount(row, ["riskLessonCount", "riskCount", "risk_count"]),
    falsePositiveCount: safeNumber(firstDefined(row, ["falsePositiveCount", "falsePositive", "false_positive_count"])),
  };
}

function sanitizeDetail(uid, response) {
  const source = extractPayload(response);
  const overview = source.overview && typeof source.overview === "object" ? source.overview : source;
  const trendSource = firstDefined(source, ["analysisTrend", "trend", "dailyTrend", "lessonTrend"]);
  const falsePositiveSource = firstDefined(source, ["falsePositiveDist", "falsePositiveDistribution", "riskTypeDistribution"]);
  if (Array.isArray(trendSource) && trendSource.length > 365) throw new Error("EEO trend exceeds 365 days; narrow the selected range.");
  if(uid !== 'platform' && (!source.overview || typeof source.overview !== 'object' || !Array.isArray(trendSource) || !trendSource.length)) {
    throw new Error('EEO school detail lacks the expected overview and dated trend; cannot assume zero');
  }
  const countValue = uid === 'platform' ? (object, keys) => safeNumber(firstDefined(object, keys)) : sparseCount;
  return {
    uid,
    monitorEnabled: safeNumber(firstDefined(overview, ["monitorStatus", "monitor_status", "isMonitor"])),
    createdAt: safeText(firstDefined(overview, ["createdAt", "createTime", "create_time"]), 40),
    lastActiveAt: safeText(firstDefined(overview, ["lastActiveAt", "lastActiveTime", "last_active_time"]), 40),
    analyzedLessonCount: countValue(overview, ["analyzedLessonCount", "analyzed_count", "totalAnalyzedCount"]),
    periodAnalyzedLessonCount: safeNumber(firstDefined(overview, ["weekAnalyzedCount", "periodAnalyzedCount", "week_analyzed_count"])),
    riskLessonCount: countValue(overview, ["riskLessonCount", "risk_count", "risk_lesson_count"]),
    falsePositiveCount: countValue(overview, ["falsePositiveCount", "false_positive_count"]),
    reviewedRiskLessonCount: countValue(overview, ["reviewedRiskLessonCount", "reviewed_count"]),
    riskDetectionRate: safeNumber(firstDefined(overview, ["riskDetectionRate", "risk_detection_rate"])),
    dailyMetrics: Array.isArray(trendSource) ? trendSource.map(sanitizeTrendRow).filter((row) => row.date) : [],
    // Risk categories and counts are aggregates. The label is not risk text.
    falsePositiveByRiskType: Array.isArray(falsePositiveSource)
      ? falsePositiveSource.map((row) => ({
          riskType: safeText(firstDefined(row, ["riskType", "riskTypeName", "type", "label"])),
          count: safeNumber(firstDefined(row, ["count", "value", "total"])),
          falsePositiveCount: safeNumber(firstDefined(row, ["falsePositiveCount", "falsePositive", "false_positive_count"])),
        })).filter((row) => row.riskType || row.count !== null)
      : [],
  };
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.sequence = 0;
    this.pending = new Map();
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.socket = new WebSocket(this.url, { handshakeTimeout: 5000, maxPayload: 2 * 1024 * 1024 });
      this.socket.once("open", resolve);
      this.socket.once("error", reject);
    });
    this.socket.on("message", (message) => {
      let packet;
      try { packet = JSON.parse(String(message)); } catch { return; }
      if (!packet.id) return;
      const pending = this.pending.get(packet.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(packet.id);
      if (packet.error) pending.reject(new Error(packet.error.message || "CDP request failed"));
      else pending.resolve(packet.result ?? {});
    });
    this.socket.on("close", () => {
      for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(new Error("Chrome connection closed")); }
      this.pending.clear();
    });
  }

  call(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("CDP request timed out")); }, 25000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.call("Runtime.evaluate", {
      expression, awaitPromise: true, returnByValue: true, userGesture: false,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Page evaluation failed");
    return result.result?.value;
  }

  close() { this.socket?.terminate(); }
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function chromeTarget() {
  const targets = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  return targets.find((target) => target.type === "page" && target.url.includes("zxjsmgr.eeo.cn"))
    ?? targets.find((target) => target.type === "page" && target.url.includes("console.eeo.cn"))
    ?? targets.find((target) => target.type === "page");
}

async function launchChrome() {
  chromeOwner = fork(new URL('./chrome-owner.mjs', import.meta.url), [String(DEBUG_PORT)], { execArgv: ['--max-old-space-size=64'], stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  await new Promise((resolve, reject) => { chromeOwner.once('message', resolve); chromeOwner.once('error', reject); chromeOwner.once('exit', () => reject(new Error('Chrome owner exited'))); });
  chromeOwner.once('exit',()=>{
    if(liveClient && !cleaning){console.error('专用Chrome已关闭，停止采集；不会覆盖快照。');liveClient.close();process.exit(1);}
  });
}

async function connectToChrome() {
  // Never attach to/close an existing browser, even on the collector port.
  try { await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`); throw new Error('EEO debugging port is already occupied; close the dedicated collector manually first.'); }
  catch (error) { if (error.message.includes('already occupied')) throw error; }
  log(process.env.EEO_PERSISTENT_SESSION === '1' ? 'Opening the authorized dedicated EEO Chrome profile…' : 'Opening a temporary, dedicated EEO Chrome window…');
  await launchChrome();
  let target;
  const deadline = Date.now() + 30_000;
  while (!target && Date.now() < deadline) {
    await sleep(800);
    try { target = await chromeTarget(); } catch { /* bounded startup wait */ }
  }
  if (!target?.webSocketDebuggerUrl) throw new Error("Chrome debugging connection did not become available");
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  await client.call("Page.enable");
  // Session restore may open old dedicated tabs; retain only our selected page.
  const ownedTargets=await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  for(const other of ownedTargets.filter(item=>item.type==='page'&&item.id!==target.id)) {
    await client.call('Target.closeTarget',{targetId:other.id});
  }
  // A previously opened collector window may still point at a console sub-page.
  // Always return to the EEO administration home before handing login to the user.
  await client.call("Page.navigate", { url: WRAPPER_URL });
  await sleep(1200);
  return client;
}

function apiExpression(action, payload) {
  // Browser-context fetch uses the authenticated same-origin console session.
  // It never accesses document.cookie or the DevTools cookie APIs.
  return `(async()=>{async function limitedText(response){const reader=response.body.getReader();const decoder=new TextDecoder();let text="",bytes=0;try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>1048576)throw new Error("EEO page exceeds 1MB; reduce page size");text+=decoder.decode(value,{stream:true});}return text+decoder.decode();}finally{await reader.cancel();reader.releaseLock();}} return await fetch(${JSON.stringify(`${API_PATH}${action}`)}, {method:"POST",signal:AbortSignal.timeout(15000),credentials:"include",headers:{"Content-Type":"application/json","X-Requested-With":"XMLHttpRequest"},body:JSON.stringify(${JSON.stringify(payload)})}).then(async (response) => ({status: response.status, text: await limitedText(response)}));})()`;
}

async function api(client, action, payload) {
  const response = await client.evaluate(apiExpression(action, payload));
  if (!response || response.status < 200 || response.status >= 300) throw new Error(`${action} returned HTTP ${response?.status ?? "unknown"}`);
  try {
    const parsed = JSON.parse(response.text);
    if (parsed?.error_info && Number(parsed.error_info.errno) !== 1) throw new Error(`${action} returned an EEO API error`);
    if (parsed?.code && Number(parsed.code) !== 0 && Number(parsed.code) !== 200) throw new Error(`${action} returned code ${parsed.code}`);
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${action} did not return JSON`);
    throw error;
  }
}

async function waitForLogin(client, baseRange) {
  if (UNATTENDED) {
    await client.call('Page.navigate',{url:CONSOLE_URL});
    await sleep(2500);
    for(let attempt=0;attempt<3;attempt++){
      try { await api(client,'overview',baseRange); return; }
      catch { if(attempt<2) await sleep(5000); }
    }
    throw new Error('LOGIN_REQUIRED: 专用会话失效或需验证码；请运行 npm run eeo:login 手动登录，当前快照不变。');
  }
  const deadline = Date.now() + LOGIN_WAIT_MS;
  let announced = false;
  while (Date.now() < deadline) {
    const pageState = await client.evaluate("({href:location.origin+location.pathname, loginInput:!!document.querySelector('input[type=password],input[autocomplete=one-time-code]')})")
      .catch(() => ({ href: "", loginInput: true }));
    if (!announced) {
      log("Please complete the EEO login in the Chrome window. The script will continue automatically afterwards.");
      announced = true;
    }
    // EEO can render its login form at admin.php without changing the URL.
    // Do not navigate the operator away from that form while they are logging in.
    const isLoginScreen = /login|passport|auth/i.test(pageState.href)
      || pageState.loginInput;
    if (!isLoginScreen) {
      await client.call("Page.navigate", { url: CONSOLE_URL });
      await sleep(2500);
      try {
        await api(client, "overview", baseRange);
        log("EEO login detected; collecting the selected range.");
        return;
      } catch { /* console SSO may still be loading */ }
    }
    await sleep(5000);
  }
  throw new Error("Timed out waiting for the EEO login (20 minutes). No data was saved.");
}

async function paged(client, action, payload, sanitize) {
  const records = [];
  for (let page = 1; page <= 100; page += 1) {
    const response = await api(client, action, { ...payload, page, pageSize: PAGE_SIZE });
    const rows = listFrom(response);
    records.push(...rows.map(sanitize).filter(Boolean));
    const total = totalFrom(response, records.length);
    if (!rows.length || page * PAGE_SIZE >= total || rows.length < PAGE_SIZE) return records;
  }
  throw new Error("EEO pagination exceeded 100 pages; narrow the capture range. No valid snapshot was overwritten.");
}

async function currentCustomerUids() {
  const snapshotPath = path.join(ROOT, "app", "data", "snapshot.json");
  try {
    const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
    const customers = Array.isArray(snapshot.customers) ? snapshot.customers : [];
    return [...new Set(customers.map((customer) => safeText(customer.uid, 32)).filter(Boolean))];
  } catch {
    return [];
  }
}

async function appendJsonl(file, rows) {
  if (!rows.length) return;
  await writeFile(file, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, { flag: "a" });
}

async function main() {
  if (fs.existsSync(collectorLock)) {
    const pid = Number(fs.readFileSync(collectorLock, 'utf8'));
    if (!Number.isInteger(pid) || pid <= 0) throw new Error('Invalid EEO collector lock; inspect it manually.');
    let live = true;
    try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') live = false; else throw error; }
    if (live) throw new Error(`EEO collector already running (PID ${pid}).`);
    fs.unlinkSync(collectorLock);
  }
  fs.writeFileSync(collectorLock, String(process.pid), {flag:'wx'});
  ownsCollectorLock = true;
  const to = process.env.EEO_CAPTURE_TO || chinaDate();
  const from = process.env.EEO_CAPTURE_FROM || dateDaysAgo(89);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    throw new Error("EEO_CAPTURE_FROM and EEO_CAPTURE_TO must be YYYY-MM-DD, and FROM cannot be later than TO");
  }
  const range = { startTime: startUnix(from), endTime: endUnix(to) };
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const outputDir = path.join(WORKSPACE, "data", `eeo_sync_${stamp}`);
  await mkdir(outputDir, { recursive: true });

  const errors = [];
  try {
    const client = await connectToChrome();
    liveClient = client;
    await waitForLogin(client, range);
    if (process.env.EEO_LOGIN_ONLY === '1') { log('专用会话已验证，关闭Chrome并保留本地会话。'); return; }
    if(process.env.EEO_SCHEMA_ONLY==='1'){
      const uid=process.env.EEO_SCHEMA_UID;
      if(!(await currentCustomerUids()).includes(uid)) throw new Error('Schema probe UID must be a current customer');
      const detail=extractPayload(await api(client,'schoolDetail',{schoolUid:uid,...range}));
      const overview=detail.overview ?? detail;
      const trend=firstDefined(detail,['analysisTrend','trend','dailyTrend','lessonTrend']);
      const schema={capturedAt:new Date().toISOString(),uid,range:{from,to},keys:Object.keys(detail),overviewKeys:Object.keys(overview),trendKeys:Array.isArray(trend)?[...new Set(trend.flatMap(row=>Object.keys(row)))]:[],aggregateArrays:Object.fromEntries(Object.entries(detail).filter(([,value])=>Array.isArray(value)).map(([key,value])=>[key,{count:value.length,keys:value.length&&typeof value[0]==='object'?Object.keys(value[0]):[]}]))};
      if(process.env.EEO_INSPECT_PUBLIC_JS==='1') {
        schema.publicClient=await client.evaluate(`(async()=>{
          const urls=[...new Set([...document.scripts].map(s=>s.src).concat(performance.getEntriesByType('resource').filter(r=>r.initiatorType==='script').map(r=>r.name)).filter(u=>u&&new URL(u).hostname.endsWith('eeo.cn')))].slice(-16);
          const output=[{assets:urls.map(u=>new URL(u).pathname)}];
          for(const url of urls){const response=await fetch(url,{signal:AbortSignal.timeout(10000)});if(!response.ok)continue;const reader=response.body.getReader();const decoder=new TextDecoder();let code='',bytes=0;try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>2097152)break;code+=decoder.decode(value,{stream:true});}}finally{await reader.cancel();reader.releaseLock();}
            const snippets=[];for(const field of ['analysisTrend','lessonCount','riskLessonCount','analyzedLessonCount']){let index=-1;for(let n=0;n<8;n++){index=code.indexOf(field,index+1);if(index<0)break;snippets.push(code.slice(Math.max(0,index-100),index+160));}}
            if(snippets.length)output.push({asset:new URL(url).pathname,snippets});
          }return output;
        })()`);
      }
      await writeFile(path.join(WORKSPACE,'diagnostics/eeo-risk-schema.json'),JSON.stringify(schema,null,2));
      log('Schema probe saved aggregate field names only; no raw response, classes or teachers saved.');return;
    }
    const overview = await api(client, "overview", range);
    // The platform response is retained only through an allow-list of aggregate fields.
    const platform = sanitizeDetail("platform", overview);
    const platformAvailable = Number.isSafeInteger(platform.analyzedLessonCount) && platform.analyzedLessonCount >= 0;
    await writeFile(path.join(outputDir, "platform.json"), `${JSON.stringify({ range: { from, to }, platform: platformAvailable ? platform : null, status: platformAvailable ? 'available' : 'aggregate_not_provided' }, null, 2)}\n`);

    const schools = await paged(client, "schoolList", {
      ...range, monitorStatus: 0, keyword: "", sortField: "week_analyzed_count", sortOrder: "desc",
    }, sanitizeSchool);
    await writeFile(path.join(outputDir, "schools.json"), `${JSON.stringify(schools, null, 2)}\n`);
    log(`Collected ${schools.length} institutions from the platform list.`);

    const customers = await currentCustomerUids();
    const targets = customers;
    if (targets.length > 200) throw new Error("More than 200 customers; split the manual capture into batches.");
    const detailsFile = path.join(outputDir, "school-details.jsonl");
    let detailedCount = 0;

    for (let index = 0; index < targets.length; index += 1) {
      const uid = targets[index];
      try {
        const detail = sanitizeDetail(uid, await api(client, "schoolDetail", { schoolUid: uid, ...range }));
        if (!Number.isSafeInteger(detail.analyzedLessonCount) || detail.analyzedLessonCount < 0) throw new Error("EEO aggregate count is missing or invalid");
        detailedCount += 1;
        await appendJsonl(detailsFile, [detail]);
      } catch (error) {
        errors.push({ stage: "school", uid, message: error.message });
      }
      if ((index + 1) % 10 === 0 || index + 1 === targets.length) log(`Institution details: ${index + 1}/${targets.length}`);
    }

    const listUids = new Set(schools.map((school) => school.uid));
    const reconciliation = {
      range: { from, to },
      customerUidCount: customers.length,
      platformInstitutionCount: schools.length,
      detailedInstitutionCount: detailedCount,
      customerUidsFoundInPlatform: customers.filter((uid) => listUids.has(uid)),
      customerUidsNotFoundInPlatform: customers.filter((uid) => !listUids.has(uid)),
      failureCount: errors.length,
      failures: errors,
      privacy: "No cookies, credentials, classroom names, people, links, ASR content, or risk text are collected.",
    };
    await writeFile(path.join(outputDir, "reconciliation.json"), `${JSON.stringify(reconciliation, null, 2)}\n`);
    await writeFile(path.join(outputDir, "manifest.json"), `${JSON.stringify({
      source: "EEO AI teaching risk monitor", capturedAt: new Date().toISOString(), range: { from, to },
      files: ["platform.json", "schools.json", "school-details.jsonl", "reconciliation.json"],
      platformInstitutionCount: schools.length, detailedInstitutionCount: detailedCount, failureCount: errors.length,
    }, null, 2)}\n`);
    log(`Done. Sanitized output saved to ${outputDir}`);
    if (process.env.EEO_RESULT_FILE) await writeFile(process.env.EEO_RESULT_FILE,JSON.stringify({outputDir,failureCount:errors.length}));
    if (errors.length) { log(`${errors.length} institution request(s) failed; output is incomplete and must not replace a valid snapshot.`); process.exitCode = 1; }
  } finally {
    await cleanup();
  }
}

async function cleanup() {
  cleaning=true;
  if (ownsCollectorLock) { ownsCollectorLock = false; await unlink(collectorLock).catch(() => {}); }
  const client=liveClient;liveClient=undefined;
  // Let Chrome flush its authorized session before the guardian force-exit fallback.
  if(client) {
    let timer;
    await Promise.race([client.call('Browser.close').catch(()=>{}),new Promise(resolve=>{timer=setTimeout(resolve,4000);})]);
    clearTimeout(timer);client.close();
  }
  if (chromeOwner?.connected) {
    await new Promise((resolve) => { const timer = setTimeout(resolve, 6000); chromeOwner.once('exit', () => { clearTimeout(timer); resolve(); }); chromeOwner.send('close'); });
  }
}
process.once('SIGINT', () => { void cleanup().finally(() => process.exit(130)); });
process.once('SIGTERM', () => { void cleanup().finally(() => process.exit(143)); });
const overallDeadline = setTimeout(() => { console.error('EEO collection exceeded 25 minutes; closing dedicated browser.'); void cleanup().finally(() => process.exit(1)); }, 25 * 60 * 1000);
overallDeadline.unref();
main().finally(async () => { clearTimeout(overallDeadline); await cleanup(); }).catch((error) => {
  if(process.env.EEO_RESULT_FILE) fs.writeFileSync(process.env.EEO_RESULT_FILE,JSON.stringify({failureCount:1,error: error.message.startsWith('LOGIN_REQUIRED') ? 'LOGIN_REQUIRED: 专用登录已失效，请运行 npm run eeo:login 完成登录。' : '采集失败或超出内存预算，保留上次有效快照。'}));
  console.error(`[EEO collector] ${error.message}`);
  process.exitCode = 1;
});
