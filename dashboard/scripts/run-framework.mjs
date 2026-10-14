import {spawn} from 'node:child_process';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');const mode=process.argv[2]||'dev';
const args=mode==='build'?['--max-old-space-size=1024','node_modules/vinext/dist/cli.js','build']:['--max-old-space-size=256','scripts/run-server.mjs',...(mode==='dev'?['--local']:[])];
const child=spawn(process.execPath,args,{cwd:root,stdio:'inherit',windowsHide:true});
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>child.kill(signal));child.once('exit',code=>{process.exitCode=code||0;});
