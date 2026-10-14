// Explicit local NDJSON aggregate import. Never serves raw data or touches snapshot.
import http from 'node:http';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const dir = path.resolve(import.meta.dirname, '../data/manual-aggregate-imports');
await mkdir(dir, { recursive: true });
let busy = false;
const server = http.createServer(async (req, res) => {
  const respond = (status, body) => { if (!res.destroyed) { res.writeHead(status, {'Content-Type':'application/json', 'Cache-Control':'no-store'}); res.end(JSON.stringify(body)); } };
  if (req.method === 'GET' && req.url === '/health') return respond(200, {ok:true, manualOnly:true});
  if (req.method !== 'POST' || req.url !== '/capture') return respond(410, {error:'Only explicit POST /capture application/x-ndjson aggregate imports are supported.'});
  if (req.headers.origin && req.headers.origin !== 'http://127.0.0.1:8766') return respond(403, {error:'Cross-origin import refused'});
  if (!req.headers['content-type']?.startsWith('application/x-ndjson')) return respond(415, {error:'Use application/x-ndjson; one aggregate row per line.'});
  if (busy) return respond(429, {error:'Another import is running'});
  if (Number(req.headers['content-length']) > 2*1024*1024) return respond(413, {error:'Split imports into files smaller than 2MB'});
  busy = true;
  const id = randomUUID();
  const temp = path.join(dir, `${id}.tmp`);
  let file, bytes = 0, rows = 0, pending = '';
  const deadline = setTimeout(() => req.destroy(new Error('Import timed out')), 30000);
  try {
    file = await open(temp, 'wx');
    const save = async (line) => {
      if (!line.trim()) return;
      if (++rows > 2000 || Buffer.byteLength(line) > 16384) throw new Error('Batch exceeds 2000 rows or 16KB per row');
      const row = JSON.parse(line);
      if (!/^\d{1,32}$/.test(String(row.uid)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(row.date))) throw new Error('Invalid UID/date');
      const safe = {uid:String(row.uid), date:String(row.date)};
      for (const key of ['lessons','low','medium','high','reviewed','falsePositive']) {
        if (!Number.isSafeInteger(row[key]) || row[key] < 0) throw new Error(`Invalid aggregate ${key}`);
        safe[key] = row[key];
      }
      await file.write(`${JSON.stringify(safe)}\n`);
    };
    req.setEncoding('utf8');
    for await (const chunk of req) {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 2*1024*1024) throw new Error('Request exceeds 2MB');
      pending += chunk;
      let index;
      while ((index = pending.indexOf('\n')) >= 0) { const line = pending.slice(0,index); pending = pending.slice(index+1); await save(line); }
      if (Buffer.byteLength(pending) > 16384) throw new Error('Line exceeds 16KB');
    }
    await save(pending); pending = '';
    if (!rows) throw new Error('Empty import');
    await file.close(); file = undefined;
    await rename(temp, path.join(dir, `${id}.jsonl`));
    respond(201, {ok:true,batchId:id,rows,bytes, snapshotUpdated:false});
  } catch (error) { respond(400, {error:error.message, snapshotUpdated:false}); }
  finally { clearTimeout(deadline); await file?.close(); await rm(temp,{force:true}); busy = false; }
});
server.requestTimeout = 30000;
server.headersTimeout = 10000;
server.timeout = 30000;
server.maxConnections = 4;
server.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => { server.close(); server.closeAllConnections(); });
const parentPid = process.ppid;
const lifetime = setInterval(() => { try { process.kill(parentPid,0); } catch { server.close(); server.closeAllConnections(); clearInterval(lifetime); } },5000);
lifetime.unref();
server.listen(8766,'127.0.0.1', () => console.log('Explicit aggregate bridge PID '+process.pid+' on 127.0.0.1:8766; raw/classroom/teacher data are discarded.'));
