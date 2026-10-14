// Node releases are prepared from the reviewed Git tree; business files must not be archived.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const dir=path.join(root,'../deliveries');fs.mkdirSync(dir,{recursive:true});
const file=path.join(dir,`teaching-risk-node-${Date.now()}.zip`);
const result=spawnSync('git',['archive','--format=zip',`--output=${file}`,'HEAD'],{cwd:root,stdio:'inherit'});
if(result.status!==0)throw new Error('Commit reviewed code before packaging');console.log(file);
