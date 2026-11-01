# dsh-ui-quota

设置页「用量」分区：Command Code 额度卡片与每日 Token 热力图。原为 `dsh-ui-suite` 的组件，2.1 起独立成包。

## 界面

- **额度卡片**：月度、5 小时、每周各一张。标题右侧是「剩余百分比 · 重置倒计时」，进度条按已用比例填充，底部一行是「已用 / 上限 Credits」和重置时间。
- **Token 热力图**：最近 53 周的每日 token 消耗，横向滚动，加载后自动停在本周。颜色分五档，按当日消耗相对最忙一天取对数分档，空白日是主题底色。

## 数据来源

| 端点 | 数据 | 缓存 |
| --- | --- | --- |
| `/api/cc-quota/report` | 账户、套餐、月度与滚动窗口额度 | 15 秒，失败回落到上次快照 |
| `/api/cc-quota/activity` | 本地会话日志聚合出的每日 token | 60 秒 |

额度接口是四路只读 GET（whoami / usage / credits / subscriptions）。接口报美元，页面按 `$1 = 100 Credits` 换算成整数展示。

热力图不碰网络：遍历 `sessionPersistence` 里每个会话的 `assistant/message`，把 usage 的四个桶相加，按本地日期聚合，同一 `(turn, step)` 只算一次。

## 配置

```yaml
- id: dshui-quota
  name: dsh-ui-quota
```

本包自带 `dsh.bundle.patch`，在 profile 的 `dsh.profile.bundles` 里选中即挂载。

## 依赖

| 服务 | 用途 | 缺失时 |
| --- | --- | --- |
| `connection` | 两个端点的传输层 | 整页不挂载 |
| `sessionPersistence` | 热力图的数据来源 | 热力图空态，额度卡片照常 |

## 排错

| 现象 | 检查 |
| --- | --- |
| 设置页没有「用量」 | `dsh.profile.bundles` 是否选中本包；控制台 `[ui-copy/quota]` 前缀报错 |
| 卡片有数字、热力图空 | `sessionPersistence` 是否可用；会话日志是否可读 |
| 额度百分比和官网对不上 | 官网按套餐名义额度算，这里用接口返回的 cap |
| 显示「本次读数跨了计费周期」 | 两个接口给出的用量与剩余不能同时成立，等下一次刷新 |
