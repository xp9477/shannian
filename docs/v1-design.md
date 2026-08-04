# 闪念 v1 设计说明

> 状态：已与产品方达成共享理解（2026-08-01）  
> 下一阶段：确认本设计后开始实现

## 1. 产品一句话

个人自托管的跨平台灵感库：以「快」粘贴捕获链接与想法，AI 自动分类打标，统一检索筛选，跳转原链，并导出 Markdown 到 MinIO 上的 Obsidian Vault 做深度内化。

## 2. 约束与边界

| 项 | 决定 |
|----|------|
| 用户 | 单用户、个人工具 |
| 形态 | Web + PWA，Docker 部署于 NAS |
| 访问 | 公网 HTTPS 为主 |
| 鉴权 | 应用内强密码 + Session |
| 存储 | SQLite（结构化）+ MinIO（缩略图/导出等） |
| AI | OpenAI 兼容；核心体验，未配置可入库 |
| 捕获 v1 | 仅应用内粘贴 |
| 不做 | 多用户、强爬虫、全文/视频归档、双向 Obsidian 同步、间隔重复、扩展/分享/快捷指令入口 |

## 3. 信息架构

```
闪念
├── 首次向导（仅未初始化）
│   ├── 1. 创建主人密码（必做）
│   ├── 2. AI 配置（可跳过）
│   └── 3. MinIO 配置（可跳过）
│
├── 主壳（需登录）
│   ├── 顶栏：搜索 · 筛选入口 · 密度切换 · 主题 · 设置
│   ├── 主区：卡片流 / 紧凑列表
│   ├── 快速添加（全局显眼：粘贴链接或写下想法）
│   ├── 轻量回顾：收件箱计数 · 「抽一张」
│   └── 卡片详情（侧栏或页）
│       ├── 元数据编辑
│       ├── 追加想法
│       ├── 打开原链
│       ├── 导出 Obsidian
│       └── 状态流转 / 删除
│
└── 设置
    ├── 账号（改密、登出）
    ├── AI（base_url / key / model）
    ├── MinIO
    ├── 分类词表 CRUD
    ├── 标签管理（合并/重命名/删除）
    ├── 数据导出
    └── 关于 / 运维说明入口
```

### 3.1 主要用户路径

1. **极速入库**：打开 → 粘贴 URL 或写 note → 保存 → 后台解析+AI → 出现在收件箱  
2. **找回**：搜索 / 分类 / 标签 / 状态 / 仅想法 / 平台 → 点卡片 → 原链  
3. **补全**：待补全或手动改标题/作者/封面/标签  
4. **内化**：详情 → 导出 Obsidian（MinIO）→ 状态「已沉淀」  
5. **回顾**：看收件箱 N → 抽一张处理 → 标已整理或沉淀  

## 4. 领域模型

### 4.1 概念

- **FlashCard（闪念卡片）**：唯一原子单位。`url` 与 `note` 均可选，但至少有一个。  
- **Category**：用户可维护词表；卡片 0～1 个。  
- **Tag**：自由多选；可全局重命名/合并。  
- **PlatformAdapter**：URL → 规范化元数据（可失败）。  
- **AiProvider**：OpenAI 兼容；产出分类建议、标签、可选摘要。  

### 4.2 卡片状态

```
inbox（收件箱）→ organized（已整理）→ deposited（已沉淀）
                     ↑
              用户显式操作；AI 成功不自动 organized

deleted_at 非空 = 回收站
```

### 4.3  enrichment 状态（与生命周期正交）

| 字段语义 | 含义 |
|----------|------|
| `fetch_status` | `pending` / `ok` / `partial` / `failed` / `skipped` |
| `ai_status` | `pending` / `ok` / `failed` / `skipped`（未配置 AI） |

列表可筛：待补全（fetch 残缺）、AI 失败、未配置 AI。

### 4.4 重复 URL

- 规范化 URL（去跟踪参数的策略按平台可配置；v1 至少：trim、统一 host 小写、去常见 `utm_*`）。  
- 若已存在未删除卡片：返回已有卡片，支持 **追加 note**（时间戳分段拼进 `note` 或子表；v1 采用 note 内分段追加以保持简单）。  

### 4.5 平台枚举

`xiaohongshu | douyin | bilibili | youtube | x | telegram | web | unknown`  
无 URL：`null`（纯想法，筛选「仅想法」）。

## 5. 数据模型（SQLite）

### 5.1 表结构（逻辑）

