# 运维与备份

## 数据位置

| 数据 | 位置 |
|------|------|
| SQLite | `$DATA_DIR/shannian.db`（本地开发默认仓库根目录 `data/`） |
| 缩略图 | MinIO 前缀 `thumbs/`（可配置） |
| Obsidian 导出 | MinIO 前缀 `vault-export/`（可配置） |

## 手动备份（推荐）

1. 可选：先在 UI 设置页点「导出全部 JSON」留一份元数据副本。  
2. 停止服务（避免 WAL 未落盘）。  
3. 复制整个 `$DATA_DIR` 目录。  
4. 按你的 MinIO 备份策略备份对应 bucket 前缀。  
5. 启动服务。

## 恢复

1. 停止服务。  
2. 还原 `shannian.db` 到 `$DATA_DIR`。  
3. 还原 MinIO 对象（否则封面/已导出笔记会 404）。  
4. 启动服务，用原密码登录。

## 公网注意

- 反向代理终止 HTTPS。  
- `COOKIE_SECURE=true`（默认生产镜像）。  
- 定期改密；登录有失败限流。  
- 不要将 MinIO 桶对公网匿名可读。

## 定时备份（可选增强）

可用 NAS 计划任务每日：

```bash
# 示例：拷贝 SQLite 快照（请先停服或 sqlite3 .backup）
cp /data/shannian.db /backup/shannian-$(date +%F).db
```

或将快照上传到 MinIO `backups/` 前缀（应用内自动备份为后续增强项）。
