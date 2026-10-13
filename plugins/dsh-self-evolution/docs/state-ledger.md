# 账目与熔断：state.json / usage.json 字段语义

本文只做一件事：把**只存在于代码里**的账目字段、计数口径、熔断条件与阈值写下来，供操作者查证。

代码即事实。本文若与代码冲突，以 `lib/` 为准。

---

## 1. state.json 字段

写入者代号：**采集器** = `lib/collector.js` 与 `lib/dream.js`（插件进程内），**收尾** = `evolve` 工具的 `finish` 动作。

| 键 | 语义 | 写者 | 读者 |
|---|---|---|---|
| `createdAt` | 系统创建时间（首次激活时写入） | 激活 | 展示 |
| `lastSeenAt` | 每次收尾时的心跳时间戳 | 采集器 | 人工排查 |
| `lastCollectionAt` | 最近一次技能腿采集结束时间 | 采集器 | 节流判断（默认关闭） |
| `lastDreamAt` | 最近一次 Dream 合并完成时间，距此达到 `SE_DREAM_INTERVAL_MS` 才再合并 | 采集器 | 采集器、`brief` |
| `lastEvolutionAt` / `lastEvolution` | 最近一次进化完成时间与明细快照 | 收尾 | `brief` 两处都打印 |
| `stats` | 见第 3 节 | 两者按字段分别写 | `brief`、报告模板 |
| `rejections[]` | 最近 20 条拒绝/失败原因 | 采集器与收尾，上限统一 20 | 人工查看 |
| `collectedUpTo{会话: 序号}` | **技能腿**增量水位 | 采集器 | 采集器 |
| `profileUpTo{会话: 序号}` | **记忆腿**独立水位（键名沿用原系统的 `profileUpTo`）。两腿分账，技能腿成功不再作废记忆腿失败的窗口 | 采集器 | 采集器 |
| `sessionRejections{会话: {at, reason}}` | 同会话历史判定，注入下轮提示词抑制「先拒后生」抖动 | 采集器 | 采集器 |
| `collectFailures{会话: 次数}` | 技能腿连续采集失败计数，达 `SE_MAX_COLLECT_RETRIES` 才放弃该窗口 | 采集器 | 采集器 |
| `profileFailures{会话: 次数}` | 记忆腿同上的独立账户 | 采集器 | 采集器 |
| `dreamFailures` | Dream 连续失败计数，成功一次即清零 | 采集器 | 采集器 |
| `skipMarks{会话: 序号}` | 采集侧「不值得沉淀」的按水位去重标记 | 采集器 | 采集器 |
| `breakerLogged{会话: 熔断类型}` | 熔断日志去重标记。**调用方必须在本字段落盘之后再写盘**，否则标记丢失、去重失效 | 采集器 | 采集器 |
| `collectorChain` / `collectorChainKey` / `collectorChainAt` / `collectorChainNote` | 采集模型链解析结果与指纹缓存（6 小时） | 采集器 | 采集器、`evolve action="models"` |
| `collectorUnavailable` / `collectorUnavailableReason` | 链全不可用标记与原因 | 采集器 | `brief`、`status` |

**写盘纪律**：每一次写入都先读盘最新值再合并。`stats` 里的数值计数按「本值 − 载入时的快照值」叠加到盘上最新值（`skillsEnabled` 例外，它是按磁盘实际数量设定的绝对值），非本系统持有的键原样保留，内存中 `delete` 掉的持有键不会被盘值复活。这样两个进程（桌面应用与会话 CLI）同时采集时不会互相覆盖增量。

---

## 2. usage.json 字段

写入者：`lib/usage.js`（技能使用归因）。

| 键 | 语义 |
|---|---|
| `updatedAt` | 最后更新时间 |
| `skills{slug: 条目}` | 单技能使用画像 |
| 条目的 `count` | **真读次数**：技能文件路径在轨迹里出现过 |
| 条目的 `mentions` | **弱提及次数**：名字出现在用户消息或工具参数里，但从未真读。不计入 `count`、不刷新 `lastUsedAt` |
| 条目的 `lastUsedAt` | 最后一次真读时间 |
| 条目的 `lastSession` | 最后命中的会话，同会话去重用 |
| 条目的 `signal` | `strong`（真读）/ `weak`。保强不降级 |
| 条目的 `outcomes{success,failure,unknown}` | 仅强信号技能做结果归因 |
| 条目的 `failReasons[]` | 最近 3 条失败原因片段 |
| 条目的 `aliases[]` | 合并溯源，`candidate-review.md` 要求保留 |
| 条目的 `recencyUnreliable` | 标记 `lastUsedAt` 不可信，记分卡据此降级 |
| 条目的 `repaid[]` / `falseFailureClearedAt` | 清零假失败时留下的人工审计痕迹 |

