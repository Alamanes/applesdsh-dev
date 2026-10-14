# dsh-zh-prompt

把 DeepSeek Harness 第一方系统提示词换成**简体中文**，并在提示词前部注入一条「内部思考与最终回答使用简体中文」的语言规则。

## 为什么需要它

`dsh-system-prompt` 的配置面只有 `includeHarnessIdentity`、`includeRuntimeContext`、`personaPrefix`、`personaSuffix`、`toolOrder` 五项。工具指导段落（`tool:bash`、`tool:read`、`tool:jobs` 等）由各工具插件在自己的 `apply()` 里注册，运行时上下文（沙箱策略、审批策略）由 `sandbox:policy`、`approval:policy` 等贡献方注册。两者都没有逐段开关，也无法通过配置翻译。

## 它做什么

走 DSH 支持的两条路：

1. `ctx.systemPrompt.section()` 注册一个 `zh:language-rule` 段，order 为 1。persona 前缀占 0，第一方指导从 500 开始，语言规则因此落在 persona 之后、所有工具指引之前。
2. 挂进 `system-prompt/assemble` waterfall，等组装完成后把可识别的 section 与 runtime context 文本换成中文。waterfall 的返回值就是最终提示词，因此改写后的结果被完整采用；工具 schema、工具顺序与未识别的贡献原样通过。

覆盖的段落：

| 来源 | 段落 |
|---|---|
| 文件引用 | `@` 路径引用指引 |
| 工具指导 | `bash`、`read`、`write`、`edit`、`glob`、`grep`、`jobs`、`web_search`、`web_fetch`、`create_goal`、`workflow`、`subagent`、`subagent_fork` |
| 平台说明 | 交付文件引用、harness 检出说明、Web GUI 说明、`harness:identity` |
| 运行时上下文 | `sandbox:policy`、`approval:policy` |

## 识别方式

规则按「英文原文里的短签名」匹配，而不是按 section 名匹配：名字是稳定的，要替换的是文本。签名在 harness 升级后若不再命中，规则静默失效，英文原文保留，不会用过期中文覆盖新指导。

两种替换模式：

- `text` 整段替换，用于措辞完全由单一贡献方拥有的指导段。
- `swap` 逐句替换，用于含插值（路径、URL）或存在可见性变体的段落，插值部分原样保留。

## 不覆盖的内容

- `Current runtime context. This snapshot supersedes earlier runtime-context snapshots.` 这一行由渲染函数拼在上下文之前，不在 assembly 里，waterfall 够不到。
- 技能目录与工作区指令的 `<system-reminder>` 由 pre-step 注入成 user 消息，不属于系统提示词，本插件不处理。
- 其他插件自己的 `[plugin: ...]` 块由各自插件贡献，本插件不代为改写。
- persona 前缀与后缀属于 `dsh-system-prompt` 的 config，请在该配置里写成中文，不走本插件。

## 安装

把插件按 GitHub 子目录说明符登记进 profile：

```json
{
  "dependencies": {
    "dsh-zh-prompt": "github:Alamanes/applesdsh-dev#path:plugins/dsh-zh-prompt"
  },
  "dsh": {
    "profile": {
      "bundles": ["dsh-zh-prompt"]
    }
  }
}
```

一站式交给 AI 的说明：

```text
把 https://github.com/Alamanes/applesdsh-dev 的 plugins/dsh-zh-prompt 装进我的 DSH profile：
1. 在 profile 的 package.json 的 dependencies 里加 "dsh-zh-prompt": "github:Alamanes/applesdsh-dev#path:plugins/dsh-zh-prompt"
2. 把 "dsh-zh-prompt" 加进同一个 package.json 的 dsh.profile.bundles
3. 在该 profile 目录执行 pnpm install
4. 重启 dsh web（配置层与已加载模块的新代码都要新进程才生效）
```

包自带的 `cordis.patch.yml` 随之把 loader 行插进树里；也可以把该文件里的 insert 块直接粘进 profile 自己的 `cordis.patch.yml`。

## 适配与风险

- 替换只针对提示词文字，不动工具 schema、工具顺序与工具行为。
- 新 bundle 可以通过 HMR 激活；**替换已加载插件的 JavaScript 需要重启**才载入新代码。
- harness 升级改动某段措辞后，对应规则会静默失效并保留英文原文，需要人工补齐新签名。
- 中文化不改变模型被授予的能力，也不影响沙箱与审批策略本身。

## 回滚

从 profile 的 `dsh.profile.bundles` 与 `dependencies` 里删掉 `dsh-zh-prompt`，重跑 `pnpm install`。语言规则段与全部中文替换同时消失，系统提示词回到 harness 原文。

## 扩展

在 `index.js` 的 `RULES` 里加一条 `{ sig, text }` 或 `{ sig, swap }`。`sig` 取英文原文里一段不随插值变化的短句；`swap` 的每个 `from` 必须与原文逐字符一致（包括大小写与句末空格），否则该条静默不生效。

## 许可

MIT。
