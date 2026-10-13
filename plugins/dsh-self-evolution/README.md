# dsh-self-evolution

> **The agent that grows with you.**
> agent-self-evolution 的 DSH 原生移植：把「经验 → 技能 → 进化」闭环做成一个 DSH 插件。

一个后台采集器在任务结束后安静地分析会话轨迹，分两条腿：**技能腿**把值得复用的经验草拟成技能候选，**记忆腿**在会话闲置后提取关于你的持久信息、由每天的 Dream 合并成一篇画像文章。技能候选只写进待确认区，在你审查通过之前绝不进入任何上下文；画像文章则每天最多重写一次，渲染后注入运行时上下文。当你说「进化」，一套完全手动的流程才会审查候选、启用技能、体检归档、核对记忆。

## 与 Pi 版的关系

| | |
|---|---|
| 原型 | agent-self-evolution（Pi / Claude Code / Codex 三平台，同一作者） |
| 两代底本 | 公开版是较宽的多平台核心；Pi 机器上长期运行的是**另一实现**，记忆架构已从「画像草稿 + USER.md 平铺条目」改为「逐会话提取 + Dream + PROFILE.md 文章」。本移植的记忆腿照另一实现实现，技能、体检、流程部分照两版共有的设计 |
| 本移植 | 把平台无关核心重新实现为 DSH 插件，保留数据目录布局、环境变量语义、阈值、提示词与流程纪律 |
| 定位 | 本地自用；插件源随 `applesdsh-dev` 一并公开，但记忆腿与身份信息处理的实现细节不在公开文档里展开 |
| 许可 | MIT（沿用原型设计，保留原项目的版权与致谢） |

保留下来的东西正是那套设计：采集与进化解耦、候选隔离、增量采集、零 token 规则工具链、用量归因与三线体检、隐私熔断、总量硬约束，以及记忆的三道闸门（闲置、收件箱上限、Dream 间隔）。

## 安装

DSH 的 `desktop` profile 由桌面应用独占管理，命令行不能直接写入。两条可用路径：

**方式一：桌面应用**

插件 → 添加插件 → 填入 `github:Alamanes/applesdsh-dev#path:plugins/dsh-self-evolution` → 安装 → 重启 `dsh web`。

**方式二：让助手代劳**

在新会话里对助手说：

> 用 plugin_manager 的 install_bundle 安装 `github:Alamanes/applesdsh-dev#path:plugins/dsh-self-evolution`，然后确认 self-evolution 这一行已启用。

包的 manifest 已按 DSH 约定写好：`dsh.bundle.patch` 指向 `cordis.patch.yml`（插入宿主行），`dsh.client` 声明浏览器半边，`exports` 同时导出 `./client`。安装后 `/reload` 或重启生效。

## 一个插件，十个组件

| 组件 | 文件 | 职责 |
|---|---|---|
| 轨迹适配层 | `lib/projection.js`、`lib/trace.js` | 唯一知道 DSH 会话事件词汇的模块。把 `user/message`、`assistant/message`、`tool/result` 折成统一轨迹协议，作为 `sessionProjections` 单元注册，因此重启与恢复后仍从日志重放得到同一份状态 |
| 技能腿采集器 | `lib/collector.js` | 增量游标、触发阈值、候选区上限、节流、重试上限、拒因留痕、候选脱敏、隐私与自我管理熔断 |
| 记忆腿 | `lib/dream.js` | 闲置闸门、逐会话提取进收件箱、Dream 合并闸门、清扫已关闭会话；两腿水位与失败账户各自独立 |
| 画像文章 | `lib/memory-article.js`、`lib/memory.js` | 提取与 Dream 两个提示词、文章格式机械校验、降人称与注入前言、收件箱与按月归档的读写、注入渲染的变更检测 |
| 采集模型 | `lib/llm.js` | 走宿主的 `ctx.llm`：钉扎模型 → 自动发现（按上下文窗口从小到大）→ 会话自身模型兜底，逐项降级，丢弃项留痕，链指纹缓存 6 小时 |
| 候选隔离区 | `lib/candidates.js` | `candidates/<slug>/` 的读写、机械预检、启用/并入/淘汰的裁决与留档 |
| 技能供给 | `lib/skills.js` | 通过 `ctx.skills.registerProvider()` 只提供 `skills/` 下的技能与内置流程技能；启用与归档即文件移动 + 重新发布 |
| 反馈回路 | `lib/usage.js`、`lib/health.js` | 纯规则扫描轨迹记录技能使用与结果归因；三维打分与六类分级 |
| 手动流程与表面 | `lib/evolve.js`、`lib/tools.js`、`lib/commands.js`、`lib/api.js`、`client.js` | brief / preflight / enable / merge / reject / archive / restore / health / usage / dream / models / trail / collect / doctor / finish；一个 `evolve` 工具、一族 `/evolve` 命令、一条只读 HTTP 路由；浏览器半边不注册任何界面 |
| 账目与检查 | `lib/state.js`、`lib/doctor.js`、`lib/docs.js` | 两条水位与增量合并写盘、完整性检查（含文章结构校验）、细则文档与流程技能的绝对路径 |

