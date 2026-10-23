# dsh-ui-copy

DeepSeek Harness 的界面套件。一个包、一个浏览器入口、一套设计令牌：原本散在十几个插件里的界面改写，现在全部是这里的组件，逐项可开关，视觉只从令牌取值。

## 为什么合成一个包

`@deepseek-ai/dsh-client-modules` 对每个包只解析一个浏览器入口（`exports["./client"]`），插件页的一行就对应一个包。以前每加一个界面插件，就多一个自建 `MutationObserver`、多一张自己注入的 `<style>`、多一份对 ship DOM 何时挂载的猜测；它们抢同一个 slot、重复覆盖同一批 `--dsw-*` 令牌，出问题时也难判断是谁改的。

合成一个包后：

- **一个观察器**：所有组件的 DOM 扫描注册进同一个 rAF 节流的 `MutationObserver`，一帧只扫一遍。
- **一次注入**：令牌与组件样式由宿主半边一次性写进 `<head>`，顺序固定，令牌永远在组件样式之前。
- **一处失败只死一个组件**：每个组件工厂跑在自己的 `try`/`catch` 里，宿主升级删掉某个 slot，或某个外部包不在 boot graph 里，只让那一个组件退场。
- **一处换肤**：所有组件读 `--dshui-*` 语义角色，主题就是覆盖这些角色。

## 目录

```
dsh-ui-copy/
├── cordis.patch.yml        一行 insert：id ui-copy
├── package.json            单包；dsh.client.inject 是所有组件依赖的并集
├── lib/
│   ├── index.js            宿主半边：Config 声明、配置穿针、样式与页面脚本注入
│   ├── client.js           浏览器半边：build 产物，勿手改
│   ├── host/<key>.js       需要宿主能力的组件（路由、工具、扫描）
│   ├── styles/tokens.css   设计令牌，唯一视觉真相
│   └── styles/<key>.css    各组件样式表
├── src/
│   ├── core/runtime.js     组件运行时：观察器、样式注册、开关、故障隔离
│   ├── core/entry.js       加载器外壳与组件注册表
│   └── components/*.js     组件源码，一个文件一个组件
└── scripts/
    ├── build.mjs           把 src 拼成 lib/client.js
    └── verify.mjs          契约自检
```

## 组件

一个组件就是 `src/components/<nn>-<key>.js` 里的一个顶层函数。`<nn>` 只决定挂载顺序。宿主配置里的字段名见括号。

| 组件 | 文件 | 职责 |
| --- | --- | --- |
| 文案改写（`copy`） | `10-copy.js` | 空态大标题轮换、输入框空置提示改写、预览版徽章隐藏、强调色设置行 |
| 本地身份（`identity`） | `20-identity.js` | 侧栏左下角的名字与头像换成本机配置 |
| 会话删除（`sessionDelete`） | `30-session-delete.js` | 会话行「…」菜单里的「删除会话」与确认弹窗 |
| 峰谷提示（`peakValley`） | `40-peak-valley.js` | 侧栏底栏的峰谷时段与切换倒计时 |
| 状态短语（`statusPhrases`） | `50-status-phrases.js` | 回合状态行的逐字彩虹短语 |
| 侧栏底栏按钮（`footPanels`） | `60-foot-panels.js` | 插件 / 使用统计 / 技能中心三个面板收成底部图标按钮 |
| 彻底重启（`restart`） | `70-restart.js` | 标题栏重启按钮与 `restart_dsh` 工具 |
| 配额仪表（`quota`） | `80-quota.js` | 模型选择器旁的三枚额度环 |
| 推理滑块（`effortSlider`） | `90-effort-slider.js` | Codex 风格的推理强度滑块 |
| 鲸鱼壁纸（`whale`） | `100-whale.js` | 粒子鲸鱼背景 |
| 技能中心（`skillExplorer`） | `110-skill-explorer.js` | 技能浏览与增删面板 |

另有四个纯样式组件，没有浏览器 JS，只由宿主半边注入样式表：`ask`（提问弹窗）、`composer`（输入卡片）、`menu`（菜单开合动画，配套 `lib/menu.page.js`）、`sidebar`（侧栏「新会话」按钮降噪）。

## 主题

`lib/styles/tokens.css` 定义全部语义角色，默认值映射到宿主自己的 `--dsw-*` 令牌，所以 DSH 主题一变，整套跟着变。角色分七族：

