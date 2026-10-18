# dsh-peak-valley-hint

DeepSeek Harness 的插件：在侧栏底栏的右端显示当前计费时段——现在算高峰还是低谷，以及距下一次切换还有多久。节假日日期由插件自己联网获取，不需要每年手工补表。

## 用途

DeepSeek 的 API 计价分峰谷两档，跑长任务前值得看一眼现在处在哪一档。侧栏底栏本来就有一块空位（面板按钮靠左），插件把提示放在右端：

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

## 节假日从哪来

规则里唯一算不出来的是「哪几天放假」。这件事没有官方 API：国务院办公厅每年 11 月发一份通知，第三方项目 [NateScarlet/holiday-cn](https://github.com/NateScarlet/holiday-cn)（MIT）把每份通知整理成一年一个 JSON 文件，用 `days[].isOffDay` 标出放假日。

插件按这个流程拿到它：

1. **宿主半**（`lib/index.js`）取当年与次年的 JSON，两份合并，缓存 24 小时，通过一条同源路由下发：

   ```
   GET /dsh-peak-valley/holidays.json
   -> { ok, holidays: ["2026-01-01", …], source, fetchedAt, year, error }
   ```

   主源是 jsDelivr 上的 `holiday-cn`，失败时回退到 GitHub raw。次年文件在通知发布前是空的（`days: []`），这不算错误，等发布后自然就有了。

2. **浏览器半**（`lib/client.js`）先用内置的兜底表渲染首帧，路由结果一到就换掉。路由失败（离线、源不可达、插件被停用）就继续用兜底表。

兜底表是**离线保险**，不需要跟日历走：平时真正生效的是路由下发的日期，跨年后插件自己就能拿到新一年的安排。

## 开关方式

插件以一行 loader 声明启用。安装到 profile 后，在 `~/.dsh/profiles/desktop/cordis.patch.yml` 里加入：

```yaml
- insert:
    - id: dsh-peak-valley-hint
      name: dsh-peak-valley-hint
```

同一行也写在插件自带的 `cordis.patch.yml` 里（`package.json` 的 `dsh.bundle.patch` 指向它），插件页安装时会直接插入。删掉这一行即关闭整个插件，侧栏右端恢复留白。没有配置项。

## 它做了什么

- 宿主半注册一条路由（`ctx.webServer.register`，`kind: 'exact'`）。`webServer` 用局部注入等待，服务来得慢也不会推迟插件行本身的加载。抓取在第一次请求时发生，同一时刻的并发请求共享同一次抓取；成功的结果存 24 小时。
- 浏览器半注册一个 `sidebar.footer.action` 槽位条目（id `peak-valley-hint`，order 20）。这个槽由 ui-sidebar 渲染，位置在侧栏底部、设置行上方，条目拿到列状态 `wide`。
- 行用 `margin-left: auto` 推到该容器最右端，因此不管左端是插件按钮、Cordis 按钮还是两者都有，提示都贴右。
- 判断与倒计时都是纯算术：把时间戳平移 +8 小时后按 UTC 读，得到北京的日期、星期与小时，再与高峰窗口和节假日集合比对。
- 每秒重渲染一次这一个组件，不触碰侧栏其它部分。

## 已知边界

- **依赖一个第三方数据源**：`holiday-cn` 停止维护或改变文件结构时，路由会返回 `ok: false`，插件退回兜底表继续工作（那时日期可能过期）。源地址与解析逻辑都在 `lib/index.js` 顶部的三个常量里。
- **首次请求要联网**：宿主启动后第一次有人访问那条路由时发起抓取，超时 8 秒；之后 24 小时内不再访问网络。离线机器上不会卡住界面，只会一直用兜底表。
- **路由不带凭据，返回的是公开日期**：能从本机回环地址访问 DSH 端口的进程都能读到这份日期表，里面没有任何账号或用量信息。需要更严的边界时可以给它套上宿主连接栅栏。
- **时区固定北京时间**：刻意不跟随系统时区。
- **只提示，不拦截**：不会因为处在高峰就阻止发消息，也不改变任何计费行为。

## 文件

| 文件 | 作用 |
| --- | --- |
| `package.json` | 包声明。`exports["./client"]` 是浏览器包入口，`dsh.bundle.patch` 指向补丁，`dsh.client` 声明 `platform: web` 与 `inject: ["@deepseek-ai/dsh-client-ui-sidebar"]` |
| `lib/index.js` | 宿主半只：抓取节假日、缓存、下发路由 |
| `lib/client.js` | 浏览器半只：时段规则、倒计时与组件，`window.__ModuleLoader__.load({ id: 'dsh-peak-valley-hint', factory })` 注册 |
| `cordis.patch.yml` | loader 行声明，供 profile 引用 |
| `README.md` | 本文件 |

## 依赖关系

- `dsh.client.inject: ["@deepseek-ai/dsh-client-ui-sidebar"]`：boot graph 层面的包到达顺序声明，让 ui-sidebar 的浏览器包先注册；不是 cordis 服务注入。
- 宿主半 inject `webServer`；网络请求用 Node 内置的 `fetch`，没有第三方依赖。
- 浏览器半 inject `slots` 与 `locale`，只 `require` 两个运行时提供的模块：`react` 与 `@deepseek-ai/dsh-client-ui-primitives`（后者只取可选的 `Tooltip`）。
