# 服务器部署操作手册

## 1. 负责人只读检查
不要把SSH密钥、密码、JWT发到聊天。
~~~bash
cat /etc/os-release
uname -m
free -m
df -h /
command -v node npm nginx
node -v
sudo ss -ltnp
sudo systemctl status nginx --no-pager
sudo nginx -T
~~~
nginx -T由负责人本地查看，不公开包含其他网站配置的完整输出。先记录既有网站URL和HTTP状态。确认3002、3302未被占用，不停止其他应用；冲突则为本应用另选端口，统一修改PORT、代理和测试命令。

要求Node>=22.13；已测Windows Node24，Linux须验收。优先x86_64；ARM需先确认所有原生依赖能安装。发行版非Ubuntu/Debian时，不照搬apt；由负责人安装依赖。Node若过旧，在本应用隔离目录安装受支持版本，不替换其他网站的Node。本文示例使用/opt/teaching-risk/node/bin/node；如使用既有受支持Node，填实际绝对路径。Node从官方渠道安装，不能复制Windows node_modules。

## 2. 独立用户与持久目录
确认以下目录未属于别的应用后执行：
~~~bash
getent passwd teachingrisk || sudo useradd --system --home /var/lib/teaching-risk --shell /usr/sbin/nologin teachingrisk
sudo install -d -m 755 /opt/teaching-risk/releases
sudo install -d -o teachingrisk -g teachingrisk -m 700 /var/lib/teaching-risk
sudo install -d -o teachingrisk -g teachingrisk -m 700 /var/backups/teaching-risk
~~~
缺少这些工具或systemd时由负责人按发行版适配；不重装服务器。

## 3. 代码安装
代码ZIP上传独立临时目录，解压并与CHECKSUMS.json核对SHA256。业务ZIP另存受限目录，不发布到网站。
~~~bash
APP_RELEASE=/opt/teaching-risk/releases/20261014
NODE=/opt/teaching-risk/node/bin/node
NPM=/opt/teaching-risk/node/bin/npm
sudo install -d -o teachingrisk -g teachingrisk -m 755 "$APP_RELEASE"
# 在解压后的“代码与部署说明”目录执行
sudo tar -xzf runtime.tar.gz -C "$APP_RELEASE" --strip-components=1
sudo chown -R teachingrisk:teachingrisk "$APP_RELEASE"
"$NODE" -v
sudo -u teachingrisk env PATH="$(dirname "$NODE"):$PATH" "$NPM" ci --omit=dev --prefix "$APP_RELEASE"
~~~
runtime.tar.gz已构建；source.tar.gz用于审查维护。安装报架构或引擎错误时停止，不能跳过校验。

## 4. 环境配置与隔离检查
~~~bash
sudo install -o root -g root -m 600 配置/teaching-risk.env.template /etc/teaching-risk.env
sudoedit /etc/teaching-risk.env
sudo install -d -o teachingrisk -g teachingrisk -m 700 /var/lib/teaching-risk-staging
sudo systemd-run --unit=teaching-risk-staging --service-type=simple --property=User=teachingrisk --property=WorkingDirectory="$APP_RELEASE" --property=EnvironmentFile=/etc/teaching-risk.env --property=MemoryMax=512M --property=MemorySwapMax=128M --setenv=PORT=3302 --setenv=DATA_DIR=/var/lib/teaching-risk-staging "$NODE" --max-old-space-size=256 scripts/run-server.mjs
curl --fail --max-time 10 http://127.0.0.1:3302/api/health
curl --max-time 10 -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3302/api/eeo-sync
sudo systemctl stop teaching-risk-staging
~~~
health应200，未认证同步接口401。EnvironmentFile只填认证参数和密钥，不写PORT或DATA_DIR，以免覆盖隔离服务的端口和数据目录；正式参数由systemd模板定义。真实密钥仅受限文件保存，不放命令参数或日志。WORKBENCH_SECRET为双方专用登录密钥；EEO_SYNC_TOKEN为新的独立机器同步密钥，至少32字符，不复用旧服务器密钥。实际工作台HTTPS登录/退出地址由同事提供。禁止生产设置SERVER_TEST_MODE。

## 5. 正式启动与已有nginx接入
首次部署current不存在时：
~~~bash
sudo ln -s "$APP_RELEASE" /opt/teaching-risk/current
sed "s|@NODE@|$NODE|g" 配置/teaching-risk.service.template > /tmp/teaching-risk.service
sudo install -m 644 /tmp/teaching-risk.service /etc/systemd/system/teaching-risk.service
sudo systemctl daemon-reload
sudo systemctl enable --now teaching-risk
curl --fail --max-time 10 http://127.0.0.1:3002/api/health
~~~
current已存在则按04升级，不覆盖未知路径。数据库位于/var/lib/teaching-risk，升级release不覆盖数据。

由负责人提供最终域名和可信证书。nginx模板只是一份新增站点片段，不是全局nginx.conf替换文件；按现有面板、容器或nginx管理方式添加。不要安装第二套nginx，不抢占default_server，不将业务数据放static root。服务器公网只暴露最终HTTPS入口，3002仅监听127.0.0.1。
~~~bash
sudo nginx -t
# 仅上一步成功才执行
sudo systemctl reload nginx
~~~
核验原网站全部仍可访问。域名/TLS未就绪不向公网HTTP发送密钥、JWT或客户汇总。

## 6. 授权和首次数据
业务ZIP置于/var/lib/teaching-risk-import等受限目录。先初始化服务再导入经批准52人工号映射：
~~~bash
sudo DATA_DIR=/var/lib/teaching-risk "$NODE" /opt/teaching-risk/current/scripts/provision-workbench-users.mjs /var/lib/teaching-risk-import/approved-mapping.json
sudo chown -R teachingrisk:teachingrisk /var/lib/teaching-risk/d1
~~~
不得复制本机认证数据库、密码或Chrome profile。授权失败先查冲突，不按姓名扩大角色。

取得新目标数据接收授权后，负责人在服务器安全会话导入initial-summary.json，expectedHash来自同目录sha256文件：
~~~bash
cd /var/lib/teaching-risk-import
set +x
set -a
. /etc/teaching-risk.env
set +a
export EEO_SYNC_URL=https://替换为最终看板域名
"$NODE" import-initial-summary.mjs initial-summary.json "$(cut -d ' ' -f1 initial-summary.sha256)"
unset EEO_SYNC_TOKEN WORKBENCH_SECRET
~~~
要求complete:true，失败旧数据保留。可由负责人在服务器本机用ALLOW_LOOPBACK_SYNC=1和EEO_SYNC_URL=http://127.0.0.1:3002做首次导入；此HTTP例外仅回环，不能用于公网IP。不要绕过TLS验证。