条目更新用 `{...prev}` 继承，**不得改为白名单重建**：上面这些人工维护字段会在该技能每次被命中时被静默丢掉。

记分卡会读取 `mentions`：闲置/沉睡/未观测行会打印「另有 N 次弱提及」，让「提得多但从未真读」与「完全没人提」在归档判定时能被区分。

---

## 3. 计数口径

采集侧计数与人工审查计数**分开**，不可混算：

| 计数器 | 含义 | 写者 |
|---|---|---|
| `sessionsAnalyzed` | **采集轮次**，不是会话数：同一会话增量采集多次会被多次 +1 | 采集器 |
| `collectorSkips` | 采集侧判定「不值得沉淀」，按水位去重 | 采集器 |
| `collectFailures` | 技能腿采集失败（LLM/网络），与拒绝分开 | 采集器 |
| `candidatesCreated` | 生成的候选数 | 采集器 |
| `memoryExtracts` / `memoryFailed` / `memoryRejected` | 记忆提取三态：写入收件箱 / 失败（可重试）/ 格式拒绝 | 采集器 |
| `dreams` / `dreamsFailed` / `memoryConsumed` | Dream 成功次数 / 失败次数 / 已消费的提取份数 | 采集器 |
| `candidatesRejected` | **人工审查淘汰**数，由收尾并入 | 收尾 |
| `skillsEnabled` / `skillsUpdated` / `skillsRepaired` / `candidatesMerged` | 技能侧处置计数 | 收尾 |
| `evolutions` | 进化轮次 | 收尾 |

---

## 4. 熔断条件

三类熔断都会让**整场会话不采集**（技能腿与记忆腿同时跳过），并把该腿的水位推进到末尾。日志按 `(会话, 类型)` 去重。

| 熔断 | 触发条件 |
|---|---|
| 自我管理会话 | ① 用户消息**不超过 30 字**且含触发词（进化、自我进化、技能候选、沉淀技能、进化一下、审查候选、技能体检、总结一天）；或 ② 工具调用参数中的**文件路径**命中自管理标记：`dsh-self-evolution`、`self-evolution`、`evolution/candidates`、`evolution/skills`、`evolution/memory`、`/evolution/`、`state.json`、`usage.json`、`experience-log`、`memory/PROFILE.md`、`memory/inbox` |
| 私密路径 | 工具调用的文件路径命中隐私词表（25 项，见第 5 节）。只判行动证据，用户与助手正文一律不进判定 |
| 凭据形态 | 用户正文、工具结果或工具参数中出现可辨识的密钥形态（`sk-`、`sk-ant-`、`ghp_` 系列、`github_pat_`、`AKIA/ASIA`、`xox[baprs]-`、`AIza`、`BEGIN … PRIVATE KEY`） |

长消息顺带提到「进化」**不会**熔断整场（30 字限制），只有短指令才按触发词判定；`.env` 这类点号模式只与路径片段全等匹配，`process.env` 不再误杀。

`force`（手动 `collect` / `dream`）只绕过自我管理熔断与闲置闸门；私密路径与凭据熔断**无条件生效**。

---

## 5. 阈值与限值