## 使用

**技能腿不需要你做任何事。** 每轮收尾后插件检查本次会话的新增轨迹：满足触发条件（工具调用 ≥5 次或出现错误）时，用最低可用推理强度起草一个技能候选。无趣的会话零调用。

**记忆腿也不需要。** 会话闲置 5 分钟后，插件提取该会话里关于你的持久信息写进 `memory/inbox/`；距上次合并满 24 小时时，Dream 把收件箱与现有文章合并、全篇重写成 `memory/PROFILE.md`。文章渲染成「固定前言 + 降人称正文」后注入运行时上下文，每次会话都读得到。用完就关的会话由清扫器补上，不要求你重开旧会话。

**进化由你触发。** 说「进化」或「总结一天的工作」，助手会加载内置的 `self-evolve` 技能，按其流程执行；全部机械动作由 `evolve` 工具完成，没有 shell 脚本。

命令：

```
/evolve                  状态概览
/evolve brief            一次探测（状态、候选、记忆现状、记分卡、本轮走向）
/evolve health [--all]   技能记分卡
/evolve candidates       候选清单
/evolve collect          立即对当前会话跑一次技能腿采集
/evolve dream            立即跑一次记忆轮次（提取 + 按需 Dream）
/evolve models           查看采集模型链的解析结果与丢弃项
/evolve trail <关键词>   定点回查当前会话轨迹（限长）
```

工具：

```
evolve action="brief"
evolve action="preflight" [slug="<候选>"]
evolve action="enable" slug="<候选>" [name="<技能名>"]
evolve action="merge" slug="<候选>" target="<技能名>" reason="…"
evolve action="reject" slug="<候选>" reason="…"
evolve action="archive"|"restore" name="<技能名>"
evolve action="health" [all=true]  |  usage name="<技能名>"
evolve action="dream"            手动记忆轮次（跳过闲置闸门）
evolve action="models"           采集链解析结果
evolve action="trail" keyword="…" [max=30] [chars=4000]
evolve action="collect"  |  doctor
evolve action="finish" summary="…" updated=N repaired=N rejected=N merged=N
```

浏览器半边不注册任何界面：原先在输入框下方的那行状态条（候选 / 收件箱 / 技能数 / 上次 Dream 与上次进化时间）已按用户要求删除，`client.js` 只保留一个空的 `apply()`，包清单与启动图因此不变。数据仍由只读路由 `/api/self-evolution/overview` 提供，需要时用 `curl` 或 `/evolve` 命令查看。

## 数据目录

默认 `$DSH_HOME/evolution`（`DSH_HOME` 未设置时即 `~/.dsh/evolution`，与 harness 自己的 `sessions/`、`storages/` 并列）；插件行的 `root` 配置与 `SE_ROOT` 环境变量可覆盖，优先级为 `root` > `SE_ROOT` > 默认值。

