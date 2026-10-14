import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const entries=await fs.readdir(path.join(root,'dist/server'),{recursive:true});
for(const name of entries.filter(n=>n.endsWith('.js'))){const code=await fs.readFile(path.join(root,'dist/server',name),'utf8');assert(!code.includes('cloudflare:workers'),'Worker binding in Node build');}
console.log('Node build contains no cloudflare:workers binding');
