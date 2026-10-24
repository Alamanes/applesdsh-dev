# dsh-ui-chat-diff

`run_code` 里 write / edit 子调用的 diff 行。套件组件，默认全开，插件页上停用整行即可。

## 为什么需要它

dsh 内置的 diff 卡片只画根调用：`ui-tool` 的 diff-card-model 第一行就是
`if (block.parentCallId !== undefined) return null`，从 `run_code` 程序里派发出去的子调用拿不到卡片，也拿不到
行尾那个 `+96 -0`。这一行自己从参数重算一份，接管 `tool.call.toolview` 槽位的 `write` / `edit` 两个 key
（priority -1 遮蔽内置的 0）。

## 它做什么

- 准备态（参数还在流进来）就显示路径与 `+n -m`：write 的内容一到就出数字，edit 的 `old_string` / `new_string`
  各自到、各自开始数，不等另一半。
- 流式期间行尾两个数按节拍换数，让每一轮数字动画走完整；落定后实时跟随。
- 展开是完整的 diff（9 行以内直接铺开，更多时折叠）；没有 diff 时落 IN / OUT 卡片；失败与中断各有自己的态。
- 结算后优先读 `presentationMeta.diffs`，拿不到再退回参数——子调用不持久化 meta，这是上游已声明的代价。

## 颜色

正文、边框、表面全部走 `--dshui-*` 令牌；增删那一对用 `--dshui-success` / `--dshui-danger`。零 hex。
