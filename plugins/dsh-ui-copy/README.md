# dsh-ui-copy

DeepSeek Harness 的界面文案改写插件。它不改动任何官方包，只在浏览器里改写三处已渲染的文本，并用一张自己的样式表隐藏徽章。

| 目标 | 位置 | 行为 |
| --- | --- | --- |
| 空态大标题 | `hero.headline`（原为「探索未至之境」） | 从当前语言池中随机取一句；React 每次把原句写回时重新取，自己写的那句不会被反复打乱 |
| 输入框空置提示 | hero 态与普通态各一组 | 每组随机取一句俏皮话，按 React 传入的原句识别状态，同时同步 `aria-label` |
| 预览版徽章 | 标题右侧的 `预览版` | 整条隐藏 |

默认文案写在 `lib/client.js` 的 `DEFAULTS` 里：标题与输入框都是「一组句子随机取一句」，改成单元素数组即固定不轮换；`hidePreviewBadge` 默认 `true`。输入框的句子不含 `/`、`@` 之类的提示。

## 改文案

两种改法，任选其一。

**一、直接改源码**（保存后刷新页面即可，此插件无构建步骤）

```js
// lib/client.js
const DEFAULTS = {
  headline: {
    zh: ['有什么可以帮你的？', '……'],
    en: ['What can I help you with?', '……'],
  },
  // 键是 React 传来的原句（一个状态一条，换语言再加），值是这一状态要显示的句子池
  placeholders: {
    '描述你想要构建的内容, / 调用指令, @ 文件或对话': ['说点什么，剩下的我来', '……'],
    '发消息或创建任务, / 调用指令, @ 文件或对话': ['接着聊，我听着', '……'],
  },
  hidePreviewBadge: true,
  css: '',
}
```

想加任意其他改写，用 `css` 字段塞样式，或照 `applyPlaceholders` 的样子加一条规则。

**二、走 profile 配置**（不动插件源码）

在 `~/.dsh/profiles/desktop/cordis.patch.yml` 里追加：

```yaml
- id: ui-copy
  name: dsh-ui-copy
  config:
    hidePreviewBadge: true
    headline:
      zh: ['有什么可以帮你的？']
    placeholders:
      '描述你想要构建的内容, / 调用指令, @ 文件或对话': ['说点什么，剩下的我来']
```

未写的字段沿用 `DEFAULTS`；`placeholders` 是按原句键合并的，所以只写想改的那几条即可。

## 安装

profile 的 `package.json` 按此登记：

```json
"dependencies": {
  "dsh-ui-copy": "github:Alamanes/applesdsh-dev#path:plugins/dsh-ui-copy"
},
"dsh": {
  "profile": {
    "bundles": ["...", "dsh-ui-copy"]
  }
}
```

再在该 profile 目录执行 `pnpm install` 装好 `node_modules`，重启 DSH（或经插件页启用该行）后生效。停用只需从 `bundles` 里删掉 `dsh-ui-copy`。

## 为什么不走 locale 与槽位

这两条路都试过，堵死：

- `ctx.locale.register(ns, dict)` 在同一「命名空间 + 语言」已有词典时直接抛错，而 `conversation` 命名空间的 `zh`/`en` 由官方包先注册，插件覆盖不到 `hero.headline`。
- Hero 区只开了 `conversation.hero.brand.mark` 一个槽（鱼形标志），标题文字没有座位；`conversation.composer` 虽为 chain 槽，但空会话时以 `fallbackOnly` 渲染，链上注册够不到 Hero。

因此改用 DOM 改写，配 rAF 节流的 MutationObserver 在 React 重渲染后补回。代价是锚点依赖当前版本的结构：`titleGroup`、`previewBadge`、`data-placeholder`、`data-composer-placeholder`。官方若改结构与类名，改这里的四个选择器即可。
