# dsh-ui-ptc

「更好的 PTC 模式」。独立插件，不依赖界面套件；装进 profile 的 bundles 后生效。

两个组件：

- **显示优化**：摘掉 `run_code` 的代码卡片，让程序里的工具调用像普通模式一样平铺在对话流里。
- **能力增强**：内置 `dsh-ops` 0.3.1 的原生文件与 PTC 工具，代码与配置原样携带。

## 组件一：显示优化

PTC 模式下，一次 `run_code` 会在对话流里画成一棵调用树：根是 `run_code` 自己，
程序里每次 `tools.xxx()` 都是它的子调用。内置的根行是一张通用的代码卡片，于是聊天里
先出现一大段程序代码，真正的动作缩在它下面的竖线里。

本插件接管 `tool.call.toolview` 座位上的 `run_code` 键，把根卡片从行里摘掉；
该行随之丢掉缩进与引导竖线，子调用按普通模式那样直接平铺在对话流中。

### 呼吸线、失败着色与扫光条

- **呼吸线**：整组子调用左侧保留一条 1px 的引导线，常态压到 35% 不透明度，悬停时抬到 80%；
  缩进从内置的 22px 收到 8px。
- **失败着色**：组内任一步失败或中止，整组引导线转成失败色；程序自身失败时同样。
- **扫光条**：程序还在跑时，组头一条 2px 的扫光从左掠到右，结算后消失；
  `prefers-reduced-motion` 下保持静止。

三条都挂在组件写入的语义属性上（`data-dshui-ptc-row`、`data-dshui-ptc-running`、
`data-dshui-ptc-failed`），不认构建期哈希类名。

### 根行只在两种情况下留一行字

- **程序没有派发任何子调用**：显示「程序运行中」或「程序已完成 · <description>」。
  否则这一轮会整段空白，读者不知道发生过什么。
- **程序自身失败、中止或超时**：显示「程序执行失败 · <原因>」。这类错误不在任何
  子调用里，隐藏根行会让它静默消失。

### 识别方式

- 座位：keyed slot `tool.call.toolview`，键 `run_code`。
- 根行标记：组件在自己的行根上写入 `data-dshui-ptc-row`，样式表据此只调整这一行的
  子调用列（`[data-subcalls]`），不碰其它工具行，也不碰嵌套在子调用里的调用树。
- 颜色取自 dsh 自己的令牌：`--dsw-alias-label-secondary`、
  `--dsw-alias-state-error-primary`。

## 组件二：能力增强（内置 dsh-ops）

`vendor/dsh-ops/` 是 [dsh-ops](https://github.com/T-Auto/dsh-ops) 0.3.1 的完整拷贝：
`lib/`、`runtime/darwin-arm64/dsh-ops-worker`、`bin/`、`locale/`、`cordis.patch.yml`、
`package.json`。上游代码与配置未作改动；外层只把子路径导出为 `dsh-ui-ptc/ops/*`。

行 id 保持上游的 `dsh-ops-*`，因此 profile 里针对这些 id 写的覆盖继续生效。

| 行 id | 子路径 | 作用 | 默认 |
| --- | --- | --- | --- |
| `dsh-ops-shell` | `dsh-ui-ptc/ops/shell` | bash 运行时；Windows 上随包带 bash 与 PowerShell 7 | 开 |
| `dsh-ops-file` | `dsh-ui-ptc/ops/file` | 原生文件工具：`ops_inspect_local_file` / `ops_glob` / `ops_grep` / `ops_replace` | 开 |
| `dsh-ops-background` | `dsh-ui-ptc/ops/background` | 后台命令 | 关 |
| `dsh-ops-ptc` | `dsh-ui-ptc/ops/ptc` | PTC 专用工具 `ops_batch` / `ops_result` | 关 |

运行期依赖 `@fastctx/darwin-arm64` 0.2.6，已写进 `optionalDependencies`；pnpm 从 profile 的
`node_modules` 解析它，与包内 `vendor/dsh-ops` 的相对层级无关。

从 `dsh-ops` 迁到本插件时，profile 的 `dependencies` 与 `dsh.profile.bundles` 里必须同时移除
`dsh-ops`，否则两套同名的行与工具会重复注册。

## 组件三：工具归并（去 ops_ 前缀）

dsh-ops 的工具原本带 `ops_` 前缀，和原生的 `bash`、`glob`、`grep` 撞名。这一版把前缀去掉，
工具名变成 `bash`、`glob`、`grep`、`inspect_local_file`、`replace`、`batch`、`result`。

同名注册会撞车，所以原生那两个提供方的行必须在 PTC 预设里关掉：

- `tool-bash`（提供 `bash`）
- `tool-fs-search`（提供 `glob`、`grep`）

`tool-fs` 保留：`read`、`write`、`edit`、`read_image` 仍是原生的。

命名只在 `vendor/dsh-ops/lib/policy.js` 的 `TOOL_PREFIX` 一处构造，改回 `'ops_'` 即可整体还原。
回滚时同时把 profile `cordis.patch.yml` 里那两行的 `disabled` 去掉。

## 安装

profile 的 `package.json` 依赖里指向本目录，并把 `dsh-ui-ptc` 加进
`dsh.profile.bundles`；随后在 profile 目录执行一次 `pnpm install`，重启宿主生效。

## 许可

MIT。内置的 `vendor/dsh-ops` 来自 `dsh-ops@0.3.1`，按 `MIT AND Apache-2.0` 收录：
授权原文见 `vendor/dsh-ops/LICENSE`，FastCtx 的归属声明见 `vendor/dsh-ops/NOTICE`，
移植范围记在仓库根的 `THIRD-PARTY-NOTICES.md`。
