# dsh-peak-valley-hint

DeepSeek Harness 的浏览器半只插件：在侧栏底栏的右端显示当前计费时段——现在算高峰还是低谷，以及距下一次切换还有多久。

## 用途

DeepSeek 的 API 计价分峰谷两档，跑长任务前值得看一眼现在处在哪一档。这一行本来就有空位（面板按钮靠左），插件把提示放在右端：

```
[插件] [自动化任务]                        ● 低谷时段 09:25:00
```

- 高峰用 `#e0433f`，低谷用 `#2fa24c`，与官方计价界面同色；倒计时用次级字色、表格数字字体，每秒走一格不抖动。
- 鼠标停在上面给出完整时段说明（第一方 tooltip 可用时用 tooltip，否则退回 `title`）。
- 侧栏折叠成 56px 轨道时不渲染：那一列放不下句子。

## 时段规则

与 API 计费脚注一致，全部按北京时间（固定 UTC+8，与本机时区无关）：

| 时段 | 规则 |
| --- | --- |
| 高峰 | 周一至周五 09:00–12:00、14:00–18:00，中国法定节假日除外 |
| 低谷 | 其余全部时段，含周末与法定节假日全天 |

区间左闭右开：12:00 整与 18:00 整已经算低谷。

切换点只会落在 00:00、09:00、12:00、14:00、18:00 这五个时刻上，倒计时因此按小时边界向前扫描，最长扫 12 天（春节连休 9 天也覆盖得住）。倒计时的小时不取模 24：周五傍晚会显示 62 小时之后的周一早高峰。

## ⚠️ 每年 11 月要补一次节假日

`lib/client.js` 里的 `HOLIDAYS` 集合只列**放假的日期**，调休上班日不必列（它们都落在周末，周末本来就是低谷）。当前收录的是 2026 年全年。

国务院办公厅在每年 11 月前后公布次年的放假安排，那时必须把新一年的日期补进这个集合，否则那一年里法定节假日会被算成高峰，提示会指错价。这是本插件唯一需要人工维护的地方。

## 开关方式

插件以一行 loader 声明启用。安装到 profile 后，在 `~/.dsh/profiles/desktop/cordis.patch.yml` 里加入：

```yaml
- insert:
    - id: dsh-peak-valley-hint
      name: dsh-peak-valley-hint
```

同一行也写在插件自带的 `cordis.patch.yml` 里（`package.json` 的 `dsh.bundle.patch` 指向它），插件页安装时会直接插入。删掉这一行即关闭整个插件，侧栏右端恢复留白。没有配置项。

## 它做了什么

宿主半 `lib/index.js` 是空实现（只为 Loader 提供一个宿主行、并让 `exports["./client"]` 指向浏览器包）；全部逻辑在 `lib/client.js`。

- 注册一个 `sidebar.footer.action` 槽位条目（id `peak-valley-hint`，order 20）。这个槽由 ui-sidebar 渲染，位置在侧栏底部、设置行上方，条目拿到列状态 `wide`。
- 行用 `margin-left: auto` 推到该容器最右端，因此不管左端是插件按钮、Cordis 按钮还是两者都有，提示都贴右。
- 判断与倒计时都是纯算术：把时间戳平移 +8 小时后按 UTC 读，得到北京的日期、星期与小时，再与高峰窗口和节假日集合比对。
- 每秒重渲染一次这一个组件，不触碰侧栏其它部分。

## 已知边界

- **不读接口、不依赖其它插件**：规则硬编码在本插件内。装了鲸鱼挂件（`dsh-whale-widget`）时两者结论一致，但它们是两份独立实现，各自的节假日表要各自维护。
- **节假日表会过期**：见上一节，这是唯一的维护点。
- **时区无关，但也没有本地化**：一律按北京时间判断，刻意不跟随系统时区。
- **只提示，不拦截**：不会因为处在高峰就阻止发消息，也不改变任何计费行为。
- **面板高亮与时区无关**：本插件不参与面板切换，也不注册任何快捷键。

## 文件

| 文件 | 作用 |
| --- | --- |
| `package.json` | 包声明。`exports["./client"]` 是浏览器包入口，`dsh.bundle.patch` 指向补丁，`dsh.client` 声明 `platform: web` 与 `inject: ["@deepseek-ai/dsh-client-ui-sidebar"]` |
| `lib/index.js` | 宿主半只：`name` 与空 `apply`，无依赖 |
| `lib/client.js` | 浏览器半只：规则、倒计时与组件，`window.__ModuleLoader__.load({ id: 'dsh-peak-valley-hint', factory })` 注册 |
| `cordis.patch.yml` | loader 行声明，供 profile 引用 |
| `README.md` | 本文件 |

## 依赖关系

- `dsh.client.inject: ["@deepseek-ai/dsh-client-ui-sidebar"]`：boot graph 层面的包到达顺序声明，让 ui-sidebar 的浏览器包先注册；不是 cordis 服务注入。
- 服务依赖写在浏览器包自己的 `exports.inject = ['slots', 'locale']`。
- `factory` 只 `require` 两个运行时提供的模块：`react` 与 `@deepseek-ai/dsh-client-ui-primitives`（后者只取可选的 `Tooltip`）。没有第三方依赖。