```sql
-- 单用户配置（key-value 或单行 settings）
settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL  -- JSON 或纯文本；敏感项加密/仅存哈希见下
)

-- 主人密码：password_hash（argon2id/bcrypt），无明文
-- session：服务端 session 表或签名 cookie；v1 推荐服务端 sessions 表便于吊销

sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
)

categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
)

tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
)

cards (
  id TEXT PRIMARY KEY,
  url TEXT,                    -- 可空
  url_normalized TEXT,         -- 可空；有 url 时唯一（部分唯一索引）
  platform TEXT,               -- 枚举或 null
  title TEXT,
  author TEXT,
  thumbnail_key TEXT,          -- MinIO object key
  note TEXT,
  category_id TEXT REFERENCES categories(id),
  status TEXT NOT NULL,        -- inbox | organized | deposited
  fetch_status TEXT NOT NULL,
  ai_status TEXT NOT NULL,
  summary TEXT,                -- AI 可选一句话
  raw_meta TEXT,               -- JSON：adapter 原始结果，便于调试
  deposited_at INTEGER,
  deposited_object_key TEXT,   -- MinIO 上 md 路径
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
)

card_tags (
  card_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (card_id, tag_id)
)

-- FTS5
cards_fts (标题、note、author、tags 拼接、url) -- 外挂 content-sync 触发器
```

### 5.2 MinIO 前缀约定

```
thumbs/{cardId}.{ext}
vault-export/{yyyy}/{mm}/{cardId}-{slug}.md
backups/          -- 可选 D，v1 不做自动
exports/          -- 用户触发的全量导出包（可选）
```

### 5.3 Obsidian Markdown 模板

```markdown
---
闪念id: {id}
title: {title}
url: {url}
platform: {platform}
author: {author}
tags: [..]
category: {category}
created: {iso}
---

# {title}

> 原链：{url}

## 我的想法

{note}

## 摘要

{summary}
```

## 6. 后端架构（Hono）

```
apps/api
  /auth          登录、登出、改密、session
  /setup         初始化状态、创建密码、跳过标记
  /cards         CRUD、追加 note、状态、删除/恢复
  /search        FTS + 筛选参数
  /categories    CRUD
  /tags          列表、重命名、合并、删除
  /review        inbox count、random draw
  /settings      AI、MinIO（key 脱敏回显）
  /export        全量 JSON 导出
  /obsidian      导出单卡到 MinIO
  /media         鉴权后的缩略图代理或签名跳转
  /internal      不直接暴露：enqueue fetch/ai（进程内队列）
```

### 6.1 入库时序

```
POST /cards { url?, note? }
  → 校验至少一项
  → 若 url：normalize → 查重 → 命中则返回 existing + append note 可选
  → insert status=inbox, fetch=pending, ai=pending|skipped
  → 响应卡片（快）
  → 异步：
       Adapter.fetch(url) → 更新 title/author/thumb/platform/fetch_status
       若 AI 已配置 → suggest → 写 category/tags/summary/ai_status
       未配置 → ai_status=skipped
```

### 6.2 Adapter 接口（预留逆向）

```ts
interface PlatformAdapter {
  id: Platform;
  match(url: URL): boolean;
  fetchMeta(url: URL, ctx: FetchCtx): Promise<Partial<CardMeta>>;
}
```

优先级：专用六大 → `web` 通用 og/meta → `unknown`。  
v1 实现：能做的做透；stub 返回 partial/failed，不抛垮队列。

### 6.3 AI 接口

```ts
interface AiProvider {
  suggest(input: {
    title?, author?, platform?, url?, note?, categories: string[]
  }): Promise<{ category?, tags: string[], summary? }>
}
```

仅 OpenAI 兼容 Chat Completions；分类必须落在用户词表或「建议新建」策略（v1：优先匹配已有分类名，匹配不上则不写分类或落入「待定」若存在）。

## 7. 前端信息结构（React PWA）

### 7.1 路由

| 路径 | 页面 |
|------|------|
| `/setup` | 首次向导 |
| `/login` | 登录 |
| `/` | 主库（列表+快速添加） |
| `/cards/:id` | 详情（移动端全页；桌面可侧栏） |
| `/settings` | 设置 |
| `/settings/categories` | 分类 |
| `/settings/tags` | 标签 |
| `/trash` | 回收站 |

### 7.2 文字线框

#### 登录

