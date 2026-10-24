# dsh-user-memory

单 Agent 的长期记忆，逻辑与 DS Bot 的记忆系统一致，去掉多 Bot、群聊与权限层。

## 它做什么

- **Markdown 记忆**：一行一条，行尾 `[source: …; added: …]` 元数据；`MEMORY.md` 常驻，主题文件按需 `recall`。
- **逐会话冻结**：每个 Session 第一次渲染时把记忆段写进系统提示词并留快照，之后逐字节不变，命中提供方前缀缓存。会话内新写的条目靠 `recall` 找到。
- **自动整理**：回合结束 2 秒后，模型读这段新增对话，新增、修改或删除条目。游标存在 `reviewed.json`，失败不前进。
- **面板**：侧栏「记忆」一行，打开是模型写的摘要 + 全部条目 + 一个问答框（可以问，也可以让它改）。

## 数据

`~/.dsh/storages/user-memory/memory/`

| 文件 | 内容 |
| --- | --- |
| `MEMORY.md` | 每次请求都带，上限 4000 字符 |
| `<topic>.md` | 一个话题一份，上限 16000 字符，最多 40 个 |
| `journal.jsonl` | 每次改动，含改动前后那一行 |
| `snapshots/` | 每个 Session 冻结的记忆段 |
| `reviewed.json` | 每个会话整理到哪了 |
| `summaries/` | 面板摘要缓存 |

## 工具

- `remember(text, replace?, topic?)` — 存一条；`replace` 就是改
- `forget(entry, topic?)` — 整条删
- `recall(query?, topic?)` — 词匹配（最多 6 个词、30 条）；无参列出有什么

## 路由

`api/dsh-user-memory/view`（GET）、`/ask`（POST）、`/forget`（POST）。

## 配置

`cordis.patch.yml` 里可以给 `dsh-user-memory` 传 `config`：

```yaml
- id: dsh-user-memory
  name: dsh-user-memory
  config:
    dataDir: /path/to/storages/user-memory
```

默认 `<DSH_HOME>/storages/user-memory`。
