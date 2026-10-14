# 教学风险监测看板 1.0.1

用户确认已部署版本为1.0，本次为账号打通与权限修复版本。React19 / TypeScript / Tailwind4 / Recharts，标准Node.js + Node原生SQLite，保留Vinext/Vite构建；不需要MySQL/PostgreSQL、Miniflare或workerd。

## 登录与权限

公开注册和管理员初始化永久关闭。生产默认部署AUTH_MODE=hybrid：工作台SSO与独立密码共享内部账号及工号授权，EEO04410唯一管理员，已授权销售仅查看归属客户。工作台账号停用接口撤销两种会话，只收窄权限。详见 [给工作台Codex的对接与部署说明](docs/1.0.1/工作台账号打通与部署说明.md)。

## 运行

Node >=22.13，建议24。在dashboard执行npm ci、npm run typecheck、npm run lint、npm run build。npm run start用于生产，需外置绝对DATA_DIR和完整HTTPS/认证配置。npm run dev仅本机127.0.0.1:5173，不开Chrome、采集或watch。首次账号配置走明确批准的工号映射，不通过网页注册。堆256MB、RSS预算512MB；构建堆1024MB。

## 数据与交付边界

本仓库只保存代码、空快照模板及文档，不含业务数据、真实授权清单、密钥、密码、SQLite数据库、浏览器登录态、依赖、缓存或日志。保留旧版1.0与外置数据库，不重置业务数据。EEO与CRM独立更新，失败保留有效快照；EEO继续由Windows本机npm run eeo:weekly显式运行。同步目标变更另行配置，不随SSO更新。

## 验证

npm run verify:node使用虚构客户、工号和随机测试凭据，验证空库注册关闭、唯一管理员、两种登录权限一致、JWT签名与重放、销售越权、密码设置/停用撤销、限流、SQLite事务、同步幂等及失败保护、重复启动、60秒RSS与退出清理。真实Linux/HTTPS/工作台验收结果必须另行记录。
