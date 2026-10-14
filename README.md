# 教学风险监测

客户运营看板源码：React、TypeScript、Tailwind CSS、Recharts、Vinext/Vite，Node.js >=22.13；数据使用 D1 兼容 SQLite，不需要 MySQL/PostgreSQL。

## 目录
- dashboard：完整看板、服务端接口、数据库结构、采集与同步脚本。
- tools：本地启动、辅助分析及交付工具。
- docs：部署说明。

## 安装和构建
在 dashboard 目录执行 `npm ci`、`npm run typecheck`、`npm run lint`、`npm run build`。生产运行配置见 dashboard/deploy；Linux 只运行服务端，不启动 Chrome 或 EEO 采集。

## 本地采集
采集电脑在 dashboard 目录执行 `npm run eeo:login` 完成专用登录，再执行 `npm run eeo:weekly`。定时任务使用 `npm run eeo:schedule`。登录状态失效时停止，不读取密码或无限重试。同步地址和密钥仅放本机私有配置。

## 数据与安全边界
本仓库只保存代码与文档，snapshot.json 是空模板。客户快照、EEO 原始采集、CRM 工作簿、身份授权映射、数据库、浏览器 profile、密码、令牌和日志均单独保留，不提交。首次部署必须通过授权渠道导入业务摘要并配置工作台身份与同步密钥；构建成功不代表生产 SSO 已验收。

部分历史验证/分析/交付脚本依赖本地业务文件，仓库不包含这些数据，不能将其运行成功作为通用安装条件。CRM 中已确认的排除、净额及关联规则仍保留在代码中。