```
<root>/
├── candidates/<slug>/{SKILL.md,meta.md}   候选区（不进上下文）
├── skills/<name>/SKILL.md                 已启用技能（经技能注册表对模型可见）
├── archived/<name>/                       归档技能与已处置候选的留档
├── memory/PROFILE.md                      长期记忆：画像文章（Dream 全量重写，渲染后注入）
├── memory/inbox/                          逐会话提取，等 Dream 合并（满 20 份暂停提取）
├── memory/archive/YYYY-MM/                已消费提取的按月归档
├── logs/experience-log.md                 经验沉淀日志（超 100 行自动归档）
├── logs/archive/ledger-backup/            收尾时的账目快照（state.json / usage.json）
├── logs/rejected-drafts/                  被拒草稿留档（截断、格式不符等）
├── state.json                             两条水位、计数、熔断标记与链指纹
├── usage.json                             技能使用与结果归因
└── config.json                            采集链配置
```

字段语义、计数口径、熔断条件与阈值见 [`docs/state-ledger.md`](docs/state-ledger.md)。

## 配置

插件行配置（`cordis.patch.yml`）：

```yaml
- id: self-evolution
  name: "dsh-self-evolution"
  config:
    root: ""            # 数据根，空则按 root 配置 > SE_ROOT > $DSH_HOME/evolution 解析
    autoCollect: true   # 每轮收尾自动跑技能腿，并武装记忆腿的闲置计时器
    injectProfile: true # 把渲染后的 memory/PROFILE.md 注入运行时上下文
    sweep: true         # 启动与闲置轮次后清扫已关闭的会话
    flowSkill: true     # 提供内置 self-evolve 流程技能
    tool: true          # 注册 evolve 工具
    commands: true      # 注册 /evolve 命令
    routes: true        # 注册面板只读路由
    collector:
      models: []        # 钉扎的采集模型 [{provider, model}]
      auto: true        # 自动发现并按上下文窗口从小到大排序
      includeCurrentModel: true
      max: 3            # 采集链长度上限
```

环境变量（沿用原型命名）：`SE_ROOT`、`SE_MIN_TOOL_CALLS`(5)、`SE_MAX_CANDIDATES`(20)、`SE_MAX_TRACE_CHARS`(2500)、`SE_MAX_OUTPUT_TOKENS`(5120)、`SE_THROTTLE_MS`(0)、`SE_MAX_SKILL_CHARS`(8000)、`SE_MAX_SKILLS`(40)、`SE_MAX_COLLECT_RETRIES`(3)、`SE_PRIVATE_PATTERNS`（逗号分隔，**追加**在内置 25 项之后）。

记忆腿：`SE_MEMORY_IDLE_MS`(5 分钟)、`SE_DREAM_INTERVAL_MS`(24 小时)、`SE_MAX_EXTRACTS`(20)、`SE_MAX_EXTRACT_OUTPUT_TOKENS`(3072)、`SE_MAX_ARTICLE_OUTPUT_TOKENS`(8192)。

清扫：`SE_SWEEP`(1)、`SE_SWEEP_MAX`(3)、`SE_SWEEP_BACKFILL_MS`(7 天)、`SE_SWEEP_COOLDOWN_MS`(10 分钟)、`SE_SWEEP_LOCK_STALE_MS`(30 分钟)。

`SE_LLM_CMD`、`SE_BACKEND`、`SE_API_BASE/KEY/MODEL` 在本移植中不再存在：采集改走宿主的 `ctx.llm`，模型与凭据由 DSH 自己管理。需要指定便宜模型时用 `collector.models` 钉扎。

## 与 Pi 原型的差异

