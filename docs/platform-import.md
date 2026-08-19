# 平台导入（先 X Bookmarks）

> 状态：已与产品方达成共享理解并确认（2026-08-03）  
> 相对 v1 的目标：主路径从「粘贴」调整为「平台导入」；当前仅 X 可用，其他平台仍是规划。

## 1. 产品一句话

把各平台**已有收藏/书签**手动导入闪念；先做 **X Bookmarks**。永久删除时，对「从该书签导入认领」的卡片**尽力**取消原平台收藏。粘贴仍用于别处随手收集的链接/想法。

## 2. 已确认决策

| # | 决策 |
|---|------|
| 1 | 目标主路径 = 多平台导入；当前主路径 = X 导入，粘贴 = 副路径 |
| 2 | IA：主壳「库 \| 导入 \| 回收站 \| 设置」；导入页 = 平台卡片列表 |
| 3 | Connector：导入必选，写回可选 |
| 4 | 仅 X **Bookmarks**（不做 Likes） |
| 5 | 手动导入 + 后台 job + 进度；同时仅一个导入任务 |
| 6 | 增量：首次全量；之后从新到旧，完整一页均无新建/认领时停止；可强制全量 |
| 7 | 已存在 URL：不改内容，补 `import_source` + `external_id` |
| 8 | 新卡 inbox；媒体和正文随时间线一次入库；AI 进入 SQLite 持久队列 |
| 9 | 仅 `import_source=x_bookmark` 在**永久删除**时 unbookmark；进回收站不碰 X |
| 10 | 当前写回失败：同步尝试 → 弹窗 → 强制本地删除 / 取消；尚非 durable、延迟或可撤销 delivery |
| 11 | 恢复回收站不重新 bookmark |
| 12 | 凭证：`auth_token` + 必要时 `ct0`，存 settings（脱敏回显），可清除；可用外部 key 加密 |
| 13 | 非官方 Cookie 方案；极保守限速；残留封号风险自担，不承诺零封号 |
| 14 | 不做：官方付费 API、常驻自动同步、Likes、扩展、soft-delete 写回 |

## 3. 信息架构

```
主壳
├── 库（原主列表）
├── 导入  ← 新增一等入口
│   └── 平台卡片
│       ├── X（可用）
│       │   ├── 连接状态 / 配置凭证
│       │   ├── 导入 Bookmarks / 强制全量
│       │   └── job 进度
│       └── 小红书 / B 站 / …（即将支持）
├── 回收站（永久删除触发可选写回）
└── 设置（AI / MinIO / 账号；平台凭证也可从导入页进入）

副路径：全局「+」快速添加（粘贴链接或想法）
```

## 4. 领域模型

### 4.1 卡片扩展

| 字段 | 说明 |
|------|------|
| `import_source` | 如 `x_bookmark`；空 = 非导入认领 |
| `external_id` | 平台侧 ID（tweet id） |

写回条件：`import_source` 有对应 connector.revoke 且 `external_id` 非空。

### 4.2 Connector 契约

```ts
interface PlatformConnector {
  id: string;                 // e.g. "x"
  label: string;
  importSource: string;       // e.g. "x_bookmark"
  supportsImport: true;
  supportsRevoke: boolean;
  status(): Promise<ConnectorStatus>;
  startImport(opts: { forceFull?: boolean }): Promise<ImportJob>;
  getJob(): Promise<ImportJob | null>;
  cancelImport?(): Promise<void>;
  revoke?(externalId: string): Promise<void>;
}
```

### 4.3 ImportJob（settings JSON 状态 + 单进程执行）

```ts
{
  id, platform, status: running|completed|failed|cancelled,
  forceFull, scanned, imported, claimed, skipped,
  error?, message?, createdAt, updatedAt
}
```

服务重启时，残留的 `running` 会转成 `failed/IMPORT_INTERRUPTED`，不会永久假装运行；当前版本尚未持久化分页 cursor，因此需要用户重新开始。卡片解析/AI 使用独立的 SQLite `enrichment_jobs`，可以在重启后恢复。

## 5. X 实现要点

### 5.1 认证

- 用户粘贴 `auth_token`、`ct0`（X 网页登录 Cookie）。
- 请求头：`Cookie`、`x-csrf-token: ct0`、Twitter Web Bearer、`x-twitter-auth-type: OAuth2Session`。
- **非官方**；接口/Query ID 变更会导致失败，需可配置或更新代码。

### 5.2 导入

1. 校验凭证（如 verify credentials / 拉一页书签）。
2. 从新到旧分页拉 Bookmarks。
3. 每条：规范化 URL → 已存在则 claim 字段；否则把时间线已有正文/媒体建卡 inbox，并写入 durable enrichment job。
4. 非 `forceFull`：只有完整一页均为已存在/跳过才停止，避免上次在页中途中断后漏掉后半页。
5. 页间 sleep（默认 ~2.0–2.8s，配置会被夹在 0.5–60s）；429 指数退避。
6. 同时仅一个 X 导入 job；同步互斥在第一次 `await` 前抢占，避免并发启动。

### 5.3 写回

- `purgeCard`：若 `import_source=x_bookmark` 且有 `external_id`，先 `DeleteBookmark`。
- 失败且未 `force`：返回 `REVOKE_FAILED`，不删本地。
- `force=1`：跳过或忽略写回失败，硬删本地。

### 5.4 安全与文案

- 设置/导入页固定风险说明：可能风控/封号、接口随时挂、自担风险。
- 日志禁止打印 token；公开 API 仅 `hasToken` + hint。
- 一键清除凭证。

## 6. API（草案）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/import/platforms` | 平台列表 + 状态 |
| GET/PUT | `/api/import/x/credentials` | 读公开状态 / 写 token |
| DELETE | `/api/import/x/credentials` | 清除 |
| POST | `/api/import/x/start` | `{ forceFull?: boolean }` 启动 job |
| GET | `/api/import/x/job` | 当前/最近 job |
| POST | `/api/import/x/cancel` | 取消 |
| DELETE | `/api/cards/:id?permanent=1` | 可能 `REVOKE_FAILED` |
| DELETE | `/api/cards/:id?permanent=1&force=1` | 忽略写回失败 |

## 7. 实现切片

1. 设计文档（本文）
2. schema + shared 类型
3. X client + connector + job
4. purge 写回
5. 导入页 + 导航 + 回收站确认流
6. 构建校验

## 8. 非目标（本阶段）

- 官方 X API、Likes、多账号、定时自动导入、双向内容同步、浏览器扩展。
