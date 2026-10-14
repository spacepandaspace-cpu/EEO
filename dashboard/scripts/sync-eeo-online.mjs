import { syncSnapshot } from './eeo-sync-client.mjs';
try {await syncSnapshot();}catch {console.error('线上同步未完成；本地有效快照保留。检查HTTPS地址、密钥、网络及线上数据日期，再运行 npm run eeo:sync。');process.exitCode=1;}