| 原实现 | 本移植 | 原因 |
|---|---|---|
| 平台 hook 调用 `core/collect.py` | `sessionProjections` 单元折出统一轨迹，插件内联采集 | DSH 的扩展面是进程内插件与事件，没有 Claude Code 那类外部 hook 外壳 |
| 统一 JSONL 轨迹文件 | 同一套记录形状，但直接来自会话日志 | 不再需要中间文件；`snapshotEvents` 已被 DSH 标记为不推荐，投影是官方路径 |
| claude / codex CLI / OpenAI 兼容 API / 自定义命令 | `ctx.llm` 单一后端，四层能力探测变成模型链逐项降级 | 凭据与模型目录已经由 DSH 拥有，插件不该再拿第二份 |
| 按价格挑最便宜的模型 | 按上下文窗口从小到大挑，`collector.models` 可钉扎 | DSH 不暴露价格元数据；窗口是最接近的成本代理，且行为可预测 |
| 技能用软链挂到 `~/.pi/agent/skills/` | 通过 `ctx.skills.registerProvider()` 提供 `skills/` 目录 | 0.2.0 的技能架构是作用域 + frontmatter 策略，软链不再是主机制；provider 还能触发注册表失效 |
| `evolve_brief.sh` / `evolve_finish.py` / `skill_scorecard.py` / `candidate_preflight.py` / `evolve_trail.py` | 同名能力的工具动作（纯 JS，无子进程） | 同样的零 token 纪律，少一层 shell 引用、转义与 `rg` 回退分支 |
| 数据根由 install.sh 初始化，docs 复制到 `$SE_ROOT/docs/` | 首次激活自动建目录与模板；细则文档留在包内按需读取 | 包路径稳定，升级即更新，不再需要复制一份可能过期的文档 |
| 默认数据根 `~/.config/agent-self-evolution` | 默认数据根 `$DSH_HOME/evolution`（即 `~/.dsh/evolution`） | DSH 插件的数据属于 DSH 家目录，与 harness 自己的 `sessions/`、`storages/` 并列；旧目录不自动读取，需要的用 `SE_ROOT` 指过来 |
| `logs/experience-log.md` 按行归档（保留 40 行） | 同一规则 | 保持可追溯 |
| 采集器与记忆腿直写 `state.json`（原子写 + 字段级合并） | 同，计数按载入快照做增量叠加 | 原子写只防半写，不防两个进程互相覆盖增量；桌面应用与会话 CLI 会同时采集 |
| 记忆腿读会话文件 mtime 判定闲置，定时器靠进程内 `setTimeout` | 闲置判定用进程内的会话活动时钟；清扫改走宿主 `sessionQuery` 服务读已关闭会话 | 插件拿不到会话文件路径，`sessionQuery` 是宿主给应用代码读历史的正规入口，且不必自己解析 zstd 压缩的会话日志 |
| 注入写 `~/.pi/agent/APPEND_SYSTEM.md`（真实文件，非软链） | 经 `ctx.systemPrompt.context` 发布同一份「前言 + 降人称正文」 | DSH 没有追加系统提示的文件机制，运行时上下文贡献是原生机制；前言与降人称两个保护都保留 |
| 逐会话提取的水位按会话文件名记 | 按会话 id 记 | DSH 的会话目录就是 id，不存在 Pi 那种同名 `session.jsonl` 互相顶掉的问题 |
| git 提交由 `evolve_finish.py` 执行 | `finish` 动作执行，只 `git add -- <root>`，仓库根或家目录会被拒绝 | 保持可回滚，且绝不把项目改动卷进进化提交 |

## 功能对照

原型的每一项能力，逐条对照本移植的落地位置。

