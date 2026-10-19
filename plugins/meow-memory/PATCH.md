# meow-memory（本目录内置一个补丁）

来源：上游 [Phant0Meow/dsh-meow-memory](https://github.com/Phant0Meow/dsh-meow-memory) 的
`0.31.0` 发行产物，原样收进本目录（`lib/`、`cordis.patch.yml`、三份 README、LICENSE），
另外加了一个补丁。许可证仍为上游的 MIT，版权归 Phant0Meow。

## 补丁：`projectDir` 支持绝对路径

上游把记忆库固定放在 `<工作区>/<projectDir>`（`projectDir` 默认 `.dsh-meow`，只接受相对
工作区的目录名），而 `homeDir` 只承载日志与窗口账本。于是记忆库会随工作区散落；一旦改过
`homeDir`，旧库就留在原地不再被读取——工作区里那些 `.dsh-meow` 目录正是这么来的。

补丁给产物加了一个 `dataDir(workspace, dir)`：`dir` 是绝对路径时直接使用，否则维持上游
行为。9 处路径拼接改走它：

| 位置 | 作用 |
| --- | --- |
| `memoryDbPath()` | 记忆库 `memory.db` |
| `sessionsFile()` | 每会话注入状态 `sessions/<sid>.json` |
| `dreamLog()` + 3 处内联写日志 | `dream-debug.log` |
| `migrateLegacy()` + 1 处内联判定 | 旧库 `PROJECT.md` |
| 首次建库提示 | 提示文案里的 `dbPath` |

这样 profile 的 `cordis.patch.yml` 里就能写绝对路径：

```yaml
- id: meow-memory
  name: meow-memory
  config:
    homeDir: dsh-storage
    projectDir: /absolute/path/to/meow-memory-data
```

所有工作区随之共用同一个库目录，工作区里不会再出现 `.dsh-meow`。

## 重新打补丁

`package.json` 的 `prepare` / `build` 脚本与 `devDependencies` 在收录时已移除，从本仓库
安装不会触发构建。

- 换上游版本：用新版产物覆盖本目录，再执行
  `python3 patch/absolute-projectdir.py plugins/meow-memory`
- 从上游源码重建：在 `src/db.ts` 的 `memoryDbPath`、`src/inject.ts` 的 `sessionsFile`、
  `src/dream.ts` 的 `dreamLog`、`src/migrate.ts` 与 `src/index.ts` 的对应内联行做等价改动。
