# dsh-status-phrases

把 DSH 回合状态行那句「深度求索中，用时12秒」/(en) "Deep diving for 12s" 换成轮换的短语：逐字打字机输出，文字跑彩虹流光，轮换间隔 10 秒。整份短语表通过**设置 → 通用设置**里的**一个多行文本框**配置。

它只做这一件事 —— 上游 `dsh-status-rotator` 的短语轮换、打字机与渐变这三样，其余（预设、定时切换、弹幕、主题包、标签页标题、观测徽章、鲸鱼尾巴动作、外部词库、HTTP 配置路由）都没有搬过来。

## 效果

状态行看起来仍然是宿主那一行：位置不变、鲸鱼尾巴图标保留、时长照旧显示，只有文案换成了你自己的短语。

| 组成 | 行为 |
|---|---|
| 文案 | 从配置框里的短语轮换抽取，洗牌袋算法保证一轮之内不重复 |
| 打字机 | 每 30ms 一个字符，开打前锁住整句宽度，时长旁边的时钟不会左右跳 |
| 彩虹流光 | `background-clip:text` 的 7 色渐变，4 秒一圈，文字本身透明只留渐变 |
| 时长 | 从宿主文案里读出来原样搬到自己的时钟 span（13px、caption 色、tabular-nums） |
| 减少动效 | 系统开启「减少动态效果」时渐变动画停掉 |

## 配置

打开**设置 → 通用设置**，找到「状态行短语」一行：

```
正在深度求索…
正在整理思路…
正在推演下一步…
```

- 一行一句，轮到哪句显示哪句；
- 空行、以 `#` 开头的行忽略；
- 单句最长 160 字符，整表最多 500 句；
- **整框留空 = 使用内置的 10 句默认短语**，状态行不会变成空白；
- 失焦即保存（`Ctrl/Cmd + Enter` 也可），保存后立刻生效，不用重开对话。

写入的值落在 profile 的 `cordis.patch.yml` 里该插件行的 `config.phrases` 下：

```yaml
- id: dsh-status-phrases
  name: dsh-status-phrases
  config:
    phrases: |-
      正在深度求索…
      正在整理思路…
```

## 原理

宿主在 dsh 0.2.0 里的运行行结构：

```
div[data-chat-running]
  ├─ span(class*=_visuallyHidden)     读屏公告，绝不触碰
  ├─ span(class*=_runningDivider)
  └─ span(class*=_runningContent)
       ├─ span(class*=_runningIcon)   鲸鱼尾巴，保留原样
       └─ span(class*=_runningText)   宿主文案「深度求索中，用时12秒」
```

宿主每秒重写 `_runningText`，所以插件**不往里写**：它读那份文本（时长就从这里来），把它 `display:none` 藏掉（这同时除掉了宿主自带的 shimmer，否则会和本插件的渐变打架），然后在它后面插入自己的一条线 —— 文案 span + 时钟 span。

- 定位靠 `MutationObserver`（childList / subtree / characterData）+ 每 2 秒一次的兜底重扫；
- 宿主文案的前缀随界面语言变化，前缀与初始文案都优先从 dsh 的 `chat` 字典实时解析（`chat.deepDiving`、`message.turnProcess.deepDivingFor`），字典不可用时回退到已知文案；
- 宿主文本不再匹配「运行中」（回合结束，变成 `Worked` / `Took 12s`）即撤掉插件那条线，把宿主文案放回来；
- 自己那条线内部的写入会被识别并排除，打字机不会触发自己；
- `<style>` 建完立刻打上 `data-plugin="dsh-status-phrases"`，避免被客户端模块系统认领后在 revision 变化时删掉。

## 安装

登记进 profile 的 `package.json`：

```json
{
  "dependencies": {
    "dsh-status-phrases": "github:Alamanes/applesdsh-dev#path:plugins/dsh-status-phrases"
  },
  "dsh": {
    "profile": {
      "bundles": ["dsh-status-phrases"]
    }
  }
}
```

然后在该 profile 目录里跑一次 `pnpm install` 并重启 DSH。宿主半区只声明了配置字段，页面上的全部工作都由浏览器半区完成。

## 来源与许可

行为与实现取自 [`dsh-status-rotator`](https://github.com/01Virex/dsh-status-rotator)（MIT，作者 01Virex）—— 短语轮换、打字机、锁宽诀窍、渐变 CSS、`data-plugin` 样式归属的做法都来自它。本插件是那份实现的一个收窄复刻：只保留替换状态行文案及其特效，并把短语配置收敛成一个文本框。

MIT。
