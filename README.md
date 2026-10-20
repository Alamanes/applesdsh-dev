# applesdsh-dev

个人的 DeepSeek Harness 插件源仓库。每个插件一个目录，profile 直接以本仓库为更新源安装，
不再依赖散落的本地路径或各自的 npm / GitHub 上游。

## 插件

| 目录 | 包名 | 说明 | 来源 |
|---|---|---|---|
| `plugins/dsh-codex-reasoning-effort-slider` | `dsh-codex-reasoning-effort-slider` | 复刻 Codex 桌面版的推理强度滑块：模型选择器弹层里的 Off / Low / High / Ultra 四挡滑轨、Fast 开关与粒子动画 | 上游 [bakabaicai/DSH-Codex-reasoning-effort-slider](https://github.com/bakabaicai/DSH-Codex-reasoning-effort-slider)，仅改了包名、客户端模块 id 与引擎声明 |
| `plugins/dsh-commandcode-quota` | `dsh-commandcode-quota` | 输入框模型选择器旁的 5 小时 / 周 / 月三条额度环，外加设置页的逐模型请求额度 | 上游 [Jovan1666/commandcode-usage](https://github.com/Jovan1666/commandcode-usage) 的 `plugins/dsh` |
| `plugins/dsh-local-identity` | `dsh-local-identity` | 侧栏左下角账号芯片改用本机配置的昵称与头像，并在设置 → 通用设置里提供配置行 | 本仓库自产 |
| `plugins/dsh-ops` | `dsh-ops` | Rust 原生文件工具：`ops_inspect_local_file`、`ops_grep`、`ops_glob`、`ops_replace`，外加 `ops_bash` | 上游 [T-Auto/dsh-ops](https://github.com/T-Auto/dsh-ops) 的 `v0.3.1` 标签，另随包补入 `runtime/darwin-arm64` worker |
| `plugins/dsh-peak-valley-hint` | `dsh-peak-valley-hint` | 侧栏底栏右端的峰谷时段提示：当前算高峰还是低谷、距下次切换的倒计时，法定节假日日期由插件自己联网获取 | 本仓库自产 |
| `plugins/dsh-plugin-harness-whale` | `dsh-plugin-harness-whale` | 界面背后的动态壁纸：约 1750 个 WebGL2 粒子组成的点阵鲸鱼，随主题给出淡蓝与深蓝两套配色，并接管页面底色、文字、边框与输入卡片 | 上游 [HeShen-1/deepseek-whale-wallpaper](https://github.com/HeShen-1/deepseek-whale-wallpaper) 的 npm 包 `dsh-plugin-harness-whale@0.2.0`，原样收进本仓库 |
| `plugins/dsh-restart` | `dsh-restart` | 会话标题栏右上角的「彻底重启 DSH」按钮与同名工具 `restart_dsh`：不等确认直接退出并重开应用，重启前记下其他正在运行的会话、重启后自动发「继续工作。」 | 本仓库自产，独立仓库 [Alamanes/dsh-restart](https://github.com/Alamanes/dsh-restart) |
| `plugins/dsh-session-delete` | `dsh-session-delete` | 会话行菜单里的「删除会话」：连同子代理会话、工作区引用与投影缓存一起从磁盘上删掉 | 本仓库自产 |
| `plugins/dsh-sidebar-foot-panels` | `dsh-sidebar-foot-panels` | 把侧栏顶部的「插件」「使用统计」「技能中心」三行摘出来，改成侧栏底部并排的三个小图标按钮；用不到的「自动化任务」整行一并隐藏 | 本仓库自产 |
| `plugins/dsh-status-phrases` | `dsh-status-phrases` | 状态行「深度求索中」替换：短语轮换 + 逐字打字机 + 彩虹流光，整份短语表由设置 → 通用设置里的一个多行文本框配置 | 本仓库自产，行为复刻自 [01Virex/dsh-status-rotator](https://github.com/01Virex/dsh-status-rotator) 的状态行替换与特效 |
| `plugins/dsh-ui-copy` | `dsh-ui-copy` | 界面文案改写：空态大标题、输入框空置提示、预览版徽章；另有 ask 弹窗与输入卡片的换皮、菜单开合动画、侧栏「新会话」按钮降噪四个独立组件 | 本仓库自产 |
| `plugins/dsh-web-search-tavily` | `dsh-web-search-tavily` | 给 `ctx.web` 接缝加一个 Tavily 搜索后端 | 本仓库自产 |
| `plugins/dsh-zh-prompt` | `dsh-zh-prompt` | 把第一方系统提示词换成简体中文，并注入「内部思考与最终回答使用简体中文」的语言规则 | 本仓库自产 |
| `plugins/meow-memory` | `meow-memory` | 跨会话长期记忆：七层 SQLite 记忆库、首轮快照注入、逐消息关键词命中、空闲 dream 整理 | 上游 [Phant0Meow/dsh-meow-memory](https://github.com/Phant0Meow/dsh-meow-memory) 的 `0.31.0` 发行产物，外加一个补丁让 `projectDir` 支持绝对路径，记忆库不再随工作区散落（见 `plugins/meow-memory/PATCH.md`） |

## 安装

把插件按 GitHub 子目录说明符登记进 profile 的 `package.json`：

```json
{
  "dependencies": {
    "dsh-codex-reasoning-effort-slider": "github:Alamanes/applesdsh-dev#path:plugins/dsh-codex-reasoning-effort-slider",
    "dsh-commandcode-quota": "github:Alamanes/applesdsh-dev#path:plugins/dsh-commandcode-quota",
    "dsh-local-identity": "github:Alamanes/applesdsh-dev#path:plugins/dsh-local-identity",
    "dsh-ops": "github:Alamanes/applesdsh-dev#path:plugins/dsh-ops",
    "dsh-peak-valley-hint": "github:Alamanes/applesdsh-dev#path:plugins/dsh-peak-valley-hint",
    "dsh-plugin-harness-whale": "github:Alamanes/applesdsh-dev#path:plugins/dsh-plugin-harness-whale",
    "dsh-restart": "github:Alamanes/applesdsh-dev#path:plugins/dsh-restart",
    "dsh-session-delete": "github:Alamanes/applesdsh-dev#path:plugins/dsh-session-delete",
    "dsh-sidebar-foot-panels": "github:Alamanes/applesdsh-dev#path:plugins/dsh-sidebar-foot-panels",
    "dsh-status-phrases": "github:Alamanes/applesdsh-dev#path:plugins/dsh-status-phrases",
    "dsh-ui-copy": "github:Alamanes/applesdsh-dev#path:plugins/dsh-ui-copy",
    "dsh-web-search-tavily": "github:Alamanes/applesdsh-dev#path:plugins/dsh-web-search-tavily",
    "dsh-zh-prompt": "github:Alamanes/applesdsh-dev#path:plugins/dsh-zh-prompt",
    "meow-memory": "github:Alamanes/applesdsh-dev#path:plugins/meow-memory"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-codex-reasoning-effort-slider",
        "dsh-web-search-tavily",
        "dsh-commandcode-quota",
        "dsh-status-phrases",
        "dsh-ui-copy",
        "dsh-local-identity",
        "dsh-ops",
        "dsh-peak-valley-hint",
        "dsh-plugin-harness-whale",
        "dsh-restart",
        "dsh-session-delete",
        "dsh-sidebar-foot-panels",
        "dsh-zh-prompt"
      ]
    }
  }
}
```

`#path:` 是 pnpm 的 Git 子目录说明符（pnpm v9 起支持；本机运行时为 v11.7.0），
整条说明符就是更新源：改完仓库推上去后重跑一次 profile 的 `pnpm install` 即取到新版本。

由于本仓库使用 `dsh-web-search-tavily` 进行Web Search，Agent安装本仓库内容时请将DSH官方网页搜索插件关闭或删除。
非macOS设备请勿直接使用本仓库 `dsh-ops` 插件，请使用原上游仓库的正确版本。

## 更新

```sh
cd "$DSH_PROFILE_DIR"
pnpm install
```

pnpm 对 Git 依赖按 commit 缓存，仓库有新提交时用 `pnpm update dsh-ui-copy`
（或该插件对应的包名）强制重取，再重启 `dsh web`。

## 来源与许可

所有插件均为 MIT，`dsh-ops` 为其上游的 MIT AND Apache-2.0。自产的包由本仓库维护；其余来自各自的
上游，收进本仓库是为了把更新源统一到一处，上游仍是事实上的作者：

- `dsh-status-phrases` 的替换逻辑、打字机锁宽与渐变 CSS 取自 npm 上的 `dsh-status-rotator`
  （MIT，01Virex），是那份实现的收窄复刻：只保留状态行替换与特效，并把短语配置收敛成设置里的一个
  文本框。该上游包已从本仓库与本机移除，这份复刻是它在状态行上的唯一延续。
- `dsh-commandcode-quota` 出自 Jovan1666/commandcode-usage，README 与代码内的上游链接保留。
- `dsh-plugin-harness-whale` 出自 HeShen-1/deepseek-whale-wallpaper，收进本仓库的是 npm 上 0.2.0 的
  发行产物（`lib/` 四个文件含 sourcemap、`cordis.patch.yml`、双语文档与 LICENSE），`package.json` 的
  `repository` / `homepage` / `bugs` 仍指向上游，代码与配置一字未改。上游仓库里才有 TypeScript 源码与
  构建脚本，本仓库只做分发。
- `dsh-codex-reasoning-effort-slider` 出自 bakabaicai/DSH-Codex-reasoning-effort-slider，`package.json` 的
  `repository` 字段指向上游，包名与客户端模块 id 由 `@local/dsh-codex-reasoning-effort-slider` 改为
  `dsh-codex-reasoning-effort-slider`，原先精确锁定 `@deepseek-ai/dsh` 0.2.0-rc.2 的 `peerDependencies`
  改为 `engines.dsh` 的版本区间，其余代码原样。
- `dsh-ops` 出自 T-Auto/dsh-ops，取自 `v0.3.1` 标签。npm 上最高只到 0.3.0，而 0.3.0 的平台表里只有
  `win32-x64`，在 Apple Silicon 上不注册任何工具；本仓库收录 0.3.1，并补入上游 `v0.3.1` Release 的
  `native-darwin-arm64-runtime-v0.3.1` 载荷（`runtime/darwin-arm64/`），macOS 上因此可用。未收录仓库里的
  `vendor/fastctx/`，它随上游后台组件的移除而作废。`package.json` 的 `version` 必须与 worker 的
  `provenance.json` 一致，改版本号会让 worker 校验失败，file 组件不再发布任何工具。

上游一旦更新，本仓库不会自动跟；需要时手动取回再提交。
