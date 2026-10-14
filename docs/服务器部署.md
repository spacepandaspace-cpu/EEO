# 发给腾讯云智能体：标准 Node.js 部署

本版为 Node.js + 原生 SQLite，替代旧 Workers/Miniflare 包。请使用本版 Release 附件与 README，不运行 next build / next start / wrangler。已有静态站点不移动、不停用、不替换其 nginx 全局配置。

1. 先只读检查Linux版本、架构、内存、磁盘、Node和已有站点端口。Node >=22.13，建议24；与其他项目隔离。确认3002可用。
2. 解压到新的独立release目录，进入 dashboard。代码ZIP不含客户数据、密码或登录态。运行 npm ci（不要复制Windows node_modules），npm run typecheck、npm run lint、npm run build。若 Release 已包含 dist，可使用已构建文件，仍核对完整资源。vinext在生产dependencies中，预构建模式可 npm ci --omit=dev。
3. 创建独立服务用户 teachingrisk、持久目录 /var/lib/teaching-risk（权限700），数据库固定为其 teaching-risk.sqlite，不能放到public或随release覆盖。旧D1数据库如已有业务数据，停本项目旧进程并备份后用 scripts/migrate-legacy-sqlite.mjs <绝对旧SQLite路径> 复制迁移；不得删除原库或覆盖已存在目标库。原库user_account/source_run/eeo_snapshot/external_identity等保持。
4. 用受限 /etc/teaching-risk.env 配置 dashboard/deploy/env.template 的值。AUTH_MODE=workbench；HS256密钥至少32字符；WORKBENCH_REVOKE_MODE=ttl；工作台登录/退出固定同源HTTPS地址；同步密钥单独生成至少32字符，不能和SSO/旧站点共用。真实值不要写进仓库或日志。工号权限用 scripts/provision-workbench-users.mjs 导入已明确批准的映射，不能自动根据姓名开权限。
5. systemd模板在 dashboard/deploy/teaching-risk.service。WorkingDirectory指向本版dashboard实际目录；替换@NODE@为Node绝对路径；DATA_DIR=/var/lib/teaching-risk、PORT=3002由服务配置定义，env文件不要重复覆盖。ExecStart为 Node --max-old-space-size=256 scripts/run-server.mjs；MemoryMax=512M、重启次数有上限、KillMode=control-group。只监听127.0.0.1。
6. 先在独立DATA_DIR和3302端口试运行并 curl --max-time 10 检查 /api/health=200、首页=200、无令牌/api/eeo-sync=401。正式启动后再添加独立nginx站点反代到127.0.0.1:3002，保留已有三四个静态站点。真实HTTPS域名/证书由服务器侧处理，不使用本对话旧目标地址。
7. 通过授权渠道单独导入业务摘要和权限映射。机器同步沿用 /api/eeo-sync 的分块begin/part/commit协议，拒绝旧数据、校验失败保留有效快照。EEO采集继续在Windows本机，服务器不装Chrome、不运行采集定时任务。
8. 验收工号登录、顾问之间的数据隔离、30分钟过期、退出、本机同步、幂等和失败保留；观察至少60秒单Node内存，确认重复启动拒绝、停止后释放锁；旧静态站点逐一回归。记录Linux和真实SSO验收结果，不以页面可打开代替验收。

缺少工作台HTTPS地址/密钥、最终系统HTTPS地址、已批准账号映射时，保留隔离部署，报告具体缺项；不得自建虚构账号、关闭认证或扩大授权。
