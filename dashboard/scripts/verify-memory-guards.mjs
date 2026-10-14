import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const source = JSON.parse(await fs.readFile(new URL('app/data/snapshot.json', root), 'utf8'));
const compile = async (file) => ts.transpileModule(await fs.readFile(new URL(file, root), 'utf8'), {
  compilerOptions: {target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.ESNext},
}).outputText.replace(/^import .*;\r?\n/gm, '').replace(/\bexport /g, '');
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const buildApi = new AsyncFunction('source','getAuthenticatedUser', 'const liveSnapshot=async()=>source; const liveCustomerDaily=async(uid)=>source.customerDaily.filter(row=>row.uid===uid).slice(-365);\n'+await compile('app/api/dashboard/route.ts')+'\nreturn GET;');
const admin = await buildApi(source, async () => ({role:'admin'}));
const summaryResponse = await admin(new Request('http://local/api/dashboard'));
const summaryText = await summaryResponse.text();
const summary = JSON.parse(summaryText);
assert.equal(summary.customerDaily.length, 0);
assert.equal(summary.customerAliases.length, 0);
assert.equal(summary.customers.length, 92);
assert.deepEqual(summary.baselines, source.baselines);
assert(Buffer.byteLength(summaryText) < 150_000);
const uid = source.customers[0].uid;
const detail = await (await admin(new Request(`http://local/api/dashboard?uid=${uid}`))).json();
assert(detail.customerDaily.length <= 365);
assert(detail.customerDaily.every(row => row.uid === uid));
const consultant = await buildApi(source, async () => ({role:'consultant', consultantName:'__no_authorized_customer__'}));
assert.equal((await consultant(new Request(`http://local/api/dashboard?uid=${uid}`))).status,403);
const owner = source.customers.find(customer => source.customerDaily.some(row => row.uid === customer.uid && row.date >= '2026-09-21' && row.risk > 0));
const ownedApi = await buildApi(source, async () => ({role:'consultant', consultantName:owner.consultant}));
const owned = await (await ownedApi(new Request('http://local/api/dashboard'))).json();
assert(owned.dailyAggregate.some(row=>row.date>='2026-09-21' && row.risk>0));
assert(owned.dailyAggregate.filter(row=>row.date>='2026-09-21').every(row=>row.reviewed===null && row.falsePositive===null));
assert.equal(owned.baselines.reviewedLessons,null);
assert.equal(owned.baselines.falsePositiveLessons,null);
const anon = await buildApi(source, async () => null);
assert.equal((await anon(new Request('http://local/api/dashboard'))).status,401);

const buildFetch = new AsyncFunction('fetch', await compile('lib/bounded-fetch.ts')+'\nreturn boundedFetch;');
let cancelled = false;
const oversized = await buildFetch(async () => new Response(new ReadableStream({
  start(controller) {controller.enqueue(new Uint8Array(1048577));},
  cancel() {cancelled=true;},
})));
await assert.rejects(() => oversized('http://mock'), /1MB/);
assert(cancelled, 'Oversized response stream must be cancelled');
const disconnected = await buildFetch(async () => {throw new TypeError('fetch failed');});
await assert.rejects(() => disconnected('http://mock'), /内存不足/);
const controller = new AbortController();
const abortable = await buildFetch(async (_input, init) => new Promise((_resolve,reject) => {
  init.signal.addEventListener('abort', () => reject(new DOMException('Aborted','AbortError')), {once:true});
}));
const pending = abortable('http://mock', {signal:controller.signal});
controller.abort();
await assert.rejects(() => pending, /已取消/);
console.log(JSON.stringify({summaryBytes:Buffer.byteLength(summaryText), fullSnapshotBytes:Buffer.byteLength(JSON.stringify(source)), customerRows:summary.customers.length, detailRows:detail.customerDaily.length, authorization:true, responseBudget:true, streamCancellation:true, networkError:true, abort:true}));

const {readLimitedBody} = await new AsyncFunction(await compile('lib/bounded-request.ts')+'\nreturn {readLimitedBody};')();
await assert.rejects(() => readLimitedBody(new Request('http://mock',{method:'POST',body:'x'.repeat(20000)})), /超过/);
const smallBody = await readLimitedBody(new Request('http://mock',{method:'POST',body:'{"ok":true}'}));
assert.equal(new TextDecoder().decode(smallBody),'{"ok":true}');
console.log('Server streaming request budget: passed');