| 原功能 | 本移植 | 落在哪 |
|---|---|---|
| 任务结束后台自动采集 | 同 | `agent/turn-stopping` 监听 + `lib/collector.js` |
| 双路采集：技能候选 + 记忆提取，失败互不影响、水位分账 | 同 | 技能腿 `lib/collector.js`，记忆腿 `lib/dream.js` |
| 触发阈值（工具调用 ≥5 次，或出现错误） | 同 | `SE_MIN_TOOL_CALLS` |
| 增量采集，只分析上次采集点之后的新内容 | 同，游标从行号换成记录序号 | `state.collectedUpTo` |
| 全局节流 | 同 | `SE_THROTTLE_MS` |
| 候选区堆积上限后暂停采集 | 同 | `SE_MAX_CANDIDATES` |
| 临时性失败不推进游标，连续失败到上限才放弃 | 同 | `SE_MAX_COLLECT_RETRIES` |
| 采集链：钉扎 → 自动挑 → 当前模型兜底，逐项降级，丢弃留痕 | 同，排序依据从价格换成上下文窗口 | `lib/llm.js` |
| 采集后端不可用标记 | 同 | `state.collectorUnavailable` |
| 拒绝原因记录（state.rejections + 日志 + 不打扰用户） | 同 | `lib/state.js` |
| 草稿截断启发式（围栏不闭合、尾部中断） | 同 | `lib/collector.js` |
| 查重双保险（提示词带已启用清单 + 代码层同名拒绝） | 同，另加名称与描述相似度警示 | `lib/prompts.js`、`lib/candidates.js` |
| 自我管理会话熔断（短指令触发词 ≤30 字 + 自管理路径标记） | 同 | `lib/trace.js` |
| 隐私熔断：25 项词表、只判工具调用的文件路径、整场跳过、force 不绕过 | 同 | `lib/text.js`、`lib/collector.js` |
| 凭据熔断：正文出现 `sk-` / `ghp_` / `AKIA` / 私钥块等高置信形态整场跳过 | 同 | `lib/text.js` `touchesHardSecretText` |
| 轨迹外发前掩码凭据与邮箱 + 家目录归一 | 同 | `sanitizeTraceText` |
| 候选与画像草稿不进上下文 | 技能候选仍隔离；画像文章经 `brief` 展示字符数与降人称处数后注入 | `lib/skills.js` |
| 手动触发的进化流程（五步） | 同 | `self-evolve` 技能 + `evolve` 工具 |
| 一键探测（原 `evolve_brief.sh`） | 同，并新增完整性检查段 | `evolve action="brief"` |
| 候选机械预检（格式、大小、截断、同名、相似度） | 同 | `evolve action="preflight"` |
| 候选启用 / 并入 / 淘汰 | 同 | `enable` / `merge` / `reject` |
| 技能体检三线（闲置 15 与 30 天、沉睡、问题、优质、未观测） | 同 | `lib/health.js` |
| 记分卡三维打分与六类分级、小结、归档候选与问题清单 | 同 | `evolve action="health"` |
| 使用统计：强弱信号、结果归因、失败原因、会话去重、盘点跳过、旧条目字段补齐 | 同 | `lib/usage.js` |
| 技能总量约 40 的硬约束 | 同（报告 + 用户决策） | 记分卡小结 |
| 超长技能压缩流程 | 同（原实现也是人工步骤，无脚本） | `docs/skill-health.md` |
| 归档与恢复 | 同，并立即重新发布技能目录 | `archive` / `restore` |
| 会话闲置 5 分钟后逐会话提取持久信息 | 同，闲置判定用插件内的会话活动时钟 | `lib/dream.js`、`SE_MEMORY_IDLE_MS` |
| 提取写入收件箱，文件满 20 份暂停提取并提示 | 同 | `memory/inbox/`、`SE_MAX_EXTRACTS` |
| 提取的机械校验（每条以「- 」开头、≤600 字符、剔提示词回显、内容完全重复则跳过） | 同 | `lib/dream.js`、`lib/memory-article.js` |
| Dream：24 小时闸门 + 采集链可用才合并 | 同 | `runDreamGate`、`SE_DREAM_INTERVAL_MS` |
| Dream 全量重写画像文章（散文段落、两级章节、首节「概览」、无列表无表情） | 同，格式校验逐条保留 | `parseArticle`、`MAX_ARTICLE_CHARS` |
| 文章的固定前言 + 注入前降人称（引号内保留） | 同，注入面换成 `ctx.systemPrompt.context` | `INJECTION_HEADER`、`toThirdPerson` |
| 已消费提取按月归档，不删除 | 同 | `memory/archive/YYYY-MM/` |
| 清扫：补上用完就关、永远不会再成为当前会话的窗口 | 同，改走宿主 `sessionQuery` 读已关闭会话；单轮上限、回补窗口、跨进程锁与冷却保留 | `sweepClosedSessions` |
| Dream 成功/失败计数、收件箱堆积、注入刷新留痕 | 同 | `state.stats.dreams` 等 |
| 采集链指纹缓存 6 小时，链变化留一行 | 同 | `state.collectorChain*`、`lib/llm.js` |
| 「不值得沉淀」与「人工淘汰」分开计数 | 同 | `collectorSkips` 与 `candidatesRejected` |
| 熔断日志按（会话, 类型）去重 | 同 | `noteBreaker` |
| 收尾把两个账目文件快照到 `logs/archive/ledger-backup/` | 同 | `finish` |
| 被拒草稿留档到 `logs/rejected-drafts/` | 同 | `lib/collector.js` |
| 逐会话映射的水位清理（会话消失即删条目） | 同（在清扫时按宿主已知会话表清理） | `pruneWatermarks` |
| 进化报告三节模板与 1200 字上限 | 同 | `docs/report-template.md` |
| 经验日志与超限自动归档 | 同 | `lib/store.js` |
| state.json 原子写与计数（含 evolutions、skillsRepaired） | 同 | `lib/state.js`、`finish` |
| 收尾的 git 提交与严格范围校验 | 同 | `finish` |
| 跨进程排他锁 | 同，覆盖面从「只护收尾」扩到所有写动作 | `withLock` |
| 一键体检（原 `healthcheck.sh`） | 同，检查项按宿主能力重写；收尾前自动跑，硬性问题中止收尾 | `evolve action="doctor"` |
| 轨迹定点回查（原 `evolve_trail.py`） | 同 | `evolve action="trail"` |
| 手动强制采集 | 同 | `evolve action="collect"` / `/evolve collect` |
| 平台 hook 安装与配置（`install.sh`、`hook_config.py`） | 不需要 | 插件行本身就是注册 |
| 平台说明以标记块幂等合并进 `AGENTS.md` 等 | 不做 | 提示词段由插件 fiber 拥有，卸载即撤销，不写用户文件 |
| 多平台适配（Pi / Claude Code / Codex） | DSH 单平台 | 本插件就是那个新平台的适配层 |
| 采集后端：自定义命令、claude CLI、codex CLI、OpenAI 兼容 API、auto | 统一为宿主 `ctx.llm` | 见上方差异表 |
| `logs/session-summaries/`（每日工作总结） | 不做 | 另一实现已功能性删除，只留历史文件；本插件从零开始，不建该目录 |
| 画像去识别过滤（`stripIdentityLines`） | 不做 | 另一实现 2026-09-25 决策后记忆腿已不再调用它：身份信息允许进入画像，但技能里禁止 |

