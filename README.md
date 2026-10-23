# applesdsh-dev

个人的 DeepSeek Harness 插件源仓库。每个插件一个目录，profile 直接以本仓库为更新源安装，
不再依赖散落的本地路径或各自的 npm / GitHub 上游。

## 插件

| 目录 | 包名 | 说明 | 来源 |
|---|---|---|---|
| `plugins/dsh-ops` | `dsh-ops` | Rust 原生文件工具：`ops_inspect_local_file`、`ops_grep`、`ops_glob`、`ops_replace`，外加 `ops_bash` | 上游 [T-Auto/dsh-ops](https://github.com/T-Auto/dsh-ops) 的 `v0.3.1` 标签，另随包补入 `runtime/darwin-arm64` worker |
| `plugins/dsh-ui-suite` | `dsh-ui-suite` | 界面套件：一个 bundle 包，下挂十五个可独立停用的组件包，共享一套 `--dshui-*` 设计令牌 | 本仓库自产 |
| `plugins/dsh-web-search-tavily` | `dsh-web-search-tavily` | 给 `ctx.web` 接缝加一个 Tavily 搜索后端 | 本仓库自产 |
| `plugins/dsh-zh-prompt` | `dsh-zh-prompt` | 把第一方系统提示词换成简体中文，并注入「内部思考与最终回答使用简体中文」的语言规则 | 本仓库自产 |
| `plugins/meow-memory` | `meow-memory` | 跨会话长期记忆：七层 SQLite 记忆库、首轮快照注入、逐消息关键词命中、空闲 dream 整理 | 上游 [Phant0Meow/dsh-meow-memory](https://github.com/Phant0Meow/dsh-meow-memory) 的 `0.31.0` 发行产物，外加一个补丁让 `projectDir` 支持绝对路径，记忆库不再随工作区散落（见 `plugins/meow-memory/PATCH.md`） |

## 界面套件

`dsh-ui-suite` 是这些界面改造的唯一入口。它本身没有代码，只有 `dsh.bundle.patch` 的十五行
`insert` 与一份组件依赖清单；插件页因此把它显示成一张带图标的「界面套件」卡片，下面
十五行各是一个独立组件，可以单独停用。图标来自 `plugins/dsh-ui-suite/icon.png`（`package.json`
的 `icon` 字段，宿主把它读成 data URL 显示在卡片与详情页）。

| 组件包 | 行 id | 职责 |
|---|---|---|
| `dsh-ui-copy` | `dshui-copy` | 空态大标题与输入框提示轮换、预览版徽章、UI 强调色 |
| `dsh-ui-ask` | `dshui-ask` | ask 弹窗的换皮 |
| `dsh-ui-composer` | `dshui-composer` | 输入卡片换皮与发送钮 |
| `dsh-ui-menu` | `dshui-menu` | 权限、模型、Dock、右键菜单的开合动画 |
| `dsh-ui-sidebar` | `dshui-sidebar` | 侧栏「新会话」按钮降噪 |
| `dsh-ui-identity` | `dshui-identity` | 左下角账号芯片的昵称与头像 |
| `dsh-ui-session-delete` | `dshui-session-delete` | 会话行菜单的「删除会话」 |
| `dsh-ui-peak-valley` | `dshui-peak-valley` | 侧栏底部的峰谷时段提示 |
| `dsh-ui-status-phrases` | `dshui-status-phrases` | 状态行短语轮换、打字机与流光 |
| `dsh-ui-foot-panels` | `dshui-foot-panels` | 侧栏底部并排的插件 / 统计 / 技能图标按钮 |
| `dsh-ui-restart` | `dshui-restart` | 标题栏「彻底重启」按钮与 `restart_dsh` 工具 |
| `dsh-ui-quota` | `dshui-quota` | 输入框旁的额度环与逐模型额度 |
| `dsh-ui-effort-slider` | `dshui-effort-slider` | 推理强度滑块 |
| `dsh-ui-whale` | `dshui-whale` | 粒子鲸鱼壁纸与半透明界面 |
| `dsh-ui-skill-explorer` | `dshui-skill-explorer` | 技能中心面板 |

原来各自独立的 `dsh-codex-reasoning-effort-slider`、`dsh-commandcode-quota`、`dsh-local-identity`、
`dsh-peak-valley-hint`、`dsh-plugin-harness-whale`、`dsh-restart`、`dsh-session-delete`、
`dsh-sidebar-foot-panels`、`dsh-status-phrases` 已全部收编进对应组件，目录从本仓库移除。

## 安装

把插件按 GitHub 子目录说明符登记进 profile 的 `package.json`：

```json
{
  "dependencies": {
    "dsh-ops": "github:Alamanes/applesdsh-dev#path:plugins/dsh-ops",
    "dsh-ui-suite": "file:/absolute/path/to/applesdsh-dev/plugins/dsh-ui-suite",
    "dsh-web-search-tavily": "github:Alamanes/applesdsh-dev#path:plugins/dsh-web-search-tavily",
    "dsh-zh-prompt": "github:Alamanes/applesdsh-dev#path:plugins/dsh-zh-prompt",
    "meow-memory": "github:Alamanes/applesdsh-dev#path:plugins/meow-memory"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-web-search-tavily",
        "dsh-zh-prompt",
        "dsh-ops",
        "meow-memory",
        "dsh-ui-suite"
      ]
    }
  }
}
```

`dsh-ui-suite` 的十五个组件以 `file:../<组件>` 指回本仓库同级目录，因此它需要以本地仓库的
绝对路径安装（`file:`）；用 `github:` 子目录说明符时 pnpm 只取该子目录，`file:../` 解析不到
同级组件包。其余插件用 `#path:` 即可，`#path:` 是 pnpm 的 Git 子目录说明符（pnpm v9 起支持；
本机运行时为 v11.7.0），整条说明符就是更新源。

由于本仓库使用 `dsh-web-search-tavily` 进行Web Search，Agent安装本仓库内容时请将DSH官方网页搜索插件关闭或删除。
非macOS设备请勿直接使用本仓库 `dsh-ops` 插件，请使用原上游仓库的正确版本。

## 更新

```sh
cd "$DSH_PROFILE_DIR"
pnpm install
```

pnpm 对 Git 依赖按 commit 缓存，仓库有新提交时用 `pnpm update dsh-ui-suite`
（或该插件对应的包名）强制重取，再重启 `dsh web`。`file:` 安装的套件改完源码后要重新
`pnpm install`，或把改动同步到 `node_modules/dsh-ui-suite` 后刷新页面。

## 来源与许可

所有插件均为 MIT，`dsh-ops` 为其上游的 MIT AND Apache-2.0。自产的包由本仓库维护；其余来自各自的
上游，收进本仓库是为了把更新源统一到一处，上游仍是事实上的作者：

- `dsh-status-phrases` 的替换逻辑、打字机锁宽与渐变 CSS 取自 npm 上的 `dsh-status-rotator`
  （MIT，01Virex），是那份实现的收窄复刻，现为套件的 `dsh-ui-status-phrases` 组件。
- `dsh-commandcode-quota` 出自 Jovan1666/commandcode-usage，现为套件的 `dsh-ui-quota` 组件。
- `dsh-plugin-harness-whale` 出自 HeShen-1/deepseek-whale-wallpaper 的 npm 包
  `dsh-plugin-harness-whale@0.2.0`，现为套件的 `dsh-ui-whale` 组件。
- `dsh-codex-reasoning-effort-slider` 出自 bakabaicai/DSH-Codex-reasoning-effort-slider，现为套件的
  `dsh-ui-effort-slider` 组件。
- `dsh-ops` 出自 T-Auto/dsh-ops，取自 `v0.3.1` 标签。npm 上最高只到 0.3.0，而 0.3.0 的平台表里只有
  `win32-x64`，在 Apple Silicon 上不注册任何工具；本仓库收录 0.3.1，并补入上游 `v0.3.1` Release 的
  `native-darwin-arm64-runtime-v0.3.1` 载荷（`runtime/darwin-arm64/`），macOS 上因此可用。未收录仓库里的
  `vendor/fastctx/`，它随上游后台组件的移除而作废。`package.json` 的 `version` 必须与 worker 的
  `provenance.json` 一致，改版本号会让 worker 校验失败，file 组件不再发布任何工具。

上游一旦更新，本仓库不会自动跟；需要时手动取回再提交。
