# dsh-session-delete

给 DSH 的会话列表加一个**真正删掉会话**的入口。侧栏会话行的「...」菜单里，在「归档会话」下面多出一行**删除会话**：确认之后，这个会话的磁盘数据、工作区引用与投影缓存一起消失。

官方只有**归档**：归档把会话从列表里藏起来、禁止打开，`archiveSession` 不碰任何文件，会话日志、标题、工作区记账全都留在原地。本插件补上归档缺的那一步。

| 位置 | 处理 |
| --- | --- |
| 会话行「...」菜单 → 归档会话下方 | 多一行「删除会话」，与官方菜单同一套样式、键盘走位与浮层 |
| 点它 | 弹出确认对话框，说明「彻底删除、不可恢复」，取消不改任何东西 |
| 确认后 | 删除会话目录、其子代理会话目录、工作区记账 / 归档 / 置顶引用、投影缓存行 |
| 列表 | 删除成功后自动刷新，该行消失，不需要重载页面 |
| 正在运行或仍开在本机的会话 | 照样删除，不看运行状态：目录先消失，之后的日志写入失败，不会把数据写回来 |

## 删除到底删了什么

权威数据（删掉即不可恢复）：

- `~/.dsh/sessions/<projectKey(cwd)>/<sessionId>/` 整个目录，内含 `session.vN.jsonl.zstd` 与 `session.lock`。
- 该会话的子代理会话：header 里 `origin: 'subagent'` 且 `parentSession` 指向它（或指向它的后代）的所有会话，递归删除。fork 出来的会话是独立会话，**不**连带删除。

注册表与缓存（由本插件一并清理）：

- `storages/workspace.json`：所属工作区 `sessionIds` 里的记账、`archivedSessionIds`、`pinnedSessionIds`。写入只经 `ctx.workspaceRegistry` 的 `detachSession` / `unarchiveSession` / `unpinSession`，**绝不手改 JSON**，所以刷新列表的 `domain/changed` 广播照常发出。
- `storages/session_projcache/sessions/<sessionId>.json`：投影缓存行。它是派生数据，删不掉也不会出错。

不动的：附件（内容寻址，不按会话绑定）、`evolution/` 里的采集进度标记（那只是文本进度，不影响会话本身）。

## 删除强制生效

删除不看会话在本机的运行状态：

| 情况 | 结果 |
| --- | --- |
| 会话正在运行（agent `status === 'running'`） | 照删。这一轮 turn 后续写日志会失败，宿主日志里记一条 warn |
| 会话仍开在本机（在 `ctx.sessions` 里没释放） | 照删。页面再操作这个会话会失败，重新打开时提示它已不在磁盘上 |

host 返回的 `live` 数组记录删除当刻仍然活着的会话 id 与状态（`running` / `open`），只用于诊断，浏览器半边不再据此拦人。当前打开的这个会话本身也能删：删掉之后它自己的下一次日志写入会失败，这是强制删除的代价，不是缺陷。

## 安装

profile 的 `package.json` 按此登记：

```json
"dependencies": {
  "dsh-session-delete": "github:Alamanes/applesdsh-dev#path:plugins/dsh-session-delete"
},
"dsh": {
  "profile": {
    "bundles": ["...", "dsh-session-delete"]
  }
}
```

再在该 profile 目录执行 `pnpm install`，重启 DSH 后生效。停用只需从 `bundles` 里删掉 `dsh-session-delete`。

**本地开发**用 `file:` 直接指到插件目录：

```json
"dependencies": {
  "dsh-session-delete": "file:/path/to/dsh-session-delete"
}
```

在 profile 目录 `pnpm add "dsh-session-delete@file:$HOME/.dsh/plugins/dsh-session-delete"` 完成第一次链接（`nodeLinker: hoisted` 下落成实体目录，不是软链）。之后改源码需要把实体文件复制进 profile：

```sh
cp -R ~/.dsh/plugins/dsh-session-delete/. "$DSH_PROFILE_DIR/node_modules/dsh-session-delete/"
```

host 半边（路由）与浏览器半边（bundle）都在启动时装载，改完都要重启 DSH 才生效。

## 为什么长这样

**为什么删除要 host 做。** 会话目录名的推导规则属于 host：`projectKey(cwd)` 把 `/`、`\`、`:` 的连续段折成一个 `-`，其余不安全码位转 `~XXXX`，再包上 `--…--`；会话 id 用同一套 `encodeSegment` 转义。这两个函数在本插件的 `lib/index.js` 里按同一算法复刻，因为 JSONL 后端把 root 当私有字段，不对外提供路径访问器。任何请求里的 id 都必须先过白名单（`[A-Za-z0-9._-]{1,200}`），删除前再断言目标目录位于配置的 sessions root 之内——两道栅栏都过了才 `rm -r`。

**为什么走 HTTP 路由而不是 RPC。** Harness 的 remote 调用需要 typert 契约（`lib/typert.host.js`），那是官方包之间的内部协议；第三方插件挂一条 exact 路由更直接，也和本仓库其它插件的做法一致。路由只认 `POST`、拒绝 `Sec-Fetch-Site: cross-site`、优先委托宿主的浏览器信任栅栏（`connection.requestRejection`），请求体上限 64 KiB。

**为什么菜单项走槽位。** 会话行的「...」菜单本身就是两个 list 槽位：`sidebar.workspaces.session.menu.item` 与 `sidebar.workspaces.session.row.action`。官方自己的 Pin / Rename / Fork / Archive 也是这么注册的，所以插件用 `order: 500` 落在 Archive（400）之后，天然继承菜单的样式、键盘走位与浮层定位，不必碰任何 DOM。

**为什么删除后行会消失。** 删除成功后浏览器半边调用 `ctx.sessions.refresh()` 重拉会话基线；注册表引用又是在 host 侧通过 registry 写入的，`domain/changed` 会顺带把工作区增量推给页面。两件事都不需要重载页面。

**确认对话为什么自己做。** 官方把归档的确认框和提示条都注册在自己私有的 `shell.overlay` 条目上，没有公共的通知服务。本插件的对话框同样是 `shell.overlay` 的一个条目，由一个快照 store 驱动，只在有待确认请求时渲染。

## 依赖与边界

- host 半边 `import Schema from '@deepseek-ai/schemastery'`：靠 profile 根 node_modules 里已存在的 schemastery 解析（`nodeLinker: hoisted` 下必然被提升到根），不额外声明依赖。
- 浏览器半边 `require` 三个静态平台模块：`react`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-primitives`。它们都在 shell 的静态模块表里，不需要 `dsh.client.external`，也没有构建步骤。
- `Config` 提供 `sessionsRoot` 与 `projectionCacheRoot` 两个覆盖项，默认取 `<dsh home>/sessions` 与 `<dsh home>/storages/session_projcache`（`DSH_HOME` 环境变量优先，未设则为 `~/.dsh`）。
- 依赖的官方内部契约：会话槽位 `sidebar.workspaces.session.menu.item` 与 `shell.overlay`、`ctx.workspaceRegistry` 的 `list/detachSession/unpinSession/unarchiveSession`、`ctx.sessionPersistence` 的 `list`、客户端 `ctx.sessions.refresh()`、以及 host 的 `sessionPersistence.list()` 快照形状。在 DSH 0.2.0-rc.2 上按源码核对过。
