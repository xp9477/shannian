# 闪念

把封闭平台里的原生收藏拉进一个待决策队列，用 AI 辅助快速判断“保留 / 丢弃 / 稍后”，再把真正有用的内容导出到既有知识库。

单用户自托管 · React PWA · Hono · SQLite · 可选 OpenAI 兼容 AI / MinIO

> 升级前请先备份整个 `data/`。容器现在以非 root 用户运行；宿主机目录必须属于 `SHANNIAN_UID:SHANNIAN_GID`（默认 `1000:1000`）。所有新数据库的首次初始化都会要求启动日志中的一次性令牌。

## 这套系统解决什么

闪念不是网页永久归档器，也不试图替代成熟的稍后读产品。它的核心路径是：

1. 保留用户已经在 X 等平台形成的原生收藏习惯；
2. 导入后生成可恢复、可限速的解析与 AI 任务；
3. 在收件箱中快速保留或丢弃；
4. 需要时把单卡 Markdown 导出到 MinIO 上的 Obsidian 目录；重复导出会覆盖同一对象路径；
5. 永久删除已认领的 X 书签时，可先尝试移除原平台收藏。

当前只实现 X Bookmarks，且使用非官方 Cookie / GraphQL 接口。它可能失效或触发平台风控，不应被当作永久稳定的官方集成。

## 已实现

- X Bookmarks 手动增量 / 强制全量导入，媒体随时间线一次入库，避免逐卡再次请求 X；
- 链接与纯想法快速添加，规范化 URL 去重并原子追加笔记；
- 标题、摘要、笔记、作者、URL、页面描述与正文摘录的统一搜索；
- SQLite 持久化 enrichment queue：并发上限、重启恢复、失败退避和健康统计；
- 详情页把保留操作与 Obsidian 导出按钮、错误和重试入口分开；底层状态仍待领域化；
- SSRF 防护：逐跳 DNS/IP 校验、固定已校验 IP、响应流式上限和图片魔数校验；
- 首次初始化原子抢占、登录限流、同源写保护、会话轮换和可选敏感设置加密；
- 本地缩略图、JSON 逻辑导出、PWA 与深浅色界面。

远程媒体仍以源 URL 为主，网页也只保存有限摘录，因此本项目当前是“索引与分流台”，不是离线内容归档系统。

## 本地开发

```bash
npm ci
npm run dev
```

- Web：`http://localhost:5173`
- API：`http://localhost:8787`
- 数据：仓库根目录 `data/shannian.db` 与 `data/thumbs/`
- 新数据库首次打开时，在 API 终端复制自动生成的初始化令牌

完整校验：

```bash
npm run check
npm audit --omit=dev --audit-level=moderate
# 已安装 Playwright Chromium 时，再跑真实浏览器闭环
npm run test:e2e
```

## 在 NAS 上启动

确保绑定目录对容器 UID/GID 可写，再启动：

```bash
mkdir -p data
chown -R "${SHANNIAN_UID:-1000}:${SHANNIAN_GID:-1000}" data
chmod 700 data
docker compose up -d --build
docker logs shannian 2>&1 | grep 首次初始化令牌
```

Compose 默认只发布到 `127.0.0.1:8787`，并保留现有 `./data:/data`。首次打开页面时，把日志中的令牌填入初始化向导。可以在 `.env` 固定 `SETUP_TOKEN`，但必须使用高熵随机值并妥善保管。

### 通过 HTTPS 暴露

优先让同机反向代理访问回环端口。必须监听 LAN 时，至少设置：

```dotenv
SHANNIAN_BIND_ADDRESS=0.0.0.0
COOKIE_SECURE=true
SETUP_TOKEN=<建议至少 32 字节的随机值>
SETTINGS_ENCRYPTION_KEY=<至少 32 字符、单独备份的随机值>
```

然后由反向代理终止 HTTPS，并保留原始 `Host`（同源写保护会校验 `Origin` 与 `Host`）。不要直接把明文 HTTP 的 `8787` 暴露到公网。

