// Dedicated collector Chrome only. IPC disconnect covers parent crash/termination.
import { spawn, spawnSync } from 'node:child_process';
import { rm, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { memorySample } from './process-budget.mjs';

const root = path.resolve(import.meta.dirname, '..');
const persistent = process.env.EEO_PERSISTENT_SESSION === '1';
const unattended = process.env.EEO_UNATTENDED === '1';
const profile = persistent ? path.join(root,'.eeo-browser-weekly') : await mkdtemp(path.join(root, '.eeo-browser-'));
await mkdir(profile,{recursive:true});
// Chrome manages the authorized session; never read cookies or credentials.
const defaults=path.join(profile,'Default');await mkdir(defaults,{recursive:true});
const prefsPath=path.join(defaults,'Preferences');
const prefsText=await readFile(prefsPath,'utf8').catch(error=>{if(error.code==='ENOENT')return '{}';throw error;});
if(Buffer.byteLength(prefsText)>1048576) throw new Error('专用Chrome配置超过1MB预算');
const prefs=JSON.parse(prefsText);prefs.credentials_enable_service=false;
prefs.profile={...prefs.profile,password_manager_enabled:false};
if(persistent) prefs.session={...prefs.session,restore_on_startup:1};
await writeFile(prefsPath,JSON.stringify(prefs));
const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid collector port');
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const args = [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions', '--new-window', 'https://zxjsmgr.eeo.cn/eeos_admin/admin.php'];
args.unshift('--js-flags=--max-old-space-size=128','--disable-features=PasswordManagerOnboarding,PasswordManagerEnableSaveAndFill,OptimizationGuideOnDeviceModel,OptimizationGuideModelDownloading,OptimizationHints,OptimizationTargetPrediction','--disable-background-mode');
if(persistent) args.unshift('--restore-last-session');
if (unattended) args.unshift('--headless=new');
const chrome = spawn(chromePath, args, { stdio: 'ignore', windowsHide: unattended });
let closing = false;
let lastSample;
let checking = false;
let failures=0;
const monitor = setInterval(async()=>{
  if(process.env.EEO_SUPERVISED==='1') return;
  if (checking || closing) return;
  checking=true;
  try {
    lastSample=await memorySample(process.pid);
    failures=0;
    if(lastSample.totalMB>600 || lastSample.freeMB<512) {
      console.error('专用采集浏览器达到600MB预算或整机可用内存不足512MB；终止本次采集。');
      await cleanup(1);
    }
  } catch { if(++failures>=3){console.error('连续三次无法读取浏览器内存预算，停止采集。');await cleanup(1);} }
  finally{checking=false;}
},5000);
async function cleanup(code=0) {
  if (closing) return;
  closing = true;
  clearTimeout(deadline);
  clearInterval(monitor);
  if (chrome.pid && chrome.exitCode === null) {
    if(!lastSample) lastSample=await memorySample(process.pid).catch(()=>null);
    if(lastSample) console.log(JSON.stringify({stoppingDedicatedProcesses:lastSample.processes}));
    console.log(`[EEO cleanup] 停止本次专用 Chrome PID ${chrome.pid}; command: ${chromePath} --user-data-dir=${profile}`);
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else chrome.kill('SIGTERM');
  }
  // Only the freshly-created, unique collector profile can be removed.
  if (!persistent && path.dirname(profile) === root && path.basename(profile).startsWith('.eeo-browser-')) {
    try { await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); }
    catch { console.error('专用临时 profile 被锁定，未删除；Vite 已忽略该目录。'); }
  }
  process.exit(code);
}
const deadline = setTimeout(() => void cleanup(), 25 * 60 * 1000);
process.once('disconnect', () => void cleanup());
process.on('message', () => void cleanup());
process.once('SIGINT', () => void cleanup());
process.once('SIGTERM', () => void cleanup());
chrome.once('error', () => void cleanup());
chrome.once('exit', () => void cleanup());
process.send?.({ pid: chrome.pid });
