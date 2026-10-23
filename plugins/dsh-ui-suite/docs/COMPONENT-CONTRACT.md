# 组件迁移规范

套件把原先各自独立的 UI 插件收进 `dsh-ui-copy` 一个包。一个包只能有一个浏览器入口（`dsh-client-modules` 只解析 `exports["./client"]`），所以每个插件的浏览器半边变成 `src/components/` 下的一个顶层函数，由 `scripts/build.mjs` 拼进 `lib/client.js`。

## 文件命名

`src/components/<两位数字>-<key>.js`，前缀只决定挂载顺序。`<key>` 必须等于 `lib/index.js` 里 `SWITCH_OF` 的字段名去掉其数字前缀后的名字，并用连字符分隔：

| 文件 | key | 宿主配置字段 |
| --- | --- | --- |
| `10-copy.js` | `copy` | `copy` |
| `20-identity.js` | `identity` | `identity` |
| `30-session-delete.js` | `session-delete` | `sessionDelete` |
| … | … | 见 `lib/index.js` |

## 组件形状

整个文件只有一个顶层函数，签名固定：

```js
function dshuiComponent_<key下划线化>(rt) {
  // 全部逻辑
}
```

- 不允许 `import` / `export`，产物是 classic script。
- 不允许 `window.__ModuleLoader__.load`，套件的入口已在外层。
- 不允许新建 `MutationObserver`，用 `rt.observe`。
- 不允许直接往 `document.head` 插 `<style>`，用 `rt.style`。

## rt 接口

| 成员 | 说明 |
| --- | --- |
| `rt.ctx` | 浏览器 root context，等于原 `apply(ctx)` 的 `ctx` |
| `rt.config` | 本组件的配置块（宿主注入），含 `enabled` 与自定义字段 |
| `rt.option(name, fallback)` | 读 `rt.config[name]` |
| `rt.suite` | 整套配置（bundle 注入的原始对象）；本组件的块请用 `rt.config` |
| `rt.require(name)` | 外部包；**加载不到返回 `null`，不抛错**。必须判空 |
| `rt.effect(fn, label)` | 包一层 `ctx.effect`，失败被隔离 |
| `rt.observe(fn)` | 注册一次 DOM 全量扫描；返回取消函数。所有组件共用一个 MutationObserver 和同一帧 |
| `rt.schedule()` | 请求下一帧扫一遍 |
| `rt.style(id, css)` | 按组件作用域注入/替换样式表，返回移除函数 |
| `rt.token(name, fallback)` | 读 `--dshui-*` 的计算值（少用，优先写 CSS 变量） |
| `rt.theme()` | `'light'` / `'dark'` |
| `rt.component(key)` | 另一个组件的 `{ enabled, options }` |
| `rt.log/warn/error` | 带前缀的日志 |

## 转换步骤

原文件通常是：

```js
window.__ModuleLoader__.load({
  id: 'x',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    ...
    const React = require('react')
    ...
    function apply(ctx) { ... }
    exports.apply = apply
    exports.inject = ['slots', 'locale']
    return module.exports
  },
})
```

改成：

```js
/**
 * 组件用途（保留原注释里解释“为什么这样做”的部分，删掉解释 loader 与
 * 独立包的部分）。
 */
function dshuiComponent_x(rt) {
  const React = rt.require('react')
  if (React === null) {
    rt.warn('react is not in this boot graph; component skipped')
    return
  }
  const h = React.createElement
  ...
  // 原 apply(ctx) 的正文，ctx 取 rt.ctx
  install(rt.ctx)
}
```

具体改动：

1. **删掉 loader 外壳**，把 factory 体内的声明原样搬进函数体。
2. **`require(...)` → `rt.require(...)`**。逐个判空；拿不到就 `rt.warn` 并 return，不要抛。
3. **`exports.apply(ctx)` → 末尾直接调用** `install(rt.ctx)` 或把原函数改名后调用。
4. **`exports.inject` / `inject` 数组** 删除：服务等待改由各组件自己的 `ctx.inject([...], cb)` 完成；服务不存在时该回调不运行，行为与原 loader 一致。
5. **自建样式**：`ctx.effect(() => { const style = ...; document.head.appendChild(style); return () => style.remove() })` 改成 `rt.style('<名字>', css)`。若样式来自 `ctx` 提供的字符串，同样走 `rt.style`。
6. **自建观察器**：`const io = new MutationObserver(fn); io.observe(document.body, ...)` 改成 `rt.observe(fn)`；原代码里的 rAF 节流逻辑一并删除（套件已经节流）。
7. **宿主 config**：原插件可能通过 `ctx.configForms.get(id)` 读配置。保留这段逻辑，但初值优先取 `rt.config`（宿主注入），config form 存在时以 form 为实时来源。
8. **`ctx.effect` 保留**，但用 `rt.effect(fn, 'ui-copy/<key>: <说明>')`。