## 成本

| 环节 | 成本 | 控制手段 |
|---|---|---|
| 扫描轨迹、统计、查重、预检、打分、归档、计数 | 0 | 全在纯函数里 |
| 每次达标任务的采集 | 最多 1 次低成本技能调用 | 阈值 5 次工具调用；摘要截断 2500 字符（分段限额，错误段优先保住）；输出预算 5120 tokens；最低可用推理强度；落在链首的模型；链解析带 6 小时指纹缓存 |
| 每次闲置会话的记忆提取 | 最多 1 次调用 | 闲置 5 分钟；收件箱满即停；输出预算 3072 tokens；与技能腿同一套熔断 |
| 每天一次的 Dream | 最多 1 次调用 | 24 小时闸门；收件箱空则跳过；输出预算 8192 tokens；格式不合即整体丢弃、收件箱原样留待下轮 |
| 未达标的会话 | 0 | 先算统计再调用 |
| 进化流程（手动） | 深度 | 只在你触发时发生；`brief` 一次探测给出路线；快速通道预算 4 次往返以内，常规路线 10 次以内 |

采集会随会话增长而增量进行：同一会话只分析游标之后的新内容，被节流或被后端故障挡下的只会延迟，不会丢失（连续失败 `SE_MAX_COLLECT_RETRIES` 次才放弃该窗口并留痕）。

## 安全与隐私