```
┌─────────────────────────┐
│         闪念            │
│  [密码          ]       │
│  [      进入      ]     │
└─────────────────────────┘
```

#### 主库

```
┌──────────────────────────────────────────┐
│ 闪念    [搜索........]  ⚙  密度  主题     │
│ 收件箱 12  |  抽一张  |  仅想法  平台▾ 状态▾ │
│ 分类：全部 工作 AI 旅行 …                 │
├──────────────────────────────────────────┤
│ ┌ 快速添加 ────────────────────────────┐ │
│ │ 粘贴链接，或写下此刻的想法…            │ │
│ │              [保存]                  │ │
│ └────────────────────────────────────┘ │
│ ┌─────┐ 标题                  平台角标  │
│ │封面 │ 作者 · 分类 · 标签              │
│ │     │ note 一行预览…                  │
│ └─────┘ inbox · 待补全？                │
│ …更多卡片…                              │
└──────────────────────────────────────────┘
```

紧凑列表：左平台色点 + 标题 + 标签灰字 + 时间，无大图。

#### 详情

```
┌──────────────────────────────────────────┐
│ ←  封面大图（可换）                        │
│ 标题 [编辑]                              │
│ 作者 · 平台 · 打开原链 ↗                  │
│ 分类 [▾]  标签 [+ ]                      │
│ 状态：收件箱 [标为已整理] [导出 Obsidian]   │
│ ── 我的想法 ──                           │
│ （可编辑多行）  [追加一段]                 │
│ ── 元数据 ──                             │
│ fetch/ai 状态 · 重试解析 · 重试 AI         │
│ 删除                                     │
└──────────────────────────────────────────┘
```

#### 设置（摘要）

```
AI: base_url / api_key / model  [测试连接]
MinIO: endpoint / bucket / keys / 前缀  [测试]
分类词表 / 标签管理
导出全部数据
修改密码 · 登出
运维备份说明（链到 docs）
```

## 8. UI 原则

- 气质：安静工具感；主色一枚 + 中性灰；平台用小图标/色点  
- 密度：舒适卡片（默认）/ 紧凑列表  
- 主题：跟随系统 + 手动覆盖并持久化  
- 快速添加：主路径唯一捕获入口，必须首屏可见、保存反馈明确（toast）  
- 动效：微反馈即可，不挡操作  

## 9. 安全清单（公网）

- 未 setup 完成：拒绝业务 API  
- 密码：argon2id/bcrypt；登录失败限流  
- Cookie：HttpOnly + Secure + SameSite=Lax（或 Strict 若同站）  
- 所有 `/api/*` 除 login/setup 需 session  
- MinIO 凭证仅存服务端；缩略图经鉴权代理或短时签名  
- 导出/Obsidian 写操作需登录  
- 配置回显：API key 仅显示后四位  

## 10. 部署

```
Docker 单容器（或 web+api 同镜像）
  - 挂载 volume：/data/sqlite.db
  - 环境变量：DATA_DIR、可选 SESSION_SECRET
  - MinIO、AI：运行时在设置中配置（或 env 覆盖，v1 以设置为准）
反代：Caddy/Nginx 终止 HTTPS（你的域名 + DDNS）
```

## 11. 默认分类种子

`工作` · `AI工具` · `旅行` · `学习` · `设计/创意` · `待定`

## 12. v1 交付切片（建议实现顺序）

1. 骨架：Hono + React + 鉴权 + setup  
2. 卡片 CRUD + 主列表 UI + 快速添加  
3. 筛选/状态/回收站 + FTS  
4. Adapter 框架 + web 通用 + 优先 YouTube/B 站  
5. AI 建议接入  
6. MinIO 缩略图 + Obsidian 导出  
7. 回顾（计数+抽一张）+ 导出 JSON + 运维文档  
8. PWA 清单与打磨密度/深色  

## 13. 后续（明确二期）

- `/quick`、Share Target、快捷指令 Token API、浏览器扩展、TG Bot  
- 其余平台深度 adapter / 你自研逆向  
- FTS → 语义搜索  
- 定时 SQLite 快照到 MinIO  
- Obsidian URI（若以后 vault 本地化）  

## 14. 平台导入（主路径调整）

> 2026-08-03 确认：主路径改为平台收藏导入；粘贴为副路径。详见 [platform-import.md](./platform-import.md)。

- 导入页 + X Bookmarks（Cookie auth_token/ct0）
- 永久删除时可选写回 unbookmark
- 多平台 Connector 骨架（小红书等即将支持）

