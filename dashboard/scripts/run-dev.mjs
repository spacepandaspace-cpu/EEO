import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runtimeBindings } from './runtime-bindings.mjs';

const root = path.resolve(import.meta.dirname, '..');
const lock = path.join(root, '.dev-server.lock');
process.chdir(root);
let ownsLock = false;
let server;
let stopping = false;
let monitor;
function release() {
  if (ownsLock) { try { fs.unlinkSync(lock); } catch {} ownsLock = false; }
}
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  clearInterval(monitor);
  const deadline = setTimeout(() => { release(); process.exit(code || 1); }, 5000);
  deadline.unref();
  try { await server?.close(); } finally { release(); process.exit(code); }
}
process.once('exit', release);
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
try {
  if (fs.existsSync(lock)) {
    const pid = Number(fs.readFileSync(lock, 'utf8'));
    if (!Number.isInteger(pid) || pid <= 0) throw new Error('开发锁无效，请检查 .dev-server.lock');
    let live = true;
    try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') live = false; else throw error; }
    if (live) throw new Error(`本项目开发服务已运行（PID ${pid}），拒绝重复启动。`);
    fs.unlinkSync(lock);
  }
  fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
  ownsLock = true;
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', () => reject(new Error('5173 已被占用，拒绝启动第二个服务。')));
    probe.listen(5173, '127.0.0.1', () => probe.close(resolve));
  });
  const migrated = spawnSync(process.execPath, ['--max-old-space-size=128', 'scripts/migrate-local-db.mjs'], { stdio: 'inherit' });
  if (migrated.status !== 0) throw new Error('本地数据库迁移失败');
  const parentPid = process.ppid;
  monitor = setInterval(() => {
    try { process.kill(parentPid, 0); } catch { console.error('启动父进程已退出，关闭开发服务。'); void stop(1); }
    if (process.memoryUsage().rss > (process.env.EEO_VITE_DEV === "1" ? 1024 : 512) * 1024 * 1024) {
      console.error('本地服务超过 RSS 内存预算，已停止；请关闭占用内存的程序后重试。');
      void stop(1);
    }
  }, 5000);
  monitor.unref();
  if (process.env.EEO_VITE_DEV === '1') {
    const { createServer } = await import('vite');
    server = await createServer({ root, server: { host: '127.0.0.1', port: 5173, strictPort: true, open: false } });
    await server.listen();
    server.printUrls();
  } else {
    const main = path.join(root, 'dist/server/index.js');
    if (!fs.existsSync(main)) throw new Error('尚无生产构建，请先 npm run build；默认启动不会自动进行重型编译。');
    const client = path.join(root, 'dist/client');
    const assets = fs.existsSync(client) ? fs.readdirSync(client, {recursive:true, withFileTypes:true}) : [];
    if (!assets.some(entry => entry.isFile() && entry.name.endsWith('.js')) || !assets.some(entry => entry.isFile() && entry.name.endsWith('.css'))) {
      throw new Error('浏览器JS/CSS构建缺失，拒绝启动不完整页面。请停止服务后执行 npm run build。');
    }
    const config = JSON.parse(fs.readFileSync(path.join(root, 'dist/server/wrangler.json'), 'utf8'));
    const { Miniflare } = await import('miniflare');
    const runtime = new Miniflare({
      host: '127.0.0.1', port: 5173,
      name: config.name, modulesRoot: path.dirname(main),
      modules: [main, ...fs.readdirSync(path.dirname(main), {recursive:true, withFileTypes:true})
        .filter(entry => entry.isFile() && /\.m?js$/.test(entry.name))
        .map(entry => path.join(entry.parentPath, entry.name)).filter(file => file !== main)]
        .map(file => ({type:'ESModule', path:file, contents:fs.readFileSync(file,'utf8')})),
      compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
      d1Databases: Object.fromEntries(config.d1_databases.map(db => [db.binding, db.database_id])),
      d1Persist: path.join(root, '.wrangler/state/v3/d1'),
      bindings: runtimeBindings(),
      assets: { directory: path.join(root, 'dist/client'), routerConfig: {has_user_worker:true} },
    });
    server = {close: () => runtime.dispose()};
    await runtime.ready;
    console.log('低内存本地服务 http://127.0.0.1:5173/；运行已构建版本，文件 watch 为0。修改后请停止服务并 npm run build。');
  }
  console.log(`本地服务 PID ${process.pid}；默认堆上限256MB/RSS预算512MB；不会自动启动浏览器或采集。`);
} catch (error) { console.error(error.message); await stop(1); }
