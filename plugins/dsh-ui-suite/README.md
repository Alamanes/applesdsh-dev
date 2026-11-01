# dsh-ui-suite

界面套件的 bundle：一行 entry 插入十八个可单独停用的组件包，共享一套 `--dshui-*` 设计令牌。

`lib/index.js` 不做事，只导出空模块；`dsh.bundle.patch` 指向 `cordis.patch.yml`，其中每个组件一行 insert。插件页把这一层显示成「界面套件」，下面是十八个可以单独开关的组件。

## 组件

| 包 | 作用 |
| --- | --- |
| `dsh-ui-copy` | 空态大标题轮换、输入框空置提示 |
| `dsh-ui-ask` | 提问弹窗的视觉语言 |
| `dsh-ui-composer` | 输入卡片与圆形发送按钮 |
| `dsh-ui-menu` | 权限模式、模型、Dock 标签与右键菜单的开合动画 |
| `dsh-ui-sidebar` | 侧栏「新会话」按钮的样式 |
| `dsh-ui-identity` | 侧栏左下角的名字与头像 |
| `dsh-ui-session-delete` | 会话删除与确认弹窗 |
| `dsh-ui-peak-valley` | 底栏的峰谷时段与倒计时 |
| `dsh-ui-status-phrases` | 回合状态行的渐变短语 |
| `dsh-ui-foot-panels` | 插件、使用统计、技能中心的底部入口 |
| `dsh-ui-restart` | 标题栏的重启按钮与 `restart_dsh` 工具 |
| `dsh-ui-effort-slider` | 推理强度滑块 |
| `dsh-ui-whale` | 对话区的粒子鲸鱼壁纸 |
| `dsh-ui-skill-explorer` | 技能中心面板 |
| `dsh-ui-theme` | 主题预设与设置页「主题」分区 |
| `dsh-ui-chat-fold` | 思考行与过程组的开合 |
| `dsh-ui-chat-motion` | 聊天区动效与读数 |
| `dsh-ui-chat-diff` | `run_code` 里 write / edit 的 diff 行 |

## 单独安装某个组件

装那个包本身即可：它自带运行时、令牌层与宿主半边，不依赖本 bundle。

## 构建

`scripts/build.mjs` 把各组件的 `src/component.js` 拼成 `lib/client.js`。

```bash
node scripts/build.mjs                 # 全部重建
node scripts/build.mjs dsh-ui-quota    # 只重建指定包
node scripts/build.mjs --check         # 只检查是否过期
```

默认用单包模式。全量重建会把所有包的源码一起重算，其中一个包的模板字符串写坏，就会连带影响别的包——CSS 注释里的反引号落在模板字符串内部，就这样让整个应用起不来一次。

## 已移出

`dsh-ui-quota` 2.1 起独立成包，不再属于本套件，从 bundles 里单独选中即可。
