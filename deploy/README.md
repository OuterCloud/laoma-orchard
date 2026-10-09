# 部署说明

站点是纯静态产物（`dist/`），可以部署到任何地方。当前选定的方案是
**部署到已有业务的阿里云香港服务器**，与现有项目共存，不需要备案。

## 为什么选它

| | 本机服务器（香港） | EdgeOne Pages 免费版 |
| --- | --- | --- |
| 大陆访问 | **约 30–60ms** | 约 200ms（海外节点） |
| 备案 | 不需要 | 不需要（不含大陆区域） |
| 费用 | 服务器年费（已付） | 免费 |
| 维护 | 脚本已自动化 | 零维护 |

> EdgeOne 的「全球可用区（含中国大陆）」虽能上大陆节点，但官方文档明确要求
> **必须完成 ICP 备案**。想免备案又要大陆节点，香港服务器是更直接的选择。

## 目录里有什么

| 文件 | 作用 |
| --- | --- |
| `server-setup.sh` | **一次性初始化**。追加 Nginx 配置、合并 compose 挂载、申请证书、注册 systemd |
| `publish.sh` | **日常发布**。构建 → 校验 → 同步静态文件 → 重载 Nginx |
| `nginx-laoma-http.conf` | 第一阶段片段：仅 80 端口（用于签发证书前） |
| `nginx-laoma-https.conf` | 第二阶段片段：HTTP + HTTPS，证书就位后替换上一份 |
| `patch_nginx.py` | 幂等地把片段插入 `http {}` 内，不改动任何既有行 |
| `merge_compose.py` | 生成「原 compose + 两个只读挂载」的最终文件，不动原文件 |

## 部署到已有业务的服务器

### 前提

- 服务器可 SSH 登录（有 root）
- 现有项目用 Docker Compose 部署，Nginx 跑在容器里（本项目针对的结构）
- 域名已解析到该服务器

### 步骤

```bash
# 1. 服务器上克隆（用部署密钥或 HTTPS）
git clone git@github.com:OuterCloud/laoma-orchard.git
cd laoma-orchard

# 2. 一次性初始化（先装好 Node 22+）
sudo ./deploy/server-setup.sh

# 邮箱是可选的，不填也能正常签发 HTTPS 证书。
# Let's Encrypt 的到期提醒邮件服务已于 2025-06-26 停止，填了基本也收不到东西。
# 想填就加：sudo ACME_EMAIL=you@example.com ./deploy/server-setup.sh

# 3. 日常更新
git pull && ./deploy/publish.sh
```

`server-setup.sh` 会打印还差什么（比如 Node 未安装、IP 未解析），
**重复执行是安全的**——所有操作都幂等。

### 执行后还需要手工做两件事

脚本无法代劳，因为涉及云平台账号：

1. **阿里云控制台放行 80 / 443 端口**（轻量应用服务器 → 实例 → 防火墙）
2. **DNSPod 添加 A 记录**指向服务器公网 IP（`@` 和 `www` 各一条）

## 怎么保证不影响现有项目

这是本方案最关键的约束，具体措施：

1. **不修改现有 nginx.conf 的任何一行**。`patch_nginx.py` 只在 `http {}`
   的收尾花括号前插入我们自己的 server 块；移除该块后文件与原文逐字一致
   （已实测验证）。
2. **用精确域名匹配**。现有配置用 `server_name _`（通配），我们显式写
   `server_name laoma-apples.site`，Nginx 对同名端口的匹配规则是精确优先，
   因此不会抢走现有站点的请求。
3. **不重建其它容器**。`merge_compose.py` 只给 nginx 服务追加两个只读挂载，
   backend / frontend 完全不动；应用时只 `up -d nginx`。
4. **只 reload，不 restart**。Nginx 重载是平滑的，既有连接不中断。
5. **改动前自动备份**，配置校验失败会自动回滚。
6. **每次执行前先幂等清理**，重复跑不会累积重复配置。

## 自动化部署

初始化完成后，更新流程就是：

```bash
cd ~/laoma-orchard && git pull && ./deploy/publish.sh
```

想做成「推代码即部署」，两种方式：

**方式一：服务器上的 cron**

```bash
# 每 5 分钟拉一次，有变化才构建
*/5 * * * * cd /root/laoma-orchard && git pull -q && ./deploy/publish.sh >> /var/log/laoma-deploy.log 2>&1
```

**方式二：GitHub Actions 推送到服务器**

需要把 SSH 私钥配成仓库 Secret。适合已经熟悉 Actions 的情况；
否则方式一更简单可靠。

## HTTPS 与续期

证书由 certbot（webroot 模式）签发。**不需要提供邮箱**：Let's Encrypt 的证书
到期提醒邮件服务已于 [2025-06-26 停止](https://letsencrypt.org/2025/06/26/expiration-notification-service-has-ended)，
不填邮箱不影响签发，也不影响自动续期（续期由 `certbot.timer` 驱动，与邮箱无关）。
邮箱只保存在服务器本地 `/etc/letsencrypt/`，不会写进证书，也不会出现在网站上。

脚本会：

- 把证书复制到 `nginx/ssl/laoma-fullchain.pem` 与 `laoma-privkey.pem`
- 注册 `/etc/letsencrypt/renewal-hooks/deploy/laoma-reload.sh`，
  续期后自动同步证书并重载容器内 Nginx

验证续期是否配置正确：

```bash
sudo certbot renew --dry-run
```

## 修复已有站点的过期证书（可选）

如果服务器上原有项目的 HTTPS 证书已过期，脚本主体不会处理它。用这个：

```bash
sudo EXISTING_DOMAIN=mizunoamitiger.me ./deploy/fix-existing-cert.sh
```

**为什么它和主流程用不同方式**：原项目的 Nginx 配置里，80 端口块是
`server_name _;`（通配）且只做 301 跳转，没有 ACME 校验的 location。
它同时是 80 端口的默认 server，所以对原域名的校验请求会被它接走并跳转到
HTTPS，certbot 拿不到文件。因此这个脚本改用 `--standalone` 模式，
**需要短暂停止 Nginx 容器约 10~30 秒**腾出 80 端口。

脚本用 `trap` 保证：**无论申请成功与否，容器都会被重新拉起**，不会留下停服状态。
证书仍有效时脚本直接退出，不做任何改动。

> 我们自己的域名（laoma-apples.site）不受此限制 —— 它用精确 `server_name`
> 匹配，优先于通配块，所以主流程的 webroot 方式可用，不需要停服务。

## 排障

```bash
# 容器内 Nginx 配置是否正确
sudo docker exec mizuno-ami-tiger-nginx-1 nginx -t

# 看容器日志
sudo docker logs --tail 50 mizuno-ami-tiger-nginx-1

# 站点文件是否就位
ls -la /home/admin/mizuno-ami-tiger/laoma-apples/

# 宿主机端口监听情况
sudo ss -lntp | grep -E ':(80|443) '
```

出错时按时间倒序回滚 Nginx 配置：

```bash
cd /home/admin/mizuno-ami-tiger
ls -t nginx/nginx.conf.bak-* | head -1
sudo cp "$(ls -t nginx/nginx.conf.bak-* | head -1)" nginx/nginx.conf
sudo docker exec mizuno-ami-tiger-nginx-1 nginx -s reload
```