- **表面** `--dshui-surface-base` / `-1` / `-2` / `-3` / `-raised` / `-sunken` / `-hover` / `-selected` / `-pressed` / `-sidebar` / `-menu` / `-bubble`
- **描边** `--dshui-border-1` … `-4`、`--dshui-border-focus`、`--dshui-border-width`
- **文字** `--dshui-text-primary` / `-secondary` / `-tertiary` / `-caption` / `-dimmed` / `-link` / `-on-brand`
- **品牌与状态** `--dshui-brand`、`-brand-fill`、`-brand-hover`、`-brand-ink`、`-link`、`-business`、`-danger`、`-warn`、`-success`
- **圆角** `--dshui-radius-xs` … `-2xl`、`-pill`、`-circle`
- **间距** `--dshui-space-0` … `-9`
- **字体** `--dshui-font-family` / `-mono`、`--dshui-text-size-xs` … `-2xl`、`--dshui-line-tight` / `-normal` / `-loose`、`--dshui-weight-*`、`--dshui-tracking-*`
- **动效** `--dshui-duration-instant` … `-slower`、`--dshui-ease-*`
- **高度与层级** `--dshui-shadow-1` … `-3`、`-shadow-panel`、`-ring`、`--dshui-z-*`

换肤只改 profile 里 `ui-copy` 这一行，不用碰任何组件：

```yaml
- id: ui-copy
  name: dsh-ui-copy
  config:
    theme:
      light:
        brand: '#7c4dff'
        surface-2: '#f6f4ff'
        radius-md: '14px'
      dark:
        brand: '#b79cff'
        surface-2: '#221d33'
    accent:
      light: '#7c4dff'
      dark: '#b79cff'
```

`theme.light` / `theme.dark` 接受任意 `--dshui-*` 角色名（可写 `brand`，也可写 `--dshui-brand`），宿主半边把它们渲染成两段覆盖块接在令牌层之后。`accent` 是强调色对，同时写 `--dshui-*` 与宿主自己的 `--dsw-*` 令牌，所以自绘组件和原生按钮会一起变色；留空表示完全跟随官方配色。

## 开关

每个组件在自己的配置块里认 `enabled`，默认 `true`。关掉一个组件等于：不挂载它的浏览器代码、不注入它的样式表、不执行它的宿主半边。

```yaml
- id: ui-copy
  name: dsh-ui-copy
  config:
    whale:
      enabled: false
    quota:
      brightness: 0.9
    statusPhrases:
      phrases: |-
        宣读卡巴拉誓言中...
        在中央数据库里翻页中...
```

设置页写入的字段（如 `accent` 与各组件自己的文本域）标了 `volatile`，可以由页面实时编辑；其余字段写在 profile 里，刷新页面后生效。

## 构建

```bash
node scripts/build.mjs      # src/ -> lib/client.js
node scripts/build.mjs --check
node scripts/verify.mjs     # 契约自检：函数名、禁用写法、令牌残留、注册表
```

`lib/styles/*.css` 与 `lib/menu.page.js` 不需要构建，宿主半边每次渲染页面都从磁盘读，改完刷新即生效。只有 `src/` 下的 JS 需要重新 build。

组件契约写在 [`src/components/README.md`](src/components/README.md)：`rt` 的每个成员、转换步骤、旧令牌到新角色的映射表。

## 排错

| 现象 | 看哪里 |
| --- | --- |
| 整套没生效 | 页面控制台 `[ui-copy/bundle]`；确认 `globalThis.DSHUI_CONFIG` 已注入（`<head>` 里有一行 `window.DSHUI_CONFIG=...`） |
| 某一个组件没生效 | 控制台 `[ui-copy/<key>]`；若说 `cannot load "<包名>"`，说明该包的 browser half 不在 boot graph，检查 `dsh.client.inject` |
| 样式没跟上 | `/plugins/ui-copy/client.js` 是否为最新 build；`<head>` 里的 `<style data-dshui>` 是否包含该组件的表 |
| 颜色还是旧的 | 组件是否残留 `--dsw-*`；`node scripts/verify.mjs` 会列出来 |
| 宿主升级后某个组件消失 | 该组件依赖的 slot 名或 CSS 模块前缀变了；组件自己的注释里写了它锚定的选择器 |

## 从 1.x 过来

1.x 的 `dsh-ui-copy` 只有文案、ask、composer、menu、sidebar 五件事，摊成五行（`ui-copy`、`ui-copy-ask`、`ui-copy-composer`、`ui-copy-menu`、`ui-copy-sidebar`），设置里只有 `accent` 一行。2.0 把它们收进同一行，并接管了原先独立发布的十个界面插件。

升级时：profile 的 `dsh.profile.bundles` 只留 `dsh-ui-copy` 一项，`cordis.patch.yml` 里删掉 `ui-copy-ask` / `ui-copy-composer` / `ui-copy-menu` / `ui-copy-sidebar` 以及被收编插件的行，把原来的 `dsh-local-identity.name` / `.avatar` 挪进 `ui-copy.identity`，`dsh-status-phrases.phrases` 挪进 `ui-copy.statusPhrases.phrases`。`accent` 字段的位置与含义没变。
