import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
const run = promisify(execFile);
export async function memorySample(pid=0) {
  if (process.platform !== 'win32') throw new Error('此采集预算监控只支持Windows');
  if(!Number.isSafeInteger(pid)||pid<0) throw new Error('Invalid process ID');
  const script=await readFile(path.join(import.meta.dirname,'process-budget.ps1'),'utf8');
  // Execute ordinary terminal commands; do not alter the machine execution policy.
  const result = await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',`& {${script}} -RootPid ${pid}`],{windowsHide:true,timeout:10000,maxBuffer:1024*1024,encoding:'utf8'});
  return JSON.parse(result.stdout.replace(/^\uFEFF/,''));
}
