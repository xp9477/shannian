# 闪念

跨平台灵感库：粘贴链接或记下想法 → AI 自动整理 → 统一检索 → 跳转原链 → 导出到 MinIO 上的 Obsidian Vault。

个人自托管 · 单用户 · 公网 HTTPS + 密码鉴权 · SQLite + MinIO

## 功能（v1）

- **平台导入（主路径）**：导入页手动同步各平台收藏；先支持 X Bookmarks（Cookie，非官方，风险自担）
- 粘贴添加（副路径）：链接 / 纯想法
- 永久删除时，已认领的 X 书签尽力取消原平台收藏
- 平台元数据渐进增强（YouTube / B 站 / 通用网页；其它平台可插拔 adapter）
- OpenAI 兼容 AI：分类、标签、摘要
- 筛选：分类、标签、状态、仅想法、平台、待补全
- SQLite FTS5 全文搜索
- 重复 URL 定位已有卡片并追加想法
- 生命周期：收件箱 → 已整理 → 已沉淀
- 轻量回顾：收件箱计数、抽一张
- Obsidian：导出 Markdown 到 MinIO
- 回收站、JSON 全量导出
- PWA、深浅色、舒适/紧凑密度

## 本地开发

```bash
npm install
npm run dev
```

- Web: http://localhost:5173  
- API: http://localhost:8787  

数据文件默认写在仓库根目录 `data/shannian.db`。

## Docker（NAS）

```bash
docker compose up -d --build
```

反向代理到 `8787`，配置 HTTPS。生产环境建议 `COOKIE_SECURE=true`。

### 环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| `PORT` | 监听端口 | `8787` |
| `DATA_DIR` | SQLite 目录 | `/data` 或本地 `../../data` |
| `WEB_DIST` | 前端静态资源 | 生产镜像内置 |
| `COOKIE_SECURE` | Cookie Secure 标记 | 生产 `true` |

AI / MinIO 在首次向导或「设置」中配置，不必写进环境变量。

## 运维备份

1. **SQLite**：停止服务后复制 `$DATA_DIR/shannian.db`（及 `-wal`/`-shm` 若存在）。  
2. **MinIO**：备份 bucket 内 `thumbs/`、`vault-export/` 前缀。  
3. **应用内导出**：设置 → 导出全部 JSON（元数据）。

## 架构

```
apps/web   React + Vite PWA + Tailwind
apps/api   Hono + Drizzle + better-sqlite3
packages/shared  共享类型
```

平台解析：`apps/api/src/services/adapters/`  
后期逆向：实现新的 `PlatformAdapter` 并注册到 `adapters/index.ts` 即可。

## 设计文档

见 [docs/v1-design.md](./docs/v1-design.md)。
