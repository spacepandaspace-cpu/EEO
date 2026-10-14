import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
const base=path.resolve(root,'..');
const sourceFile=path.join(root,'app/data/snapshot.json');
const original=await fs.readFile(sourceFile);
const originalHash=createHash('sha256').update(original).digest('hex');
const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\..+$/,'');
const delivery=process.env.EEO_DELIVERY_DIR ? path.resolve(process.env.EEO_DELIVERY_DIR) : path.join(base,'交付包',`teaching-risk-${stamp}`);
if(!delivery.startsWith(base+path.sep))throw new Error('Delivery directory must remain inside 看板搭建');
const stage=process.env.EEO_DELIVERY_DIR ? path.join(delivery,'_build') : path.join(base,'diagnostics',`delivery-build-${stamp}`);
const snapshot=JSON.parse(original);
// Explicit fixture fields prevent newly added business fields from entering code.
const empty={version:'0.0.1',asOf:'1970-01-01 00:00:00',customers:[],dailyAggregate:[],customerDaily:[],consultants:[],customerAliases:[],metricDefinitions:[],sourceMetadata:{eeo:{dataAsOf:'1970-01-01'},crm:{dataAsOf:'1970-01-01',status:'awaiting_initial_sync'}},baselines:Object.fromEntries(Object.keys(snapshot.baselines).map(key=>[key,0]))};
const folders=['app','lib','components','hooks','public','build','vendor','.openai','db','scripts','drizzle','deploy'];
const configFiles=['package.json','package-lock.json','vite.config.ts','next.config.ts','tsconfig.json','cloudflare-env.d.ts','postcss.config.mjs','eslint.config.mjs','drizzle.config.ts','components.json'];
await fs.mkdir(stage,{recursive:true});
await fs.mkdir(delivery,{recursive:true});
for(const folder of folders)await fs.cp(path.join(root,folder),path.join(stage,folder),{recursive:true});
for(const file of configFiles)await fs.copyFile(path.join(root,file),path.join(stage,file));
await fs.writeFile(path.join(stage,'app/data/snapshot.json'),JSON.stringify(empty,null,2)+'\n');
const dependencies=path.join(stage,'node_modules');
await fs.symlink(path.join(root,'node_modules'),dependencies,process.platform==='win32'?'junction':'dir');
try {
 const result=spawnSync(process.execPath,['--max-old-space-size=768','scripts/run-framework.mjs','build'],{cwd:stage,stdio:'inherit'});
 if(result.status!==0)throw new Error('Isolated sanitized production build failed');
}finally{
 // Unlink only the junction; do not delete existing dependency contents.
 await fs.unlink(dependencies);
}
if(createHash('sha256').update(await fs.readFile(sourceFile)).digest('hex')!==originalHash)throw new Error('Live snapshot changed during isolated build; refusing publication');
const runtime=path.join(delivery,'runtime');await fs.mkdir(path.join(runtime,'scripts'),{recursive:true});
await fs.cp(path.join(stage,'dist'),path.join(runtime,'dist'),{recursive:true});
await fs.cp(path.join(stage,'drizzle'),path.join(runtime,'drizzle'),{recursive:true,filter:file=>!file.includes(`${path.sep}meta`)});
for(const file of ['run-server.mjs','worker-entry.mjs','runtime-bindings.mjs','provision-workbench-users.mjs'])await fs.copyFile(path.join(root,'scripts',file),path.join(runtime,'scripts',file));
const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));pkg.scripts={start:'node --max-old-space-size=256 scripts/run-server.mjs','users:import':'node --max-old-space-size=128 scripts/provision-workbench-users.mjs'};
await fs.writeFile(path.join(runtime,'package.json'),JSON.stringify(pkg,null,2));
await fs.copyFile(path.join(root,'package-lock.json'),path.join(runtime,'package-lock.json'));
await fs.cp(path.join(root,'deploy'),path.join(runtime,'deploy'),{recursive:true});
await fs.writeFile(path.join(delivery,'initial-summary.json'),original);
const code=path.join(delivery,'source');await fs.mkdir(code,{recursive:true});
for(const folder of folders)await fs.cp(path.join(stage,folder),path.join(code,folder),{recursive:true});
for(const file of configFiles)await fs.copyFile(path.join(stage,file),path.join(code,file));
for(const name of ['runtime','source']){
 const result=spawnSync(process.platform==='win32'?'tar.exe':'tar',['-czf',path.join(delivery,`${name}.tar.gz`),'-C',delivery,name],{stdio:'inherit'});
 if(result.status!==0)throw new Error('Archive failed');
}
const manifest={isolatedBuild:true,liveSnapshotUnchanged:true,snapshotRestored:true,snapshotHash:originalHash,realBusinessData:'initial-summary.json only',excluded:['node_modules','browser profiles','credentials','runtime databases','logs','backups','private settings'],artifacts:[]};
for(const file of ['runtime.tar.gz','source.tar.gz','initial-summary.json']){const bytes=await fs.readFile(path.join(delivery,file));manifest.artifacts.push({file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
await fs.writeFile(path.join(delivery,'MANIFEST.json'),JSON.stringify(manifest,null,2));
await fs.writeFile(path.join(base,'diagnostics/latest-server-delivery.json'),JSON.stringify({delivery,...manifest},null,2));
console.log(`Delivery prepared: ${delivery}. Existing local dist and business snapshot were not modified.`);
