# dsh-web-search-tavily

给 DeepSeek Harness 的 `ctx.web` 接缝加一个 **Tavily** 搜索后端。

## 为什么需要它

随附的 `@deepseek-ai/dsh-web-search-deepseek` 只有一种实现：调一次 Anthropic 兼容的
Messages API，用原生 `web_search_20250305` 服务端工具。它把配置的 `baseURL` 直接拼成
`${baseURL}/messages`，所以**无法**指向 Tavily —— 那是另一套 REST 契约，任何
`https://api.tavily.com/...` 地址都只会得到 404。`dsh-web` 的 README 也把
Firecrawl/Tavily 风格的后端明确列为延期工作。

本插件注册第二个、互相独立的后端（id `tavily`），直接说 Tavily 的
`POST /search`。

## 它做什么

| 接缝概念 | Tavily 对应 |
|---|---|
| `request.query` | `query` |
| `request.maxResults` | `max_results`（夹到 1–20；接缝随后仍会自行截断） |
| `sources[].url` | `results[].url` |
| `sources[].title` | `results[].title` |
| `sources[].snippet` | `results[].content` |
| `sources[].publishedAt` | `results[].published_date` |
| `content`（提供方答案） | `answer`，本插件请求时固定关闭 |

`truncated` 恒为 `false`：截断与置位都由接缝负责。结果按 `url` 去重。

## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `apiKeyEnv` | `TAVILY_API_KEY` | 凭据引用名，经 `ctx.credentials` 解析 |
| `apiKey` | — | 字面密钥；仅在没有凭据服务时使用，会明文留在配置里 |
| `endpoint` | `https://api.tavily.com/search` | 搜索端点 |
| `searchDepth` | `basic` | `basic` 一 credit，`advanced` 两 credit |

密钥的推荐放法是把 `TAVILY_API_KEY` 写进 `$DSH_HOME/.credentials.yaml` 的 `refs:` 段
（该文件被 chokidar 监听，写入即时生效），或在新进程环境里导出。

## 缺少密钥时的行为

`available()` 是接缝的廉价可用性探针，且**不能异步**，所以它报告的是「是否配置了凭据
通路」，而不是「密钥此刻能否解析」。密钥缺失或无效时，`search()` 会抛出带
`WEB_PROVIDER_CREDENTIAL_MISSING` / `WEB_PROVIDER_ERROR` 的具名错误，而不是让这个后端
悄悄变成不可用。

## 与自带后端共存

自带后端仍然注册且仍然 `available()`，因此**必须**把 `web.searchProvider` 钉到
`tavily`；否则接缝会同时看到两个可用搜索提供方，每次调用都以
`WEB_PROVIDER_AMBIGUOUS` 失败。这正是本包 patch 里第二条覆盖项的作用。
