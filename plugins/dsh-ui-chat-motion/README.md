# dsh-ui-chat-motion

聊天区的三处动效与读数。套件组件，默认全开，插件页上停用整行即可。

## 插入符位移

把浏览器画的那根插入符换成自己画的，位移走过渡（80 ms）。主输入框（`[data-composer-input]`，contenteditable）
与输入区里的 textarea——提问卡片的作答框、排队消息的编辑框——都接管。textarea 的选区不进 DOM，用一层镜像
量矩形；光标贴着 `<br>` 时量那个换行符自己；量不出来就把原生插入符还回去，宁可不动手也不让读者看不见光标。

## 上下文占用饼

输入坞那圈环换成 16px 的实心饼，按占用取 20%~40% 六档色（低于 20 绿、40 及以上红），切一口沿角平分线推出去，
缝宽恒定 1.2px。读数挂数字轮，变化的那一位原地弹。

节点识别照 dsh 的结构：`[data-composer-dock]` 的直接子元素里，那个不带 `data-composer-stat`、装着
`button[aria-haspopup="dialog"]` 与 svg 的 span。认不出就什么都不做。

## 缓存命中率

用槽位遮蔽内置的 usage 座位（`conversation.composer.dock`，同 id、同 order、priority -1），重画一枚读数恒取
一位小数、按 90%~99% 六档取色的胶囊；「缓存命中」四字与读数同色。点开是 token 明细面板（Escape 与点外关闭）。
primitives 缺席时退化成静态读数，不弹面板。

## 颜色

六档色阶全部从语义令牌派生：红 `--dshui-danger`、黄 `--dshui-warn`、绿 `--dshui-success`，中间在 OKLab 里混。
没有一处写死 hex，五套主题下自动跟着走。