## 视觉令牌

所有视觉值必须来自 `lib/styles/tokens.css` 的 `--dshui-*` 令牌，禁止写死颜色、圆角、间距、字号、时长、阴影。旧插件里大量写 `--dsw-*` 的地方，**改成 `--dshui-*` 的语义角色**，因为令牌层已经把 `--dsw-*` 映射进来了。

映射表（常见值）：

| 旧 | 新 |
| --- | --- |
| `var(--dsw-alias-label-primary)` | `var(--dshui-text-primary)` |
| `var(--dsw-alias-label-secondary)` | `var(--dshui-text-secondary)` |
| `var(--dsw-alias-label-tertiary)` | `var(--dshui-text-tertiary)` |
| `var(--dsw-alias-label-caption)` | `var(--dshui-text-caption)` |
| `var(--dsw-alias-label-dimmed)` | `var(--dshui-text-dimmed)` |
| `var(--dsw-alias-bg-base)` | `var(--dshui-surface-base)` |
| `var(--dsw-alias-bg-layer-1/2/3)` | `var(--dshui-surface-1/2/3)` |
| `var(--dsw-alias-border-l1..l4)` | `var(--dshui-border-1..4)` |
| `var(--dsw-alias-interactive-bg-hover)` | `var(--dshui-surface-hover)` |
| `var(--dsw-alias-interactive-selected)` | `var(--dshui-surface-selected)` |
| `var(--dsw-alias-brand-primary)` | `var(--dshui-brand)` |
| `var(--dsw-alias-link)` | `var(--dshui-link)` |
| `var(--dsw-alias-state-business-primary)` | `var(--dshui-business)` |
| `var(--dsw-alias-state-error-primary)` | `var(--dshui-danger)` |
| `var(--dsw-alias-state-warn-primary)` | `var(--dshui-warn)` |
| `var(--dsw-specific-sidebar-fill)` | `var(--dshui-surface-sidebar)` |
| `var(--dsw-specific-menu)` | `var(--dshui-surface-menu)` |
| `var(--dsw-elevation-panel)` | `var(--dshui-shadow-panel)` |
| `var(--dsw-focus-ring-color)` | `var(--dshui-border-focus)` |
| `var(--dsw-font-family)` | `var(--dshui-font-family)` |
| `var(--dsw-radius-sm/md/lg/xl)` | `var(--dshui-radius-sm/md/lg/xl)` |

其它硬编码值：

| 旧 | 新 |
| --- | --- |
| `4px` / `6px` 圆角 | `var(--dshui-radius-xs)` / `var(--dshui-radius-sm)` |
| `8px` 圆角 | `var(--dshui-radius-sm)` |
| `12px` 圆角 | `var(--dshui-radius-md)` |
| `16px` 圆角 | `var(--dshui-radius-lg)` |
| `22px` / `24px` 圆角 | `var(--dshui-radius-xl)` / `var(--dshui-radius-2xl)` |
| `999px` / `50%` | `var(--dshui-radius-pill)` / `var(--dshui-radius-circle)` |
| `2/4/6/8/12/16/24/32px` 间距 | `var(--dshui-space-1..8)` |
| `11/12/13/14/15/17px` 字号 | `var(--dshui-text-size-xs/sm/md/base/lg/xl)` |
| `1.3/1.5/1.7` 行高 | `var(--dshui-line-tight/normal/loose)` |
| `400/500/600` 字重 | `var(--dshui-weight-regular/medium/semibold)` |
| `120ms/180ms/260ms` 时长 | `var(--dshui-duration-fast/base/slow)` |
| `cubic-bezier(...)` | `var(--dshui-ease-standard/enter/exit/spring)` |
| `0 1px 2px rgb(0 0 0/6%)` 等阴影 | `var(--dshui-shadow-1/2/3)` |

**例外**：结构和布局相关的数值（宽高、定位、`flex` 比例、`z-index` 的组件内局部层级）保持原值；令牌只管视觉语言。

## 纯 CSS 组件

`ask` / `composer` / `menu` / `sidebar` 没有浏览器 JS，只有 `lib/styles/<key>.css`。它们也做同样的令牌替换：文件里所有 `--dsw-*` 与硬编码视觉值改成 `--dshui-*` 与对应令牌，保留每条规则原有的作用域锚点。

## 交付检查

- `node --check src/components/<file>.js` 通过（产物是 classic script，`node --check` 可直接校验）。
- 文件里没有 `import` / `export` / `__ModuleLoader__.load` / `new MutationObserver` / `document.head.appendChild`。
- 每个 `rt.require(...)` 的结果都判空。
- 没有遗留 `--dsw-` 前缀（`tokens.css` 除外）。
- 业务逻辑（slot 名、路由、id、文案表、时序）一字不改。
