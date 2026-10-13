# dsh-codex-sidebar

把 DeepSeek Harness 的 Web UI 换装成 Codex 桌面端外观的客户端插件。它是
`dsh-codex-theme` 的浏览器半边，只做呈现，不改变任何发给模型的内容，也不碰工具执行逻辑。

## 它做什么

- **侧栏「插件」行** —— 注册在壳层的 `sidebar.panellist`（新会话正下方）。点击后直达设置里的
  「插件」分区：设置面板的分区状态是组件私有 state，没有对外 API，因此在捕获阶段拦截该行的
  点击事件并代为导航。图标大小、缩进、亮度与新会话行一致。
- **轮换标语** —— 空态大标题的固定文案换成一组轮换句，每回到空态换一句；「预览版」徽章不受影响。

标语列表在 `lib/client.js` 的 `TAGLINES` 数组里，可自行增删。

## 零构建

宿主半边 `lib/index.js` 的 `apply` 是空的，只给 Loader 一个宿主行；浏览器半边走
`exports["./client"]`，用 Loader 自己的 bundle 格式手写（`window.__ModuleLoader__.load`），
没有 TypeScript，也没有打包器。

元素必须经 `react/jsx-runtime` 构造：裸的 `{ type, props }` 字面量不是 React 元素，React 会以
压缩后的 #31 错误拒绝它。

## 安装

本包是一个 DSH bundle，作为客户端插件按包名解析，浏览器半边只认裸包名：

```json
{
  "dependencies": {
    "dsh-codex-sidebar": "github:Alamanes/applesdsh-dev#path:plugins/dsh-codex-sidebar"
  },
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-codex-sidebar"]
    }
  }
}
```

装好后重启 `dsh web` 并刷新页面。

## 锚点依赖

改动依赖当前版本的结构选择器与槽位名（`sidebar.panellist`、`[data-slot="sidebar.settings"]`、
`titleGroup`、`previewBadge`）。上游若改结构与类名，改这里的对应常量即可。
