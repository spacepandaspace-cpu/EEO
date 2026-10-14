import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
const record=JSON.parse(await fs.readFile(path.join(root,'../diagnostics/latest-server-delivery.json'),'utf8'));
const delivery=record.delivery;
if(!delivery.startsWith(path.resolve(root,'../交付包')+path.sep))throw new Error('Delivery must stay in approved output directory');
for(const file of ['run-server.mjs','worker-entry.mjs','runtime-bindings.mjs','provision-workbench-users.mjs'])await fs.copyFile(path.join(root,'scripts',file),path.join(delivery,'runtime/scripts',file));
await fs.cp(path.join(root,'scripts'),path.join(delivery,'source/scripts'),{recursive:true});
await fs.cp(path.join(root,'db'),path.join(delivery,'source/db'),{recursive:true});
for(const file of ['drizzle.config.ts','components.json'])await fs.copyFile(path.join(root,file),path.join(delivery,'source',file));
await fs.copyFile(path.join(root,'../联动部署确认与交付_2026-10-09.md'),path.join(delivery,'联动部署确认与交付_2026-10-09.md'));
await fs.copyFile(path.join(root,'../联动部署二次回复_2026-10-09.md'),path.join(delivery,'联动部署二次回复_2026-10-09.md'));
const fixture=JSON.parse(await fs.readFile(path.join(delivery,'source/app/data/snapshot.json'),'utf8'));
if(fixture.customers.length||fixture.customerDaily.length)throw new Error('Source snapshot must be empty');
async function files(dir){const output=[];for(const entry of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())output.push(...await files(file));else output.push(file);}return output;}
const bundled=await files(path.join(delivery,'runtime/dist'));
for(const file of bundled.filter(file=>file.endsWith('.js'))){const text=await fs.readFile(file,'utf8');if(text.includes('41623586')||text.includes('文星教育'))throw new Error('Real business data found in compiled bundle');}
for(const folder of ['runtime','source']){
 const listing=await files(path.join(delivery,folder));
 if(listing.some(file=>/(?:^|[\\/])(?:node_modules|\.env[^\\/]*|\.eeo-browser-profile|\.chrome-debug-local|\.chrome-preview-profile)(?:[\\/]|$)|\.(sqlite|sqlite3|db)$/i.test(file)))throw new Error('Private runtime file in delivery');
 const result=spawnSync('tar.exe',['-czf',path.join(delivery,`${folder}.tar.gz`),'-C',delivery,folder],{stdio:'inherit'});
 if(result.status!==0)throw new Error('Archive failed');
}
const manifest=JSON.parse(await fs.readFile(path.join(delivery,'MANIFEST.json'),'utf8'));
manifest.artifacts=[];
for(const file of ['runtime.tar.gz','source.tar.gz','initial-summary.json']){const bytes=await fs.readFile(path.join(delivery,file));manifest.artifacts.push({file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
manifest.cleanSourceSnapshot=true;manifest.compiledBusinessMarkersAbsent=true;
await fs.writeFile(path.join(delivery,'MANIFEST.json'),JSON.stringify(manifest,null,2));
await fs.writeFile(path.join(root,'../diagnostics/latest-server-delivery.json'),JSON.stringify({delivery,...manifest},null,2));
console.log(JSON.stringify({delivery,cleanSourceSnapshot:true,compiledBusinessMarkersAbsent:true,artifacts:manifest.artifacts.map(({file,bytes})=>({file,bytes}))}));