若代理会传递客户端 IP，还必须同时配置代理来源；只设 `TRUST_PROXY=true` 不会信任转发头：

```dotenv
TRUST_PROXY=true
TRUSTED_PROXY_CIDRS=127.0.0.1/32,172.16.0.0/12
TRUST_PROXY_HOPS=1
```

### 关键配置

| 变量 | 默认值 | 用途 |
|---|---:|---|
| `PORT` | `8787` | API 监听端口 |
| `LISTEN_HOST` | 本地 `127.0.0.1`；Docker `0.0.0.0` | 进程内监听地址；Compose 对宿主机的暴露仍由 `SHANNIAN_BIND_ADDRESS` 控制 |
| `DATA_DIR` | Docker `/data` | SQLite 与本地缩略图目录 |
| `SHANNIAN_DATA_SOURCE` | `./data` | Compose bind mount 源；改变前必须先备份、迁移并校验 |
| `SHANNIAN_UID` / `SHANNIAN_GID` | `1000` | 容器运行身份，需匹配数据目录所有者 |
| `COOKIE_SECURE` | Compose `false` | HTTPS 部署必须设为 `true` |
| `SETUP_TOKEN` | 自动生成 | 固定首次初始化令牌；未设置时查看启动日志 |
| `SETTINGS_ENCRYPTION_KEY` | 空 | AES-256-GCM 加密 AI / X / MinIO / 代理凭证；丢失后无法解密 |
| `SETTINGS_ENCRYPTION_KEY_FILE` | 空 | 容器内密钥路径；需用 Compose override 只读挂载该文件，不要与上一项同时设置 |
| `ENRICH_CONCURRENCY` | `2` | 解析 / AI worker 并发，范围 `1..8` |
| `CORS_ORIGINS` | 生产为空 | 仅在确需跨域前端时填写精确 origin 列表 |
| `TRUST_PROXY*` | 关闭 | 仅信任明确 CIDR 内代理追加的客户端 IP |
| `ALLOW_PRIVATE_FETCH` | `false` | 危险逃生阀；允许抓取私网 URL，会重新打开 SSRF 面 |

首次配置和运行时设置保存在 SQLite。配置了加密密钥后，已有明文敏感项会在下次启动时迁移；错误或丢失的密钥会让服务显式拒绝启动，避免把密文误当凭证。

使用密钥文件时，变量值是**容器内路径**。例如在 override 中把宿主机 secret 只读挂载到 `/run/secrets/shannian-settings-key`，再令 `SETTINGS_ENCRYPTION_KEY_FILE` 指向它。Compose 不会自动挂载任意宿主机文件。

若改用非默认 UID/GID，必须先用同一组数值修正 bind mount 所有权。命名卷默认继承镜像内的 `1000:1000`；本 Compose 不把它作为无迁移升级路径。

## 数据与备份

- SQLite：`$DATA_DIR/shannian.db`、WAL/SHM；
- 缩略图：`$DATA_DIR/thumbs/`，不在 MinIO；
- Obsidian Markdown：配置的 MinIO bucket / `vault-export/` 前缀；
- 加密密钥：必须在数据库之外单独备份。

应用内 JSON 只是一份“活动卡片 + 分类”的逻辑副本，不包含回收站、设置、凭证、缩略图文件，也没有一键恢复入口，不能替代文件级备份。详见 [运维与恢复](./docs/ops-backup.md)。

## 架构与审查

```text
apps/web         React 19 + Vite PWA
apps/api         Hono + Drizzle + better-sqlite3
packages/shared  前后端共享类型
data/            SQLite + 本地缩略图（不入 Git）
```

- [安全、架构与产品价值审查](./docs/2026-08-15_security-architecture-product-report.md)
- [平台导入说明](./docs/platform-import.md)
- [运维与恢复](./docs/ops-backup.md)
- [v1 历史设计](./docs/v1-design.md)
