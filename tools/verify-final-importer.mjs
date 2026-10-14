import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {importSummary,buildBatch} from './import-initial-summary.mjs';
const base=path.resolve(import.meta.dirname,'..');
const root=path.join(base,'dashboard');
const {Miniflare}=createRequire(path.join(root,'package.json'))('miniflare');
const release=JSON.parse(await fs.readFile(path.join(base,'diagnostics/latest-server-delivery.json'),'utf8')).delivery;
const server=path.join(release,'runtime/dist/server');
const main=path.join(server,'index.js');
const entries=await fs.readdir(server,{recursive:true,withFileTypes:true});
const modules=await Promise.all([main,...entries.filter(e=>e.isFile()&&/\.m?js$/.test(e.name)).map(e=>path.join(e.parentPath,e.name)).filter(f=>f!==main)].map(async file=>({type:'ESModule',path:file,contents:await fs.readFile(file,'utf8')})));
const config=JSON.parse(await fs.readFile(path.join(server,'wrangler.json'),'utf8'));
const token=randomBytes(32).toString('hex');
const runtime=new Miniflare({modulesRoot:server,modules,name:config.name,compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags,d1Databases:{DB:'final-import-test'},d1Persist:false,bindings:{EEO_SYNC_TOKEN:token},assets:{directory:path.join(release,'runtime/dist/client'),routerConfig:{has_user_worker:true}}});
try {
  const db=await runtime.getD1Database('DB');
  for(const file of ['0000_tricky_gertrude_yorkes.sql','0001_data_refresh.sql','0002_live_eeo_snapshot.sql','0003_workbench_identity.sql']){
    const sql=await fs.readFile(path.join(release,'runtime/drizzle',file),'utf8');
    for(const statement of sql.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
  }
  const manifest=JSON.parse(await fs.readFile(path.join(release,'MANIFEST.json'),'utf8'));
  const expectedHash=manifest.artifacts.find(a=>a.file==='initial-summary.json').sha256;
  const file=path.join(release,'initial-summary.json');
  const transport=(url,options)=>runtime.dispatchFetch(url,options);
  const settings={file,expectedHash,origin:'https://final-import.invalid',token,transport};
  const first=await importSummary(settings);
  const second=await importSummary(settings);
  assert(first.complete&&second.complete);
  assert.equal(first.batchId,second.batchId);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM eeo_snapshot').first()).n,first.parts);
  const before=(await db.prepare("SELECT json FROM eeo_snapshot WHERE key='overview'").first()).json;
  await assert.rejects(importSummary({...settings,token:'x'.repeat(32)}));
  await assert.rejects(importSummary({...settings,expectedHash:'0'.repeat(64)}));
  await assert.rejects(importSummary({...settings,origin:'http://175.24.138.38:8002'}));
  await assert.rejects(importSummary({...settings,origin:'https://final-import.invalid/?token=bad'}));
  assert.equal((await db.prepare("SELECT json FROM eeo_snapshot WHERE key='overview'").first()).json,before);
  assert.throws(()=>buildBatch({customers:[],customerDaily:[]}));
  const report={baseline:path.basename(release),initialImport:true,repeatIdempotent:true,badSecretRejected:true,hashMismatchRejected:true,publicHttpRejected:true,unsafeOriginRejected:true,dataUnchangedAfterRejection:true,parts:first.parts,customerCount:first.customers,realServerContacted:false,temporarySecretsOnly:true};
  await fs.writeFile(path.join(base,'diagnostics/最终交付_首次导入验收_2026-10-09.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
} finally {await runtime.dispose();}
