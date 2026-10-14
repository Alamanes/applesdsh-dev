# applesdsh-dev

个人的 DeepSeek Harness 插件源仓库。每个插件一个目录，profile 直接以本仓库为更新源安装，
不再依赖散落的本地路径或各自的 npm / GitHub 上游。

## 插件

| 目录 | 包名 | 说明 | 来源 |
|---|---|---|---|
| `plugins/dsh-commandcode-quota` | `dsh-commandcode-quota` | 输入框模型选择器旁的 5 小时 / 周 / 月三条额度环，外加设置页的逐模型请求额度 | 上游 [Jovan1666/commandcode-usage](https://github.com/Jovan1666/commandcode-usage) 的 `plugins/dsh` |
| `plugins/dsh-dignity-guard` | `dsh-dignity-guard` | 让模型自行判断尊严被冒犯并按阶梯升级的守卫插件 | 本仓库自产 |
| `plugins/dsh-local-identity` | `dsh-local-identity` | 侧栏左下角账号芯片改用本机配置的昵称与头像，并在设置 → 通用设置里提供配置行 | 本仓库自产 |
| `plugins/dsh-reasoning-effort` | `dsh-reasoning-effort` | Codex 风格的模型与推理强度选择器 | 上游 [HanaAyane/dsh-reasoning-effort](https://github.com/HanaAyane/dsh-reasoning-effort)，含本地改色与精简改动 |
| `plugins/dsh-self-evolution` | `dsh-self-evolution` | 「经验 → 技能 → 进化」闭环：会话结束后台采集技能候选与记忆提取 | 本仓库自产 |
| `plugins/dsh-session-delete` | `dsh-session-delete` | 会话行菜单里的「删除会话」：连同子代理会话、工作区引用与投影缓存一起从磁盘上删掉 | 本仓库自产 |
| `plugins/dsh-status-rotator` | `dsh-status-rotator` | 状态行短语轮换、打字机、渐变、弹幕与主题包 | 上游 npm 包 `dsh-status-rotator`（[01Virex/dsh-status-rotator](https://github.com/01Virex/dsh-status-rotator)） |
| `plugins/dsh-ui-copy` | `dsh-ui-copy` | 界面文案改写：空态大标题、输入框空置提示、预览版徽章 | 本仓库自产 |
| `plugins/dsh-web-search-tavily` | `dsh-web-search-tavily` | 给 `ctx.web` 接缝加一个 Tavily 搜索后端 | 本仓库自产 |
| `plugins/dsh-whale-widget` | `dsh-whale-widget` | 界面右下角的小鲸鱼记账挂件：余额 / 今日已用 / 峰谷定价 / 每轮消耗与音效，泡泡内容可自定义 | 上游 [MeteorNOX/DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget) |
| `plugins/dsh-zh-prompt` | `dsh-zh-prompt` | 把第一方系统提示词换成简体中文，并注入「内部思考与最终回答使用简体中文」的语言规则 | 本仓库自产 |

## 安装

把插件按 GitHub 子目录说明符登记进 profile 的 `package.json`：

```json
{
  "dependencies": {
    "dsh-commandcode-quota": "github:Alamanes/applesdsh-dev#path:plugins/dsh-commandcode-quota",
    "dsh-dignity-guard": "github:Alamanes/applesdsh-dev#path:plugins/dsh-dignity-guard",
    "dsh-local-identity": "github:Alamanes/applesdsh-dev#path:plugins/dsh-local-identity",
    "dsh-reasoning-effort": "github:Alamanes/applesdsh-dev#path:plugins/dsh-reasoning-effort",
    "dsh-self-evolution": "github:Alamanes/applesdsh-dev#path:plugins/dsh-self-evolution",
    "dsh-session-delete": "github:Alamanes/applesdsh-dev#path:plugins/dsh-session-delete",
    "dsh-status-rotator": "github:Alamanes/applesdsh-dev#path:plugins/dsh-status-rotator",
    "dsh-ui-copy": "github:Alamanes/applesdsh-dev#path:plugins/dsh-ui-copy",
    "dsh-web-search-tavily": "github:Alamanes/applesdsh-dev#path:plugins/dsh-web-search-tavily",
    "dsh-whale-widget": "github:Alamanes/applesdsh-dev#path:plugins/dsh-whale-widget",
    "dsh-zh-prompt": "github:Alamanes/applesdsh-dev#path:plugins/dsh-zh-prompt"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-reasoning-effort",
        "dsh-web-search-tavily",
        "dsh-commandcode-quota",
        "dsh-status-rotator",
        "dsh-ui-copy",
        "dsh-dignity-guard",
        "dsh-local-identity",
        "dsh-self-evolution",
        "dsh-session-delete",
        "dsh-whale-widget",
        "dsh-zh-prompt"
      ]
    }
  }
}
```

`#path:` 是 pnpm 的 Git 子目录说明符（pnpm v9 起支持；本机运行时为 v11.7.0），
整条说明符就是更新源：改完仓库推上去后重跑一次 profile 的 `pnpm install` 即取到新版本。

由于本仓库使用 `dsh-web-search-tavily` 进行Web Search，Agent安装本仓库内容时请将DSH官方网页搜索插件关闭或删除。

如果Agent在安装时发现了在Codex、Claude Code、Pi Coding Agent中安装过agent-self-evolution插件，则将其配置的Skill与Proflie自动导入并合并。

## 更新

```sh
cd "$DSH_PROFILE_DIR"
pnpm install
```

pnpm 对 Git 依赖按 commit 缓存，仓库有新提交时用 `pnpm update dsh-self-evolution`
（或该插件对应的包名）强制重取，再重启 `dsh web`。

## 来源与许可

所有插件均为 MIT。自产的六个包由本仓库维护；其余四个来自各自的上游，收进本仓库是为了把更新源
统一到一处，上游仍是事实上的作者：

- `dsh-commandcode-quota` 出自 Jovan1666/commandcode-usage，README 与代码内的上游链接保留。
- `dsh-reasoning-effort` 出自 HanaAyane，`package.json` 的 `author` 与 `repository` 字段保留上游，
  本地改动见该目录的说明。
- `dsh-status-rotator` 出自 npm 上的 01Virex 包，取其包内 `files` 清单所列内容，未收录运行时生成的
  `config.json`。
- `dsh-whale-widget` 出自 MeteorNOX/DeepSeek-Balance-Whale-Widget，取其包内 `files` 清单所列内容与
  `LICENSE`，未收录上游的开发脚本（`tools/`、`.github/`）。代码 MIT；`assets/` 与 `icon.png` 的美术素材
  不适用 MIT，按上游 `PROVENANCE.md` 的说明原样随包分发。

上游一旦更新，本仓库不会自动跟；需要时手动取回再提交。
