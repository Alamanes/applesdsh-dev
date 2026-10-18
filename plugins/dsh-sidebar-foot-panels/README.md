# dsh-sidebar-foot-panels

DeepSeek Harness 的浏览器半只插件：把左侧栏顶部的两个全局面板行「插件」与「自动化任务」从面板列表里摘出来，改成侧栏底部并排的两个小图标按钮。

## 用途

官方 ui-sidebar 把全局面板画成一列行（`nav.panelList`，每行是图标加文字），排在「新会话」按钮与会话列表之间。本机只装了两个全局面板，这两行于是长期占住侧栏顶部：

- 宽态下它们各占 36px 高的一整行，加上列表容器的上下间距，会话列表被整体下压；
- 窄态（56px 轨道）下它们仍是两枚 36px 的图标，与「新会话」按钮争同一块空间。

本插件把这两个入口挪到侧栏底部：与会话列表解耦，两个 28px（窄态 36px）的图标按钮排在设置行上方，省下的纵向空间全部留给会话列表。

## 开关方式

插件以一行 loader 声明启用。安装到 profile 后，在 `~/.dsh/profiles/desktop/cordis.patch.yml` 里加入：

```yaml
- insert:
    - id: dsh-sidebar-foot-panels
      name: dsh-sidebar-foot-panels
```

同一行也写在插件自带的 `cordis.patch.yml` 里（`package.json` 的 `dsh.bundle.patch` 指向它），插件页安装时会直接插入。删掉这一行即关闭整个插件：底部两个按钮消失，官方两行原样回到面板列表，没有残留标记。没有配置项。

## 它做了什么

浏览器半只在 `lib/client.js`，宿主半 `lib/index.js` 是空实现（只为 Loader 提供一个宿主行、并让 `exports["./client"]` 指向浏览器包）。

按钮一侧：

- 注册一个 `sidebar.footer.action` 槽位条目（id `foot-panels`，order 10）。这个槽是 ui-sidebar 自己声明的「侧栏底部、设置旁边的可选动作」，位置就在设置行上方，由侧栏渲染，因此自动拿到列状态 `wide`（宽态行 / 窄态 56px 轨道）与官方底部的对齐规则。
- 点击调用 `ctx.layout.selectPanel(id)`，与官方面板行走的是同一个控制器调用，面板切换、选中状态持久化、待处理导航的中断行为都不变；高亮状态读 `ctx.layout.panelInfo`，与官方行写 `aria-current` 的是同一份数据。
- 按钮列表来自 `sidebar.panellist` 台账：面板插件被停用时，对应按钮一并消失，不会留下点不动的入口。

列表一侧：

- 官方两行仍由 React 渲染在原处，插件只给它们打上 `data-dsh-foot-panels-hidden` 属性并让样式表把带该属性的元素移出布局；两行都归本插件时，列表容器本身也打上同一属性，避免它的下边距留成空白。
- 行位置由 `ctx.slots.entriesOfSlot('sidebar.panellist')` 按 `order` 排序算出（与 ui-sidebar 生成列表的顺序一致），因此隐藏的是行、不是「第一个和第二个按钮」：以后再有第三方注册全局面板，它排在列表里不会被误伤。
- React 在结构变化时会重建行，标记由一个按帧节流的 MutationObserver 重新补上。写入的只有 React 不渲染的属性，`className`、`aria-label`、`aria-current` 与点击处理仍是官方值。

样式表只做两件事：隐藏带标记的元素，以及给底部按钮抄官方的 `iconButton` 几何（宽高、圆角、hover 与 focus-visible 均用 `--dsw-*` 令牌）。

## 已知边界

- **依赖 ui-sidebar 的类名后缀与槽位名**：`nav` 的 CSS module 类名以 `panelList` 结尾（选择器写 `nav[class*="panelList"]`），槽位名是 `sidebar.panellist` 与 `sidebar.footer.action`。dsh 升级后若两个按钮失效或列表不再被隐藏，先复核这三处。
- **面板 id 是硬编码的**：`plugins` 与 `schedules` 分别是 client-ui-plugin-manager 与 client-ui-schedule 的 `PANEL_ID`，两个包都不导出它们。dsh 若改名，需要同步 `PANEL` 表。
- **图标是照抄的**：两个图标按官方注册的 `IconPluginPinwheelOutlineRegular` 与 `IconClockOutlineRegular` 内联（视图盒 16×16、`strokeWidth: 1`、`currentColor`），因为 primitives 的图标组件没有稳定导出面。官方换图标时这里不会自动跟随。
- **隐藏而非注销**：官方两行仍在 DOM 里（`display: none`），键盘 Tab 顺序里也不出现。插件卸载时会清掉全部标记，官方行立刻回来。
- **本插件不碰第三方面板**：只处理上面两个 id，其它注册进 `sidebar.panellist` 的条目无论排在哪里都保持原样。
- **需要重启宿主**：客户端插件的 boot graph 在宿主启动时构建，装好本插件后必须重启 DeepSeek Harness，新会话与旧会话都会看到新排布。

## 文件

| 文件 | 作用 |
| --- | --- |
| `package.json` | 包声明。`exports["./client"]` 是浏览器包入口，`dsh.bundle.patch` 指向补丁，`dsh.client` 声明 `platform: web` 与 `inject: ["@deepseek-ai/dsh-client-ui-sidebar"]` |
| `lib/index.js` | 宿主半只：`name` 与空 `apply`，无依赖 |
| `lib/client.js` | 浏览器半只：全部逻辑，`window.__ModuleLoader__.load({ id: 'dsh-sidebar-foot-panels', factory })` 注册 |
| `cordis.patch.yml` | loader 行声明，供 profile 引用 |
| `README.md` | 本文件 |

## 依赖关系

- `dsh.client.inject: ["@deepseek-ai/dsh-client-ui-sidebar"]`：boot graph 层面的包到达顺序声明，让 ui-sidebar 的浏览器包先注册；不是 cordis 服务注入。
- 服务依赖写在浏览器包自己的 `exports.inject = ['slots', 'layout', 'locale']`（cordis fiber inject），apply 在这三个服务可用后才执行。
- `factory` 只 `require` 两个运行时提供的模块：`react` 与 `@deepseek-ai/dsh-client-ui-primitives`（后者只取可选的 `Tooltip`，取不到就退回按钮自身的 `title`）。没有第三方依赖。
