# 运维、备份与恢复

> 应用内 JSON 导出不是完整备份，也不能直接恢复。升级、迁移或修改挂载方式前，请先备份整个数据目录和 Obsidian 对象；启用设置加密后还必须单独保存密钥。

## 识别需要保护的数据

| 数据 | 默认位置 | 是否在 JSON 导出中 | 恢复要求 |
|---|---|---:|---|
| SQLite 主库 / WAL / SHM | `$DATA_DIR/shannian.db*` | 部分 | 文件级恢复 |
| 本地缩略图 | `$DATA_DIR/thumbs/` | 否 | 连同数据目录恢复 |
| Obsidian Markdown | MinIO bucket 的 `vault-export/` | 否 | 按对象存储策略恢复 |
| AI / X / MinIO / 代理凭证 | SQLite `settings` | 否 | 随数据库恢复 |
| 设置加密密钥 | 外部环境或 secret 文件 | 否 | 必须单独恢复同一份密钥 |

JSON 端点只导出未进回收站的卡片和分类；它不含凭证、设置、任务队列、媒体文件或恢复流程。

## 做一次一致的冷备份

以下示例适用于仓库目录中的默认 `./data` 绑定挂载。把备份目录改成 NAS 上的真实路径：

```bash
backup_root=/volume1/backups/shannian
backup_stamp=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$backup_root"

was_running=$(docker compose ps --status running -q shannian)
if [ -n "$was_running" ]; then
  docker compose stop shannian
  trap 'docker compose start shannian' EXIT
fi
tar -C ./data -czf "$backup_root/data-$backup_stamp.tar.gz" .
if [ -n "$was_running" ]; then
  docker compose start shannian
  trap - EXIT
fi
```

随后备份 MinIO 中实际使用的 `vault-export/` 前缀，并把 `SETTINGS_ENCRYPTION_KEY` 或密钥文件放入不同的受控备份位置。不要把密钥和数据库只保存在同一个归档中。

如果不能停机，应使用 SQLite Online Backup API 或 NAS 快照；不要只复制正在写入的单个 `shannian.db` 而忽略 WAL。

## 验证备份可恢复

至少每季度在隔离目录做一次恢复演练：

1. 停止测试实例；
2. 将归档解压到一个新的、空的数据目录；
3. 使用相同的设置加密密钥启动相同或更高版本镜像；
4. 检查 `/api/health`、登录、卡片数量、搜索和几张缩略图；
5. 重新导出一张已保留卡片，确认 MinIO 写入成功；
6. 查看队列的 `queued` / `failed` 数量和 SQLite `integrity_check`。

可用只读命令检查备份数据库：

```bash
node --input-type=module -e '
  import Database from "better-sqlite3";
  const db = new Database(process.argv[1], { readonly: true, fileMustExist: true });
  console.log(db.pragma("integrity_check", { simple: true }));
  db.close();
' /path/to/restored/shannian.db
```

## 执行恢复

1. 停止服务并保留当前故障目录，不要覆盖唯一副本；
2. 将归档完整恢复到 `SHANNIAN_DATA_SOURCE` 指向的目录；
3. 修正所有权与权限；
4. 恢复相同的设置加密密钥和 MinIO 对象；
5. 启动服务并执行上一节的验证。

默认容器 UID/GID 为 `1000:1000`；若通过环境变量覆盖，命令中的数值也必须同步替换：

```bash
chown -R 1000:1000 ./data
chmod 700 ./data
find ./data -type f -exec chmod 600 {} +
```

如 NAS 使用其他身份，先设置 `SHANNIAN_UID` / `SHANNIAN_GID`，再修正整个 bind mount 的所有权。不要直接切到未预置权限的命名卷，也不要为了省事把数据库改成全员可读。

## 监控与故障判断

`GET /api/health` 会实际查询 SQLite，并返回 enrichment queue 的 `queued`、`running`、`failed` 和最老任务时间。建议告警：

- `database != ok` 或健康检查失败；
- `failed > 0` 持续增长；
- 最老 queued 任务超过 10 分钟；
- 数据卷剩余空间低于 15%；
- 最近一次可验证备份超过 24 小时（按个人 RPO 调整）。

当前健康端点还不检查 MinIO、AI、备份年龄或磁盘可写性；这些仍应由 NAS / 反向代理监控补齐。

## 公网部署底线

- TLS 反向代理，`COOKIE_SECURE=true`；
- 默认保持 `127.0.0.1` 绑定，确需 LAN 访问才修改；
- 首次初始化使用高熵 `SETUP_TOKEN`；
- 不开放任意 CORS；
- 只有同时设置 `TRUST_PROXY=true` 和 `TRUSTED_PROXY_CIDRS` 才读取转发 IP；
- 不要启用 `ALLOW_PRIVATE_FETCH=true`，除非接受服务端访问私网 URL 的风险；
- MinIO bucket 不得匿名公开。