- **候选隔离**：采集器输出永不直接生效。启用必须经 `enable` 动作，动作会把裁决写进候选 `meta.md`、留档到 `archived/`、再让候选出队。
- **隐私熔断**：工具调用触及隐私路径模式（`diary`、`.env`、密钥、凭证、钱包等 25 项通用词表，`SE_PRIVATE_PATTERNS` 只做追加）时整场跳过采集，内容不外发。只判行动证据，用户与助手正文不进判定，因此 `process.env` 这类写法不再误杀。检查针对整段窗口而不是截断后的摘要，`force` 也不绕过。
- **凭据熔断**：正文或工具参数出现高置信密钥形态时整场跳过；其余情况下的外发前掩码会把 `sk-`、`ghp_`、JWT、`Authorization:` 整行、`password=…`、私钥块与邮箱替换为 `[已隐去:标签]`，家目录归一为 `~`。
- **自我管理熔断**：正在执行进化流程的会话不自我沉淀，避免系统给自己付账；触发词只在 ≤30 字的短指令里生效，长消息顺带提一句不会关掉整场采集。
- **分层隔离**：技能候选是唯一会改变运行环境的东西，且必须经人工启用；画像文章只进上下文、不改规则。
- **身份信息边界**：画像文章允许写入身份与背景（用户裁定），但技能与候选里禁止任何可识别身份的信息。
- **无删除权**：归档与淘汰都只是移出模型可见范围，源文件保留，`usage.json` 计数延续，`finish` 在数据根属于 git 仓库时提交留痕。
- **不碰用户主导文件**：不修改 `AGENTS.md`、人格文件或 DSH 配置。

## 已知局限与未验证项

- **运行时接线部分验证。** 首次安装暴露了一个真实缺陷：`apply()` 里读 `ctx.llm` 触发了 Cordis 的 `cannot get property "llm" without inject`，整个插件未激活。原因是 Cordis 的服务访问器对未 `inject` 的服务直接抛错。现在所有可选服务都通过 `ctx.get()` 惰性读取，且每个可选组件的注册都带局部容错：一个组件失败只降级它自己，不再拖垮整个插件。真机已确认的是：插件激活、技能 provider 生效（技能目录出现 `self-evolve`）、投影折出轨迹并写出 `state.json`、自我管理熔断按预期跳过本插件自身的施工会话。仍未经真实运行验证的是：`sessionQuery.readSession()` 的实际返回形状（清扫据此折叠历史会话）、工具 schema 被注册表接受的全部动作。`conversation.composer.dock` 槽位那条已随状态条一并删除：浏览器半边现在不注册任何界面，无需再核对槽位落位。
- **`file:` 安装是复制而非软链。** 桌面应用安装时把包复制进 `$DSH_PROFILE_DIR/node_modules/`（硬链接到 pnpm store）。改了仓库之后必须重装，或同步那一份副本，并重启 `dsh web` 才会加载新代码。
- **状态条已删除。** 原先落在 `conversation.composer.dock` 的那行状态（候选 / 收件箱 / 技能数 / 上次 Dream 与上次进化时间）按用户要求移除，`client.js` 的 `apply()` 现在什么都不注册。要完整页面时再挑一个真正分配了空间的槽位重新实现，而不是复活这行。
- **采集模型排序只是代理指标。** DSH 不给价格元数据，`auto` 按上下文窗口排序；真正在意成本就钉扎 `collector.models`。
- **结果归因是启发式的。** 失败/成功信号来自轨迹中的错误与用户措辞，可能误判；体检报告明确要求回查原始轨迹后再决定处置。
- **轨迹保留上限 600 条记录。** 投影保留有界尾部；所有轮次都会推进游标，所以正常使用下不会丢，但一次极长的未采集空档只会分析保留区间。
- **截断判定靠 usage。** DSH 的流只报 `stop` / `error` / `aborted`，没有 `length`；本移植改用 usage 里的输出 token 数判断「是否用满预算」，用满即按可疑截断整份丢弃。这比原型的 `stopReason=length` 保守，代价是偶尔丢弃一份其实完整的输出。
- **画像文章是常驻注入。** 它按天重写，每次重写都会让运行时上下文快照变化一次；这是设计如此，不是缺陷。文章上限 3000 字符，超限由 `parseArticle` 直接拒绝整份输出。
- **清扫依赖宿主的会话查询服务。** `sessionQuery` 未挂载时清扫退化为跳过（日志留一行），记忆腿仍然只覆盖当前会话。
- **`skill-filesystem` 同名技能。** 若 `~/.dsh/skills` 或 `~/.agents/skills` 已有同名技能，注册表按层内 rank 与注册顺序决定谁生效；`brief` 会把同名冲突列出来提醒你。
- **工具常驻成本。** `evolve` 只有一个 schema，但它始终在模型可见工具集里。

## 许可

MIT。设计与数据格式来自 agent-self-evolution（MIT），版权与致谢保留。
