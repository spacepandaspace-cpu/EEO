# 教学风险监测：Node.js + SQLite

React / TypeScript / Tailwind / Recharts 保留。Vinext/Vite 只负责构建与 Node HTTP 页面服务；生产不使用 cloudflare:workers、Miniflare、workerd 或远程 D1。数据库是 Node 内置 node:sqlite，单文件持久化，无 MySQL/PostgreSQL。

## 本地使用
Node >=22.13，建议 Node 24。在 dashboard 目录执行 npm ci、npm run typecheck、npm run lint、npm run build。构建后 npm run dev 启动唯一127.0.0.1:5173服务，不开启浏览器、采集或文件监听。需要明确热更新时使用 npm run dev:vite，不与默认服务同时启动。

## 服务器
见 docs/服务器部署.md。npm run start 是生产命令，必须配置 AUTH_MODE=workbench 和外置绝对 DATA_DIR。运行时堆上限256MB、RSS预算512MB；构建堆上限1024MB。SQLite教学风险数据库固定为 DATA_DIR/teaching-risk.sqlite；WAL、5秒锁等待、批量操作在单个事务内完成。

## 数据更新
本机 dashboard 中 npm run eeo:login 显式登录、npm run eeo:weekly 手动采集、npm run eeo:schedule 安装每周任务。不会因启动页面而采集。EEO与CRM独立更新，失败保留上一次有效快照。在线同步接口和分块协议不变。数据库备份 npm run backup；从旧D1兼容SQLite转入使用 node scripts/migrate-legacy-sqlite.mjs <旧数据库绝对路径>，只复制，不删除原库。

## 边界和验证
GitHub只保存代码、空快照与文档。客户明细、工作簿、身份映射、真实密钥、浏览器登录会话、数据库和日志不提交。历史业务分析/CRM核验脚本需要单独提供真实数据；身份授权不能通过姓名猜测。

npm run verify:node 验证真实Node服务的SQLite事务回滚、登录与工号隔离、同步幂等、失败保留、重复启动拒绝及60秒RSS观察，使用虚构数据并自动退出。真实Linux、HTTPS、工作台密钥和生产数据联调仍需在服务器验收。