| 项 | 值 | 环境变量 / 出处 |
|---|---|---|
| 技能腿触发 | 工具调用 ≥5 或出现错误 | `SE_MIN_TOOL_CALLS` |
| 记忆腿触发 | 会话闲置 ≥5 分钟，且水位之后有用户发言 | `SE_MEMORY_IDLE_MS` |
| 采集失败重试上限 | 3 次后放弃该窗口（两腿各自计） | `SE_MAX_COLLECT_RETRIES` |
| 候选区上限 | 20，满则暂停采集并提示先审查 | `SE_MAX_CANDIDATES` |
| 记忆收件箱上限 | 20 份，满则暂停提取并提示先跑 Dream | `SE_MAX_EXTRACTS` |
| 逐会话提取长度 | ≤600 字符，每条以「- 」开头 | `MAX_EXTRACT_CHARS` |
| 画像文章长度 | ≤3000 字符，散文段落 + 两级章节，首节固定为「概览」 | `MAX_ARTICLE_CHARS` |
| 文章文体 | 第二人称「你」、不用清单、不用表情符号，由 `parseArticle` 机械强验 | `ARTICLE_LEAD_SECTION` |
| 注入框定 | 注入内容 = 固定前言 + **降人称后的正文**；正文保持第二人称给人读，注入前过 `toThirdPerson` 转第三人称 | `INJECTION_HEADER` / `toThirdPerson` |
| Dream 间隔 | 距上次合并 24 小时 | `SE_DREAM_INTERVAL_MS` |
| 草稿输出预算 | 技能 5120 / 逐会话提取 3072 / Dream 8192 token | `SE_MAX_OUTPUT_TOKENS`、`SE_MAX_EXTRACT_OUTPUT_TOKENS`、`SE_MAX_ARTICLE_OUTPUT_TOKENS` |
| 截断判定 | 通道不报告 length，改由 usage 输出 token 数判断：用满预算即视为可能截断并丢弃 | `lib/llm.js` |
| 技能草稿长度 | ≤8000 字符 | `SE_MAX_SKILL_CHARS` |
| 轨迹摘要上限 | 2500 字符 | `SE_MAX_TRACE_CHARS` |
| 摘要分段预算 | 用户 700 / 操作 800 / 错误 900，各段先各自限额，保证错误段不被整段截掉 | `TRACE_SEGMENT_BUDGET` |
| 触发词生效长度 | ≤30 字 | `TRIGGER_MAX_LEN` |
| 采集模型链 | 钉扎优先 → 按上下文窗口升序（价格无元数据，窗口作代理）→ 会话当前模型兜底；链长 3；指纹缓存 6 小时 | `config.json` + `lib/llm.js` |
| 清扫 | 单轮最多补 3 个会话，只回补最近 7 天，冷却 10 分钟，悬挂锁 30 分钟可接管 | `SE_SWEEP`、`SE_SWEEP_MAX`、`SE_SWEEP_BACKFILL_MS`、`SE_SWEEP_COOLDOWN_MS`、`SE_SWEEP_LOCK_STALE_MS` |
| 计分卡闲置 | 15 天未用且累计 <10 次；高产技能 30 天；满 30 天一律归档候选 | `lib/health.js` |
| 归档日志 | 超 100 行时保留前言与最近 40 行，其余按月份归档 | `lib/store.js` |

---

## 6. 外发前的脱敏

轨迹摘要发给第三方采集模型之前，依次做两件事：

1. **掩码**：`sk-`/`sk-ant-`/`ghp_` 系列/`github_pat_`/`AKIA`/`xox[baprs]-`/`AIza`/JWT/`Bearer`/`Authorization:` 整行/`password=…`（值 ≥6 字符）/`BEGIN…PRIVATE KEY`/邮箱 → `[已隐去:标签]`。
2. **家目录归一**：家目录绝对路径 → `~`。

掩码对技能候选草稿同样生效，落盘前替换并把命中数写进经验日志。

高置信凭据形态在掩码之外还会直接触发整场熔断（宁可误杀不可外发）。

`SE_PRIVATE_PATTERNS` 是**追加**语义：内置 25 项永远保留，env 只做补充。支持 `*.key` 这类后缀模式与 `.env` 这类点号模式。

---

## 7. 刻意不做的

| 项 | 原因 |
|---|---|
| `state.json` / `usage.json` 不纳入 git | 两者每个回合都会变，是刻意的动态文件。为拿到回滚能力，收尾时会把快照写入 `logs/archive/ledger-backup/`，随提交进 git，不产生每回合噪音 |
| `memory/` 不纳入 git | 记忆由采集器自动生成，每次提取与 Dream 都会变动，与 `state.json` 同理；可追溯性由 `memory/archive/` 的按月归档保证，不靠 git |
| 归档目录不自动清理 | 处置权在用户，插件只报告数量与体积 |
| 技能永不删除 | 只有归档与恢复；淘汰只针对候选，且留档在 `archived/` |
