/**
 * dsh-ui-chat-motion —— 浏览器半边。
 *
 * 三块动效与读数，全部只认 dsh 自己发出的**语义属性**：它的类名每次都带构建期 hash，认了就等着随
 * dsh 发版而坏。三块的共同点是不新增座位（除了命中率胶囊遮蔽内置那一枚），而是从已经渲染出来的
 * 节点上读、在它们身上写。
 *
 *   插入符位移   把浏览器画的那根换成自己画的。浏览器插入符除了颜色与闪烁没有任何可动画属性，所以
 *                「移动时有过渡」只有一条路：caret-color 置 transparent 按下去，自己画一根。
 *                富文本面认 [data-composer-input]（坐标由折叠 Range 给出）；纯文本面认输入区座位里的
 *                textarea（提问卡片的作答框、排队消息的行内编辑框），它的选区不进 DOM，只能搭一层
 *                镜像量矩形。镜像与空段落里的探针都挂在 body 上，量完就摘，不碰 dsh 的任何容器。
 *   上下文占用饼 dsh 画的是环，也没有档位色。它不是一个座位——conversation 的 InputBar 直接渲染那一个
 *                span——所以只能从结构上认：输入坞 data-composer-dock 的直接子元素里，那个既不带
 *                data-composer-stat（统计胶囊才带）、又装着一枚 aria-haspopup 为 dialog 的按钮与一个
 *                svg 的 span。认不出就什么都不做。
 *   命中率胶囊   在 conversation.composer.dock 上用同一个 id 与 order、更低的 priority 遮蔽内置那一枚，
 *                换成恒取一位小数、按 90%~99% 六档取色的这一枚。它是唯一一处真正的座位注册，所以这一
 *                枚是 React 组件；另两处是 DOM 工作。
 *
 * 上游的开关（插入符档位、饼、命中率转轮）在套件里没有配置表单，这里全部按「默认开启」实现：插入符
 * 固定在上游的默认档「无论何时」（打字也放过渡），饼与转轮常开。唯一还读的一份表单是 dsh 自己的
 * ui-chat——「性能与用量」那两档（简洁 / 详细）是宿主的显示偏好，不是本组件的开关。
 *
 * 数字轮只有一份实现、两处共用：ReelText 是 React 组件（命中率胶囊里渲染），createDomReel 是给纯 DOM
 * 用的写入器（上下文占用那串百分比挂在 dsh 自己的文本节点旁边）。两者共用同一组类名与关键帧，所以两
 * 处的翻动必然同款。
 *
 * 属性名与类名在两处出现：这一组常量，以及那张样式表的字面量。改一处就要改另一处。
 *
 * @module dsh-ui-chat-motion/client
 */
function dshuiComponent_chat_motion(rt) {
  const React = rt.require('react')
  if (React === null) {
    rt.warn('react is not in this boot graph; chat-motion skipped')
    return
  }
  const h = React.createElement
  const Fragment = React.Fragment

  /**
   * 弹窗那一套（锚定定位、点外面关闭）与那枚举图标都来自 primitives。缺了这一个包时这一枚仍然渲染，
   * 只是退化成静态读数：没有按钮、没有明细面板。
   */
  const primitives = rt.require('@deepseek-ai/dsh-client-ui-primitives')
  const uiAnchoredPosition = primitives === null || typeof primitives.useAnchoredPosition !== 'function'
    ? null
    : primitives.useAnchoredPosition
  const uiDismissOutside = primitives === null || typeof primitives.useDismissOutsidePointer !== 'function'
    ? null
    : primitives.useDismissOutsidePointer
  const IconDatabase = primitives === null ? undefined : primitives.IconDatabaseOutlineRegular
  if (primitives === null) rt.warn('ui primitives are not in this boot graph; cache-hit details fall back to a static reading')

  /** 明细面板的传送门；没有 react-dom 时就地渲染（面板是 position: fixed，位置不变）。 */
  const reactDom = rt.require('react-dom')
  const createPortal = reactDom === null || typeof reactDom.createPortal !== 'function' ? null : reactDom.createPortal

  /* ---- 语义属性与选择器 ------------------------------------------------ */

  /** 主输入框那层可编辑面。 */
  const COMPOSER_INPUT_SELECTOR = '[data-composer-input]'

  /** 输入区里的纯文本框：提问作答框与排队编辑框都住在输入区座位里。 */
  const COMPOSER_TEXTAREA_SELECTOR = '[data-composer-seat] textarea'

  /** 输入坞：统计胶囊与上下文比例圆都是它的直接子元素。 */
  const COMPOSER_DOCK_SELECTOR = '[data-composer-dock]'

  /** 只有统计胶囊才带的座位标记；带着它的子元素不归比例饼管。 */
  const STAT_ATTRIBUTE = 'data-composer-stat'

  /** 比例圆那颗按钮：会开对话弹窗，并且画着一枚 svg。 */
  const PIE_TRIGGER_SELECTOR = 'button[aria-haspopup="dialog"]'

  /** 命令 chip 被选中时 dsh 会把原生插入符按掉：那一下不是光标，自绘的那根也藏起来。 */
  const CHIP_SELECTED_ATTRIBUTE = 'data-composer-chip-selected'

  /** 命中率胶囊遮蔽的那个座位。 */
  const SLOT_NAME = 'conversation.composer.dock'

  /* ---- 插入符 ---------------------------------------------------------- */

  /** 闪烁动画的名字；样式表里拼 keyframes，两处必须一字不差。 */
  const CARET_BLINK_NAME = 'dsh-cm-caret-blink'

  /** 挂在可编辑面上：有它，原生插入符才让位。 */
  const CARET_ATTRIBUTE = 'data-dsh-cm-caret'

  /** 自绘插入符自己。 */
  const CARET_LAYER_ATTRIBUTE = 'data-dsh-cm-caret-layer'

  /** 自绘插入符此刻可见。 */
  const CARET_VISIBLE_ATTRIBUTE = 'data-dsh-cm-caret-visible'

  /** 挂在不是定位上下文的父元素上：样式表见到它就补一条 position: relative。 */
  const CARET_HOST_ATTRIBUTE = 'data-dsh-cm-caret-host'

  /** 自绘那根的颜色，写在它自己身上：接管那一刻从可编辑面的原生插入符上读下来。 */
  const CARET_COLOR_PROPERTY = '--dshui-cm-caret-color'

  /** 聚焦之后隔多久补看一次。切会话时，聚焦与「选区就绪」之间隔着几帧。 */
  const FOCUS_SETTLE_MS = 120

  /**
   * 镜像层要从 textarea 上抄的样式：凡是影响字形宽度与折行位置的都在这里。少抄一条，镜像里的折行就
   * 和 textarea 里的对不上，插入符会落在别的行上。
   */
  const MIRRORED_PROPERTIES = [
    'direction', 'font-family', 'font-size', 'font-size-adjust', 'font-stretch', 'font-style',
    'font-variant', 'font-weight', 'font-feature-settings', 'font-variation-settings', 'font-kerning',
    'letter-spacing', 'word-spacing', 'line-height', 'text-align', 'text-indent', 'text-transform',
    'tab-size', 'white-space', 'word-break', 'overflow-wrap', 'hyphens',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  ]

  /* ---- 色阶 ------------------------------------------------------------ */

  /** 段标记与段内位置写在这两个名字上：样式表按段标记选段，按位置算色。 */
  const RAMP_SPAN_ATTRIBUTE = 'data-dsh-cm-ramp-span'

  /** 段内位置的变量名。 */
  const RAMP_POSITION_VAR = '--dshui-cm-ramp-position'

  /** 低于第一个色标的那一段：两端同色，插值恒等。 */
  const RAMP_SPAN_LOW = 'low'

  /** 从最后一个色标起的那一段：同样恒定。 */
  const RAMP_SPAN_HIGH = 'high'

  /**
   * 六个色标在占用上的位置：20 绿、24 浅绿、28 黄、32 橙黄、36 橙红、40 红。低于 20 一律绿、40 及
   * 以后一律红，与样式表里那几段一一对应。
   */
  const CONTEXT_STOPS = [20, 24, 28, 32, 36, 40]

  /** 命中率那六个色标在显示值上的位置；末一个落在 99.0，之后一律深绿。 */
  const HIT_TONE_STOPS = [90, 92, 94, 96, 98, 99]

  /* ---- 上下文占用饼 ---------------------------------------------------- */

  /** 挂在这个比例圆的根上：在，就说明这一处已经接管。 */
  const CONTEXT_PIE_ATTRIBUTE = 'data-dsh-cm-context-pie'

  /** 读数那一截的形状；dsh 写的就是「26%」。 */
  const READING_PATTERN = /^(\d{1,3})%$/

  /**
   * 饼的边长：16px。原来那圈环的外轮廓只有 13px，那个尺寸上圆弧与切口都认不出来；16px 比原来那枚
   * 14px 的图标大一圈就够，饼再大就压着这一行、看着突兀。
   */
  const PIE_SIZE = 16

  /** 原图标那一格：dsh 那枚 svg 写的就是 14×14。饼比它大，靠这个数摆正。 */
  const ICON_SIZE = 14

  /**
   * 那道缝的宽度，像素——唯一的旋钮。缝由「洞口比那一块大一圈」给出（见 pushImage），宽恒为这个值，
   * 与推开多远无关。这一格图标上 1px 出头已经看得很清楚；再宽，那一块就要与盘面散开了。
   */
  const SLICE_GAP = 1.2

  /**
   * 那一块沿角平分线推开多远，像素。缝不靠它挣（见上），它只影响两件事：那一块离开原位多远，以及
   * 盘面还剩多少直径（PIE_SIZE 减位移）。2.6px 是权衡后的取值——端出去的观感明显，盘面还剩 13.4px。
   */
  const SLICE_LIFT = 2.6

  /** 那一圈缝的遮罩 id。 */
  const SLICE_MASK_ID = 'dsh-cm-slice'

  /** 盘面的半径：占满这一格。切口开在圆里，圆外不必留白。 */
  const RADIUS = PIE_SIZE / 2

  /** 推出去那一套的半径：得让出推开那一段，否则那一块的外缘会被这一格裁掉。 */
  const PUSH_RADIUS = (PIE_SIZE - SLICE_LIFT) / 2

  /** 圆心：这一格的正中。 */
  const CENTER = PIE_SIZE / 2

  /** 一整圈，弧度。 */
  const FULL_TURN = Math.PI * 2

  /** path 坐标的小数位取两位：再多的位数只是噪声。 */
  const PATH_PRECISION = 100

  /** 扩张那一下用多久。与数字轮同一个时长：两件事通常同时发生，一起收才像一件事。 */
  const GROW_MS = 220

  /** 量未占用底色用的探针类名。 */
  const REST_PROBE_CLASS = 'dsh-cm-rest-probe'

  /* ---- 数字轮 ---------------------------------------------------------- */

  /** 这一截的容器：几位数字、小数点、百分号并排。 */
  const REEL_TEXT_CLASS = 'dsh-cm-reel-text'

  /** 高频那一档：挂在这一截的容器上，时长经自定义属性往下传。 */
  const REEL_FAST_CLASS = 'dsh-cm-reel-fast'

  /** 一位数占的那个槽位。 */
  const REEL_SLOT_CLASS = 'dsh-cm-reel-slot'

  /** 槽位里现在的那个数字。 */
  const REEL_CELL_CLASS = 'dsh-cm-reel-cell'

  /** 上一个数字：朝反方向淡出。 */
  const REEL_WAS_CLASS = 'dsh-cm-reel-was'

  /** 读数里的小数点与百分号：不弹，与数字位并排。 */
  const REEL_STATIC_CLASS = 'dsh-cm-reel-static'

  /** 给读屏的那一份读数，视觉上藏起来。 */
  const REEL_SPOKEN_CLASS = 'dsh-cm-reel-spoken'

  /** 挂在被接管的那一截读数上：原文本让位，数字轮接手。 */
  const REEL_TAKEOVER_ATTRIBUTE = 'data-dsh-cm-reel'

  /** 接手方自己那层容器：挂在被接管那一截读数的**父级**里（不是它里面，原因见 paintReel）。 */
  const REEL_HOST_CLASS = 'dsh-cm-reel-host'

  /** 低位比高位晚这么多起手，动起来的次序从左往右。 */
  const REEL_STAGGER_MS = 70

  /** 读数中间那一段的形状：一至六位整数，可带一位小数。 */
  const REEL_READING_PATTERN = /^(\d{1,6})(?:\.(\d))?$/

  /* ---- 命中率胶囊 ------------------------------------------------------ */

  /** 座位根。 */
  const CACHE_HIT_ANCHOR_CLASS = 'dsh-cm-hit-anchor'

  /** 胶囊本体。静态读数是 span，能展开明细的是 button。 */
  const CACHE_HIT_PILL_CLASS = 'dsh-cm-hit-pill'

  /** 胶囊里的文本容器。 */
  const CACHE_HIT_LABEL_CLASS = 'dsh-cm-hit-label'

  /** 「缓存命中」那几个字与紧随其后的读数：色阶挂在这一组上，所以名字与读数同色。 */
  const CACHE_HIT_READING_CLASS = 'dsh-cm-hit-reading'

  /** token 总量与命中率之间的那个点。 */
  const CACHE_HIT_SEP_CLASS = 'dsh-cm-hit-sep'

  /** 弹窗面板。 */
  const CACHE_HIT_PANEL_CLASS = 'dsh-cm-hit-panel'

  /** 弹窗标题行。 */
  const CACHE_HIT_TITLE_CLASS = 'dsh-cm-hit-title'

  /** 标题左侧那一半。 */
  const CACHE_HIT_TITLE_LABEL_CLASS = 'dsh-cm-hit-title-label'

  /** 标题右侧那个精确总量。 */
  const CACHE_HIT_TITLE_VALUE_CLASS = 'dsh-cm-hit-title-value'

  /** 标题下那条发丝线。 */
  const CACHE_HIT_RULE_CLASS = 'dsh-cm-hit-rule'

  /** 明细的 dt/dd 栅格。 */
  const CACHE_HIT_DETAILS_CLASS = 'dsh-cm-hit-details'

  /** 锚点顶边与面板底边之间那道缝，与内置的 stat 弹窗同值。 */
  const PANEL_GAP = 8

  /** 面板与视口边缘留的余量，与内置的 stat 弹窗同值。 */
  const PANEL_MARGIN = 12

  /** 还没量出位置的那一帧：先按隐藏布局画出来，让夹取量到真实尺寸。 */
  const MEASURE_STYLE = { visibility: 'hidden', left: 0, top: 0 }

  /** 这一枚在 chat 命名空间里读文案——内置那一枚用的就是它。 */
  const CHAT_NAMESPACE = 'chat'

  /** dsh 那份「性能与用量」表单的条目 id：简洁档只留命中率，详细档另给总量与明细。 */
  const CHAT_SETTINGS_NAMESPACE = 'ui-chat'

  /** 没有读到 host 分节时的档位，与 dsh 自己的默认值一致。 */
  const DEFAULT_PERFORMANCE_USAGE = 'detailed'

  /** 座位的 id 与顺序，与内置那一枚一模一样：遮蔽靠的是更低的 priority。 */
  const USAGE_STAT_ID = 'usage'
  const USAGE_STAT_ORDER = 1

  /** 遮蔽内置那一枚：同一个 id 与 order 上，priority 最低的那个渲染，内置是 0。 */
  const USAGE_STAT_PRIORITY = -1

  /** 一位小数：千分之一是这条口径的最小单位。 */
  const PERCENT_UNITS_PER_TENTH = 1000

  /** 部分命中的上限：读作 100.0% 之前必须真的全中。 */
  const PERCENT_UNITS_CAP = 999

  /** token 计数的两个进位点，与 dsh 的 formatTokens 同规则。 */
  const THOUSAND = 1000
  const MILLION = 1000000

  /** 每三位一组，做精确计数的千分位。 */
  const GROUP_SIZE = 3

  /* ==================================================================== */
  /* 色阶：把读数落成「段标记 + 段内位置」                                  */
  /* ==================================================================== */

  /**
   * 把一个读数落到色标上。
   *
   * 色值不在这里——它们留在样式表里，锚点之间的插值交给 CSS 的 color-mix(in oklch, ...)。这一侧只算
   * 「落在哪一段、段内位置多少」。两处共用它，因为要的是同一件事：在一个区间里连续取色，而两头各自
   * 恒定——命中率到 99.0 就绿、占用到 40 就红，都不必等到满。
   * @param value - 显示值（读者看到的那一份读数）。
   * @param stops - 色标位置，升序、至少两个。
   * @returns 段标记与段内位置。
   */
  function rampPosition(value, stops) {
    const floor = stops[0] === undefined ? value : stops[0]
    const top = stops[stops.length - 1] === undefined ? value : stops[stops.length - 1]
    if (value < floor) return { span: RAMP_SPAN_LOW, mix: '0%' }
    if (value >= top) return { span: RAMP_SPAN_HIGH, mix: '0%' }
    let segment = 0
    for (let index = 1; index < stops.length - 1; index += 1) {
      const stop = stops[index]
      if (stop !== undefined && value >= stop) segment = index
    }
    const from = stops[segment] === undefined ? floor : stops[segment]
    const to = stops[segment + 1] === undefined ? top : stops[segment + 1]
    // 位置写成一位小数的百分比：精度比读数细两个量级，字符串也稳定，读数没变就不会重写 DOM。
    return { span: String(segment), mix: String(Math.round((value - from) / (to - from) * 1000) / 10) + '%' }
  }

  /* ==================================================================== */
  /* 数字轮                                                               */
  /* ==================================================================== */

  /**
   * 把读数拆成整数部分与那一位小数：先按调用方给的形状削掉首尾那两个不变的标记，再认中间那一段。
   *
   * 两个标记都是空串时（行尾统计没有后缀）就是「削掉零个字符」，所以「有没有标记」这一层不必单独判。
   * @param text - 97.3% 或 +96 这样的读数。
   * @param prefix - 前缀标记；没有时是空串。
   * @param suffix - 后缀标记；没有时是空串。
   * @returns 两截数字；形状对不上时是 null，调用方退回纯文本。
   */
  function splitReading(text, prefix, suffix) {
    if (!text.startsWith(prefix) || !text.endsWith(suffix)) return null
    const matched = REEL_READING_PATTERN.exec(text.slice(prefix.length, text.length - suffix.length))
    if (matched === null) return null
    const integer = matched[1]
    if (integer === undefined) return null
    return { integer: integer, decimal: matched[2] === undefined ? null : matched[2] }
  }

  /**
   * 一位数字：一个槽位，里头最多两个数字——现在的在文档流里，上一个压在它上面。
   *
   * 读数一变就把原来那个挪到「上一个」的位置，新数字接替它。key 用的是数字本身，所以**没变的那一位
   * 不会重新挂载**、也就不会播动画：读数一变就让每位都弹，看着像一直在抽。
   * @param props - 数字与次序（0 是最高位，低位起手更晚）。
   */
  function Digit(props) {
    const digit = props.digit
    const place = props.place
    const pairState = React.useState({ shown: digit, previous: null })
    const pair = pairState[0]
    const setPair = pairState[1]
    if (pair.shown !== digit) setPair({ shown: digit, previous: pair.shown })
    const delay = { animationDelay: String(place * REEL_STAGGER_MS) + 'ms' }
    const children = []
    if (pair.previous !== null) {
      children.push(h('span', {
        key: 'was-' + String(pair.previous),
        className: REEL_WAS_CLASS,
        style: delay,
      }, pair.previous))
    }
    children.push(h('span', {
      key: 'now-' + String(pair.shown),
      className: REEL_CELL_CLASS,
      style: delay,
    }, digit))
    return h('span', { className: REEL_SLOT_CLASS }, children)
  }

  /**
   * 这一截读数：开着时是几位数字加小数点与它首尾那两个标记，关着时是一段纯文本。
   *
   * 颜色不在这里：这一截**不写 color**，从调用方挂在它外面那一层继承；段标记与段内位置也归调用方写。
   * @param props - text / prefix / suffix / cadence / spoken。
   */
  function ReelText(props) {
    const text = props.text
    const prefix = props.prefix === undefined ? '' : props.prefix
    const suffix = props.suffix === undefined ? '%' : props.suffix
    const spoken = props.spoken === true
    const reading = splitReading(text, prefix, suffix)
    // 形状对不上（dsh 那边换了口径）时退回纯文本：这一截照旧是那个读数。
    if (reading === null) return h('span', { className: REEL_TEXT_CLASS }, text)
    const className = props.cadence === 'fast' ? REEL_TEXT_CLASS + ' ' + REEL_FAST_CLASS : REEL_TEXT_CLASS
    const digits = reading.integer.split('')
    const children = []
    // 首尾两个标记不弹，与数字位并排；它们跟着调用方给的形状走。
    if (prefix !== '') children.push(h('span', { key: 'prefix', className: REEL_STATIC_CLASS }, prefix))
    digits.forEach(function eachDigit(digit, index) {
      children.push(h(Digit, { key: 'd' + String(digits.length - 1 - index), digit: Number(digit), place: index }))
    })
    if (reading.decimal !== null) {
      children.push(h('span', { key: 'dot', className: REEL_STATIC_CLASS }, '.'))
      children.push(h(Digit, { key: 'decimal', digit: Number(reading.decimal), place: digits.length }))
    }
    if (suffix !== '') children.push(h('span', { key: 'suffix', className: REEL_STATIC_CLASS }, suffix))
    return h(Fragment, null,
      h('span', { className: className, 'aria-hidden': true }, children),
      spoken ? h('span', { className: REEL_SPOKEN_CLASS }, text) : null)
  }

  /**
   * 纯 DOM 那一份数字轮：给 dsh 自己渲染的文本节点旁边的读数用（上下文占用那串百分比）。
   *
   * 与 ReelText 同一套类名、同一条关键帧曲线，所以两处的翻动同款；差别只在「谁来建节点」。React 那一
   * 侧靠 key 让没变的那一位不重新挂载，这里靠 place 记账：形状没变时只重画变了的那一位，形状变了
   * （整数位数增减、小数位有无）整排重排——那正是 React 那边 key 移位时发生的事。
   *
   * 这一份只做百分比读数（后缀固定是 %），因为唯一的使用处就是上下文占用。
   * @param host - 容器挂在谁身上：被接管那一截读数的父级。
   * @param text - 第一帧的读数。
   * @returns 一个带 container / update / destroy 的写入器。
   */
  function createDomReel(host, text) {
    const container = document.createElement('span')
    container.className = REEL_TEXT_CLASS + ' ' + REEL_HOST_CLASS
    // 读屏读的是 dsh 自己那一截文本（它只是视觉上让位），这一棵是纯视觉的。
    container.setAttribute('aria-hidden', 'true')

    /** place 从右往左数（0 是最低位，-1 是那一位小数）→ 槽位元素。 */
    const slots = new Map()
    /** place → 这一格当前显示的数字。 */
    const shown = new Map()
    /** 上一帧的读数。 */
    let current = ''
    /** 上一帧的形状：整数位数加「有没有小数」。 */
    let shape = null

    /** 造一个静态小格（小数点、百分号）。 */
    function staticNode(content) {
      const node = document.createElement('span')
      node.className = REEL_STATIC_CLASS
      node.textContent = content
      return node
    }

    /** 造一格：清空之后放「上一个」与「现在」两个数字。 */
    function paintSlot(slot, previous, next, place) {
      while (slot.firstChild !== null) slot.removeChild(slot.firstChild)
      const delay = String(Math.max(0, place) * REEL_STAGGER_MS) + 'ms'
      if (previous !== null && previous !== undefined) {
        const was = document.createElement('span')
        was.className = REEL_WAS_CLASS
        was.style.animationDelay = delay
        was.textContent = String(previous)
        slot.appendChild(was)
      }
      const cell = document.createElement('span')
      cell.className = REEL_CELL_CLASS
      cell.style.animationDelay = delay
      cell.textContent = String(next)
      slot.appendChild(cell)
    }

    /**
     * 按形状重排这一排：整数位从高到低，然后（有小数时）小数点与那一位，最后是固定的百分号。
     * 槽位一并重造——形状变了意味着每一位的 place 都换了人，与 React 那边 key 移位同效。
     */
    function rebuild(integerLength, hasDecimal) {
      while (container.firstChild !== null) container.removeChild(container.firstChild)
      slots.clear()
      shown.clear()
      for (let place = integerLength - 1; place >= 0; place -= 1) {
        const slot = document.createElement('span')
        slot.className = REEL_SLOT_CLASS
        slots.set(place, slot)
        shown.set(place, null)
        container.appendChild(slot)
      }
      if (hasDecimal) {
        container.appendChild(staticNode('.'))
        const decimalSlot = document.createElement('span')
        decimalSlot.className = REEL_SLOT_CLASS
        slots.set(-1, decimalSlot)
        shown.set(-1, null)
        container.appendChild(decimalSlot)
      }
      container.appendChild(staticNode('%'))
    }

    /** 把读数写到这一排上；形状对不上时给 false，调用方留着原文本。 */
    function paint(nextText) {
      if (nextText === current) return true
      const parts = splitReading(nextText, '', '%')
      if (parts === null) return false
      const digits = parts.integer.split('')
      const hasDecimal = parts.decimal !== null
      const nextShape = String(digits.length) + (hasDecimal ? 'd' : '')
      if (nextShape !== shape) {
        rebuild(digits.length, hasDecimal)
        shape = nextShape
      }
      const wanted = new Map()
      digits.forEach(function eachDigit(digit, index) {
        wanted.set(digits.length - 1 - index, Number(digit))
      })
      if (hasDecimal) wanted.set(-1, Number(parts.decimal))
      for (const entry of wanted) {
        const place = entry[0]
        const digit = entry[1]
        const slot = slots.get(place)
        if (slot === undefined) continue
        const previous = shown.get(place)
        if (previous === null || previous === undefined || previous !== digit) {
          paintSlot(slot, previous, digit, place)
          shown.set(place, digit)
        }
      }
      current = nextText
      return true
    }

    paint(text)

    return {
      container: container,
      update: paint,
      /** 摘掉这一层：原文本回到原样。 */
      destroy: function destroy() {
        if (container.parentNode !== null) container.parentNode.removeChild(container)
      },
    }
  }

  /* ==================================================================== */
  /* 插入符位移                                                          */
  /* ==================================================================== */

  /**
   * 一个元素是不是本模块接管的可编辑面，是哪一种。
   * @param element - 通常是此刻拿着焦点的那个元素。
   * @returns rich 是主输入框，plain 是输入区里可编辑的 textarea，都不是时为 null。
   */
  function surfaceOf(element) {
    if (element.matches(COMPOSER_INPUT_SELECTOR)) return 'rich'
    if (element instanceof HTMLTextAreaElement && element.matches(COMPOSER_TEXTAREA_SELECTOR)) {
      return element.disabled || element.readOnly ? null : 'plain'
    }
    return null
  }

  /** 一个节点在它父节点里的下标；不是亲生的给 -1。 */
  function childIndex(parent, child) {
    let index = 0
    for (let node = parent.firstChild; node !== null; node = node.nextSibling) {
      if (node === child) return index
      index += 1
    }
    return -1
  }

  /**
   * 光标贴着的那个换行符。
   *
   * 量的是换行符自己，不是它所在的段落：段落可以有很多行，换行符的矩形却永远只有一行，高度还正好是
   * 字高。零矩形只发生在换行符旁边，所以这里找不到换行符就等于量不出来——调用方要把原生插入符还回
   * 去，不能拿一个猜出来的位置充数。
   */
  function nearestBreak(range) {
    const container = range.startContainer
    const offset = range.startOffset
    if (container instanceof HTMLBRElement) return { lineBreak: container, before: offset === 0 }
    if (container instanceof Text) {
      const parent = container.parentNode
      if (parent === null) return null
      const index = childIndex(parent, container)
      if (index < 0) return null
      if (offset === container.data.length) {
        const next = parent.childNodes[index + 1]
        if (next instanceof HTMLBRElement) return { lineBreak: next, before: true }
      }
      if (offset === 0) {
        const previous = parent.childNodes[index - 1]
        if (previous instanceof HTMLBRElement) return { lineBreak: previous, before: false }
      }
      return null
    }
    const next = container.childNodes[offset]
    if (next instanceof HTMLBRElement) return { lineBreak: next, before: true }
    const previous = container.childNodes[offset - 1]
    if (previous instanceof HTMLBRElement) return { lineBreak: previous, before: false }
    return null
  }

  /**
   * 输入框被清到连段落都没有时（切会话之后就是这样，DOM 是个空壳），量一根藏在页面角落里的同款换行符。
   *
   * 内容盒的第一行开头就是光标该在的地方，但那一行有多高、字盒在行里怎么摆，得从别处问。探针每帧
   * 现建现删，而且**不碰 dsh 的任何容器**——往输入框的容器里塞节点会惊动 React。
   * @returns 视口里的左、上、高；量不出来给 null。
   */
  function emptyLineBox(input) {
    const body = document.body
    if (body === null) return null
    const style = getComputedStyle(input)
    const probe = document.createElement('div')
    probe.style.cssText = 'position:fixed;top:0;left:0;visibility:hidden;pointer-events:none'
    probe.style.padding = style.padding
    probe.style.whiteSpace = 'pre-wrap'
    probe.style.fontFamily = style.fontFamily
    probe.style.fontSize = style.fontSize
    probe.style.fontWeight = style.fontWeight
    probe.style.fontStyle = style.fontStyle
    probe.style.lineHeight = style.lineHeight
    probe.appendChild(document.createElement('br'))
    body.appendChild(probe)
    const probeRect = probe.getBoundingClientRect()
    const breakElement = probe.firstElementChild
    const breakRect = breakElement === null ? null : breakElement.getBoundingClientRect()
    probe.remove()
    if (breakRect === null) return null
    // 探针的 padding 与输入框一致，所以这两个差值就是「内容盒起头」到「字盒起头」的距离。
    const inputRect = input.getBoundingClientRect()
    return {
      left: inputRect.left + (breakRect.left - probeRect.left),
      top: inputRect.top + (breakRect.top - probeRect.top),
      height: breakRect.height,
    }
  }

  /**
   * 富文本面上这一处折叠选区的视口矩形。
   * @returns 量不出来时为 null：调用方要把原生插入符还回去。
   */
  function measureRich(input, range) {
    const rect = range.getBoundingClientRect()
    if (rect.height > 0) return { left: rect.left, top: rect.top, height: rect.height }
    // 零矩形：光标贴着换行符——空段落（里面只有一根换行符）与软换行都是这条路的常客。量那个换行符
    // 自己，不要量它所在的段落。
    const anchor = nearestBreak(range)
    if (anchor === null) {
      // 输入框里连一个换行符都没有：没有东西可量，但内容盒的第一行开头就是光标的位置。里面有东西却
      // 找不到换行符，那是别的形状，不猜，把原生插入符还回去。
      if (input.firstChild !== null) return null
      return emptyLineBox(input)
    }
    const breakRect = anchor.lineBreak.getBoundingClientRect()
    if (anchor.before) return { left: breakRect.left, top: breakRect.top, height: breakRect.height }
    // 换行符之后是下一行的行首：横向退到段落的内容左边界，纵向走一行。
    const block = anchor.lineBreak.parentElement
    if (block === null) return null
    const lineHeight = Number.parseFloat(getComputedStyle(block).lineHeight)
    return {
      left: block.getBoundingClientRect().left,
      top: breakRect.top + (Number.isFinite(lineHeight) ? lineHeight : breakRect.height),
      height: breakRect.height,
    }
  }

  /**
   * 纯文本面上插入符的视口矩形，靠一层镜像量出来。
   *
   * 镜像是一个看不见的 div：样式从 textarea 上抄，宽度取它的内容区（刨掉滚动条），文本在插入符处
   * 断开——前半截是裸文本，后半截整个包进一个 span。span 第一段行盒的左上角就是插入符。后半截必须
   * 整段带上：软换行按整词走，只放前半截的话，正在打的那个词会留在上一行。后半截是空的（插入符在
   * 末尾）时放一个零宽空格占位，末尾那个换行符之后的空行才有行盒可量。
   *
   * 软换行处的偏移在镜像里天然落在下一行行首；upstream 为真（上一下是 End）时改量它前一个字符的
   * 右缘，也就是上一行的行尾——和原生那根在 End 之后画的位置一致。
   *
   * 镜像挂在 body 上、量完就摘，**不碰 dsh 的任何容器**。
   * @returns 量不出来时为 null：调用方要把原生插入符还回去。
   */
  function measurePlain(input, upstream) {
    const body = document.body
    if (body === null) return null
    const style = getComputedStyle(input)
    const mirror = document.createElement('div')
    mirror.style.cssText = 'position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;'
      + 'margin:0;border:0;box-sizing:content-box;height:auto;overflow:hidden'
    for (const name of MIRRORED_PROPERTIES) mirror.style.setProperty(name, style.getPropertyValue(name))
    const paddingX = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight)
    mirror.style.width = String(Math.max(0, input.clientWidth - (Number.isFinite(paddingX) ? paddingX : 0))) + 'px'
    // 调用方只在选区折叠时才来，起点终点是同一处。
    const caretAt = input.selectionEnd
    const marker = document.createElement('span')
    mirror.textContent = input.value.slice(0, caretAt)
    marker.textContent = input.value.slice(caretAt) || '\u200b'
    mirror.appendChild(marker)
    body.appendChild(mirror)
    const mirrorRect = mirror.getBoundingClientRect()
    let spot = marker.getClientRects()[0]
    let edge = spot === undefined ? undefined : spot.left
    const before = mirror.firstChild
    if (upstream && spot !== undefined && before instanceof Text && caretAt > 0 && input.value[caretAt - 1] !== '\n') {
      const previous = document.createRange()
      previous.setStart(before, caretAt - 1)
      previous.setEnd(before, caretAt)
      const rects = previous.getClientRects()
      const last = rects[rects.length - 1]
      // 前一个字符落在更上面的一行，才说明这里是软换行。
      if (last !== undefined && last.top < spot.top - 1) {
        spot = last
        edge = last.right
      }
    }
    mirror.remove()
    if (spot === undefined || edge === undefined) return null
    // 镜像没有边框，padding 与 textarea 一致，所以这两个差值就是插入符在 textarea 内边距盒里的位置；
    // 再扣掉 textarea 自己滚走的那一段。
    const inputRect = input.getBoundingClientRect()
    return {
      left: inputRect.left + input.clientLeft + (edge - mirrorRect.left) - input.scrollLeft,
      top: inputRect.top + input.clientTop + (spot.top - mirrorRect.top) - input.scrollTop,
      height: spot.height,
    }
  }

  /**
   * 把一个视口矩形裁进 textarea 露出来的那一段。自绘的那根不在 textarea 里面，textarea 的裁剪管不到
   * 它：内部滚动时插入符滚出可视区，原生那根跟着消失，这一根也得自己消失。
   * @returns 裁剩的矩形；整个被裁掉时为 null。
   */
  function clipToField(input, box) {
    const inputRect = input.getBoundingClientRect()
    const clipTop = inputRect.top + input.clientTop
    const clipBottom = clipTop + input.clientHeight
    const top = Math.max(box.top, clipTop)
    const bottom = Math.min(box.top + box.height, clipBottom)
    if (bottom - top < 1) return null
    return { left: box.left, top: top, height: bottom - top }
  }

  /**
   * 给整页装上插入符动效。
   *
   * 上游的三档开关在这里固定成默认档「无论何时」：每一格都滑一下。上游的「关」那一档是这条路的兜底
   * （读者看不见光标是唯一真正会伤人的失效方式），这里仍然守着同一条兜底——任何一次测量失败都把原生
   * 插入符还回去。
   * @returns 卸载入口。
   */
  function installCaretMotion() {
    /** 每个可编辑面一份自绘状态。同屏只有一个面拿着焦点，所以这里通常只有一项。 */
    const layers = new Map()
    /** 一次同步已经排在下一帧。 */
    let queued = false
    /** 已经排出去的那一帧；0 表示没有。卸载时要能把它连同回调一起取消。 */
    let frameHandle = 0
    /**
     * 卸载之后一律不做。
     *
     * 帧回调与 syncAfterFocusChange 里那个定时器都可能还在路上：让它们跑完，sync 会重建自绘的那根、
     * 重新挂上观察者，而原生插入符的让位标记已经在卸载时摘掉了——读者看到的是「原生被按下去了、
     * 自绘的又不在」，也就是没有光标。
     */
    let disposed = false
    /**
     * 上一次挪动插入符的是 End 键。
     *
     * 软换行处的同一个偏移有两个位置：上一行的行尾与下一行的行首。textarea 不交出「偏向哪一边」，而
     * Chromium 在 End 之后画在行尾、其余时候（打字、方向键、Home）画在行首——所以记住这一下。
     */
    let endKeyed = false

    const queue = function queue() {
      if (disposed || queued) return
      queued = true
      frameHandle = requestAnimationFrame(function onFrame() {
        frameHandle = 0
        queued = false
        if (disposed) return
        sync()
      })
    }

    /** 记下这一次挪窝是不是 End（带 Shift 的是在选字，没有插入符可画）。 */
    const noteKey = function noteKey(event) {
      if (event.key === 'Shift' || event.key === 'Control' || event.key === 'Meta' || event.key === 'Alt') return
      endKeyed = event.key === 'End' && !event.shiftKey
    }

    /** 指针落下去的位置由浏览器自己定，不再沿用上一次 End 的偏向。 */
    const clearEndKey = function clearEndKey() {
      endKeyed = false
    }

    /**
     * 纯文本面自己滚了一下：自绘的那根不在它里面，不会跟着走，得重量。
     *
     * scroll 不冒泡，所以这是捕获阶段的监听，页面上每一次滚动都会路过这里——只认已经接管的面。
     */
    const followPlainScroll = function followPlainScroll(event) {
      const target = event.target
      if (!(target instanceof HTMLTextAreaElement) || !layers.has(target)) return
      queue()
    }

    /**
     * 可编辑面的内容、可编辑性或者身份变了。
     *
     * selectionchange 覆盖不了这些静默变化：清空草稿如果没顺带动选区，浏览器一个事件都不发；切会话时
     * Lexical 还在绑 editor，contenteditable 会短暂变成 false，浏览器随即把焦点收走，等它变回来又是
     * 一个事件都没有。这里补上那个缺口。纯文本面不走这条：它的内容不在 DOM 里。
     */
    const contentObserver = new MutationObserver(function onContentChange() {
      queue()
    })

    /** 盯住一个富文本面。同一个面盯多次是幂等的，选项以最后一次为准。 */
    const observeComposer = function observeComposer(input) {
      contentObserver.observe(input, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['contenteditable', 'data-composer-input', CHIP_SELECTED_ATTRIBUTE],
      })
    }

    /** 焦点在这个面上，却还没有自绘的那根——切会话留下的空窗就是它。 */
    const needsTakeover = function needsTakeover() {
      const active = document.activeElement
      if (!(active instanceof HTMLElement) || surfaceOf(active) === null) return false
      return !active.hasAttribute(CARET_ATTRIBUTE)
    }

    /**
     * 焦点换了之后再补看一次。
     *
     * 切会话时「焦点离开旧的」和「焦点落到新的」之间隔着几帧，中间不会有任何事件——浏览器迁移选区是
     * 静默的，有时连 focusin 都等不到（新元素刚建出来、editor 还没绑上）。两个方向都接，因为不知道
     * 哪一边才是这条路上最后一声。只在还没接管时才补，已经画好的那根不去打扰它，否则闪烁会被重新起拍。
     */
    const syncAfterFocusChange = function syncAfterFocusChange() {
      queue()
      window.setTimeout(function onSettle() {
        if (disposed) return
        if (needsTakeover()) queue()
      }, FOCUS_SETTLE_MS)
    }

    const hide = function hide(layer) {
      layer.caret.removeAttribute(CARET_VISIBLE_ATTRIBUTE)
      layer.visible = false
    }

    /** 把一个面的自绘状态整个撤掉：那一根、让位标记、以及替它补过的定位上下文。 */
    const release = function release(input, layer) {
      layer.caret.remove()
      input.removeAttribute(CARET_ATTRIBUTE)
      if (layer.markedHost) layer.host.removeAttribute(CARET_HOST_ATTRIBUTE)
    }

    /** 这个可编辑面上的自绘插入符；没有就建一根。 */
    const layerFor = function layerFor(input) {
      const host = input.parentElement
      if (host === null) return null
      const known = layers.get(input)
      if (known !== undefined && known.host === host) {
        // React 重渲染会把挂上去的那根一起摘掉，重新挂回去，并当作刚露头重新就位。
        if (known.caret.isConnected) return known
        host.appendChild(known.caret)
        known.visible = false
        return known
      }
      // 父元素换了人：旧的那一份整个撤掉，按新的父元素重建。
      if (known !== undefined) {
        release(input, known)
        layers.delete(input)
      }
      // 自绘的那根按容器的内边距盒定位，容器必须是定位上下文。不是的话补一个标记，由样式表把它变成
      // relative——作答框的字段层与排队行都是这样。display 为 contents 的容器自己没有盒子，补了也没
      // 用：宁可不动手，让原生插入符留在原地。
      const hostStyle = getComputedStyle(host)
      if (hostStyle.display === 'contents') return null
      const markedHost = hostStyle.position === 'static'
      if (markedHost) host.setAttribute(CARET_HOST_ATTRIBUTE, '')
      const caret = document.createElement('div')
      caret.setAttribute(CARET_LAYER_ATTRIBUTE, '')
      host.appendChild(caret)
      if (input.isContentEditable) observeComposer(input)
      const layer = { caret: caret, visible: false, host: host, markedHost: markedHost }
      layers.set(input, layer)
      return layer
    }

    /**
     * 接管那一刻读下原生插入符的颜色，自绘的那根照着画。
     *
     * 只在让位标记还没写上时读得到：写上之后算出来的就是 transparent 了。auto 的意思是跟字色走。
     */
    const adoptCaretColor = function adoptCaretColor(input, layer) {
      const style = getComputedStyle(input)
      const color = style.caretColor === 'auto' ? style.color : style.caretColor
      layer.caret.style.setProperty(CARET_COLOR_PROPERTY, color)
    }

    /**
     * 把自绘的光标放到这个视口矩形上。
     * @param layer - 那一根。
     * @param box - 视口矩形。
     */
    const draw = function draw(layer, box) {
      // 绝对定位按容器的内边距盒算，而且跟着容器自己的滚动走：矩形差值里扣掉边框、加回滚走的量。
      const hostRect = layer.host.getBoundingClientRect()
      // 对齐到整像素。原生插入符就落在像素网格上，而落在分数位置的矩形会被抗锯齿抹开一圈灰边，看起来
      // 和它不是一套。代价是位置最多偏半像素，看不出来。
      const left = Math.round(box.left - hostRect.left - layer.host.clientLeft + layer.host.scrollLeft)
      const top = Math.round(box.top - hostRect.top - layer.host.clientTop + layer.host.scrollTop)

      // 刚露头的那一帧必须瞬时就位，下一帧再把过渡接回来，否则它要从上次停的地方滑过来。
      const fresh = !layer.visible
      if (fresh) layer.caret.style.transitionProperty = 'none'
      layer.caret.style.transform = 'translate(' + left + 'px, ' + top + 'px)'
      layer.caret.style.height = box.height + 'px'
      if (fresh) {
        requestAnimationFrame(function restoreTransition() {
          layer.caret.style.transitionProperty = ''
        })
      }
      if (fresh) {
        layer.visible = true
        layer.caret.setAttribute(CARET_VISIBLE_ATTRIBUTE, '')
      }
      // 每挪一次都让闪烁重新起拍：否则赶上「灭」的那半周期，读者会以为光标没跟上来。只认闪烁那一条。
      // getAnimations() 里也有正在跑的位移过渡（它自己就是被这个方法读到的），把那条也拉回起点的话，
      // 连续打字就变成一格一格地卡——光标永远落在上一格的插值位置上。
      if (typeof layer.caret.getAnimations === 'function' && typeof CSSAnimation !== 'undefined') {
        for (const animation of layer.caret.getAnimations()) {
          if (animation instanceof CSSAnimation && animation.animationName === CARET_BLINK_NAME) animation.currentTime = 0
        }
      }
    }

    /** 这一帧的光标归谁。 */
    const sync = function sync() {
      const selection = document.getSelection()
      const active = document.activeElement
      const kind = active instanceof HTMLElement ? surfaceOf(active) : null
      // 焦点落在富文本面上就先盯住它，哪怕此刻还不可编辑：切会话时 contenteditable 会短暂变成 false，
      // 等它变回来的时候，只有盯着属性才等得到那一下。
      if (kind === 'rich' && active instanceof HTMLElement) observeComposer(active)
      // 光标只出现在**正拿着焦点**的那个可编辑面上：hero 态的输入框没有可编辑面，多会话时也只有一个面
      // 拿着焦点。选了字（合成中选中候选词也算）时不该有它。
      let target = null
      let range = null
      if (kind === 'rich' && active instanceof HTMLElement && active.isContentEditable
        && selection !== null && selection.isCollapsed && selection.rangeCount > 0) {
        const candidate = selection.getRangeAt(0)
        if (active.contains(candidate.startContainer)) {
          target = active
          range = candidate
        }
      }
      if (kind === 'plain' && active instanceof HTMLTextAreaElement && active.selectionStart === active.selectionEnd) {
        target = active
      }
      // 命令 chip 被选中时 dsh 把原生插入符按掉了：那一下不是光标，自绘的那根也藏起来。
      if (target !== null && target.hasAttribute(CHIP_SELECTED_ATTRIBUTE)) {
        target = null
        range = null
      }
      for (const entry of layers) {
        const input = entry[0]
        const layer = entry[1]
        // 切会话会把整个输入区换掉，提问卡片答完、排队行存完也会整块卸掉，跟着它走的那根一并撤掉。
        if (!input.isConnected) {
          release(input, layer)
          layers.delete(input)
          continue
        }
        if (input === target) continue
        // 光标不归它，或者干脆没有光标：自绘的那根藏起来，原生插入符还回去。让位标记只在「此刻真的有
        // 一根自绘的光标」时才存在，其余任何时候撤掉它都是安全的。
        hide(layer)
        input.removeAttribute(CARET_ATTRIBUTE)
      }
      if (target === null) return
      const layer = layerFor(target)
      if (layer === null) return
      const measured = target instanceof HTMLTextAreaElement
        ? measurePlain(target, endKeyed)
        : (range === null ? null : measureRich(target, range))
      // 让位标记只在真正画出一根之后才写。画不出来时把原生插入符还回去——「原生已透明、自绘没画」是这
      // 套动效唯一真正会伤到读者的失效方式，任何一次测量失败都必须退回原点，而不是维持现状。
      if (measured === null) {
        target.removeAttribute(CARET_ATTRIBUTE)
        hide(layer)
        return
      }
      if (!target.hasAttribute(CARET_ATTRIBUTE)) adoptCaretColor(target, layer)
      // 纯文本面内部滚走的那一截不画。这不是测量失败——原生那根这时也看不见——所以标记照写。
      const box = target instanceof HTMLTextAreaElement ? clipToField(target, measured) : measured
      if (box === null) hide(layer)
      else draw(layer, box)
      target.setAttribute(CARET_ATTRIBUTE, '')
    }

    document.addEventListener('selectionchange', queue)
    document.addEventListener('focusin', syncAfterFocusChange)
    document.addEventListener('focusout', syncAfterFocusChange)
    // 软换行处偏向哪一边的判据：上一下是不是 End。捕获阶段听，免得被谁拦在半路。
    document.addEventListener('keydown', noteKey, true)
    document.addEventListener('pointerdown', clearEndKey, true)
    document.addEventListener('scroll', followPlainScroll, { capture: true, passive: true })
    window.addEventListener('resize', queue)
    // 自带的那两份字体是后到的，折行随之变化，光标要重新量一次。
    const fontSets = document.fonts
    if (fontSets !== undefined && typeof fontSets.addEventListener === 'function') {
      fontSets.addEventListener('loadingdone', queue)
    }

    return {
      dispose: function dispose() {
        disposed = true
        if (frameHandle !== 0) cancelAnimationFrame(frameHandle)
        frameHandle = 0
        document.removeEventListener('selectionchange', queue)
        document.removeEventListener('focusin', syncAfterFocusChange)
        document.removeEventListener('focusout', syncAfterFocusChange)
        document.removeEventListener('keydown', noteKey, true)
        document.removeEventListener('pointerdown', clearEndKey, true)
        document.removeEventListener('scroll', followPlainScroll, true)
        window.removeEventListener('resize', queue)
        if (fontSets !== undefined && typeof fontSets.removeEventListener === 'function') {
          fontSets.removeEventListener('loadingdone', queue)
        }
        contentObserver.disconnect()
        for (const entry of layers) release(entry[0], entry[1])
        layers.clear()
      },
    }
  }

  /* ==================================================================== */
  /* 上下文占用饼                                                        */
  /* ==================================================================== */

  /**
   * 一枚饼的样子：一整枚圆，被一条折点在圆心的折线切开，已占用那一块沿角平分线推出去一段。
   *
   * 缺口就是那一块原来的位置，盘上因此留下同形状的一块空位；两块的间距（缝宽）恒定——那道缝由
   * 「洞口比那一块大一圈」给出，见 pushImage。
   * @param percent - 已占用的百分比。
   * @param tone - 已占用那一块的颜色。
   * @param rest - 剩下那一块的颜色。
   * @returns 可以直接当 background-image 用的 url()。
   */
  function pieImage(percent, tone, rest) {
    // 两头都单独走：满值时那道缝会与盘面的边界重合、而且「切了一刀还占满」本就说不通；空值时该画的是
    // 一枚完整的灰盘（什么都没有，也不该有缝）。两档都画整圆，不切。
    if (percent >= 100) return inlineSvg('<path d="' + discPath(CENTER, CENTER, RADIUS) + '" fill="' + tone + '"/>')
    if (percent <= 0) return inlineSvg('<path d="' + discPath(CENTER, CENTER, RADIUS) + '" fill="' + rest + '"/>')
    const occupied = percent / 100 * 360
    return pushImage(occupied, tone, rest, SLICE_GAP, SLICE_LIFT)
  }

  /**
   * 推出去：两块是**全等**的扇形，一块留在原位（那就是盘上的缺口），另一块沿角平分线挪开 lift。
   *
   * 缝宽恒定，而且不靠位移挣：盘上挖掉的不是「那一条扇形」，而是**它再向外一圈 seam**——所以缝环绕那
   * 一块的整条边界（两条直边、外缘弧、顶点那一头），处处一样宽，与推开多远无关。那一圈缝由一条遮罩
   * 画出来：把扇形的 path 描一道两倍 seam 宽的粗边，外侧那一半就是缝（内侧那一半落在那一块自己的地界
   * 里，挖掉也无妨）。
   *
   * 盘面的半径由位移定（PIE_SIZE 减 lift 的一半），整幅图的外接尺寸恒为 PIE_SIZE，推开的那一侧不会被
   * 这一格的容器裁掉；圆心仍沿角平分线的反面退半个 lift，整幅图这才落在容器正中。
   */
  function pushImage(occupied, tone, rest, seam, lift) {
    const direction = occupied / 2
    const halfAngleSin = Math.sin(rad(direction))
    const halfAngleCos = Math.cos(rad(direction))
    const half = lift / 2
    const centerX = round2(CENTER - half * halfAngleSin)
    const centerY = round2(CENTER + half * halfAngleCos)
    const apexX = round2(centerX + lift * halfAngleSin)
    const apexY = round2(centerY - lift * halfAngleCos)
    const slice = sectorPath(apexX, apexY, PUSH_RADIUS, 0, occupied)
    const plate = '<path d="' + discPath(centerX, centerY, PUSH_RADIUS) + ' ' + slice
      + '" fill="' + rest + '" fill-rule="evenodd" mask="url(#' + SLICE_MASK_ID + ')"/>'
    return inlineSvg(sliceGapMask(slice, seam) + plate + '<path d="' + slice + '" fill="' + tone + '"/>')
  }

  /**
   * 那一圈缝的遮罩：整幅图铺白，再把那一条扇形的 path 描一道宽边涂黑——涂黑处透明。
   *
   * 描边以 path 为中心向两侧各扩半个缝宽（stroke-width 是两倍 seam）：外侧那一半是缝，内侧那一半落在
   * 那一块自己的地界里，挖掉也不影响。拐角用 round，顶点那一头因此是一段圆角的缝，与两条直边同宽。
   */
  function sliceGapMask(slice, seam) {
    return '<mask id="' + SLICE_MASK_ID + '" maskUnits="userSpaceOnUse" x="0" y="0"'
      + ' width="' + PIE_SIZE + '" height="' + PIE_SIZE + '">'
      + '<rect x="0" y="0" width="' + PIE_SIZE + '" height="' + PIE_SIZE + '" fill="#ffffff"/>'
      + '<path d="' + slice + '" fill="none" stroke="#000000" stroke-width="' + seam * 2
      + '" stroke-linejoin="round"/>'
      + '</mask>'
  }

  /**
   * 一整圈：两段半圆拼起来。不能只用一段弧——起点与终点重合时，那段弧按 SVG 的规矩会被整段忽略。
   */
  function discPath(cx, cy, radius) {
    const x = round2(cx)
    const top = round2(cy - radius)
    const bottom = round2(cy + radius)
    return 'M ' + x + ' ' + top
      + ' A ' + radius + ' ' + radius + ' 0 1 1 ' + x + ' ' + bottom
      + ' A ' + radius + ' ' + radius + ' 0 1 1 ' + x + ' ' + top + ' Z'
  }

  /**
   * 一角扇形：从顶点出发，走到 from 度那一点，再沿弧顺时针走到 to 度。盘面与那一块都用它、用同一组角度
   * 与半径，差别只有顶点落在哪。
   */
  function sectorPath(cx, cy, radius, from, to) {
    const x = round2(cx)
    const y = round2(cy)
    const x0 = round2(cx + radius * Math.sin(rad(from)))
    const y0 = round2(cy - radius * Math.cos(rad(from)))
    const x1 = round2(cx + radius * Math.sin(rad(to)))
    const y1 = round2(cy - radius * Math.cos(rad(to)))
    // 过了半个圈要走大弧，否则圆弧会挑另一侧那条近路。
    const largeArc = to - from > 180 ? 1 : 0
    return 'M ' + x + ' ' + y + ' L ' + x0 + ' ' + y0
      + ' A ' + radius + ' ' + radius + ' 0 ' + largeArc + ' 1 ' + x1 + ' ' + y1 + ' Z'
  }

  /** 度换弧度。0 度是 12 点，顺时针为正。 */
  function rad(degrees) {
    return degrees / 360 * FULL_TURN
  }

  /** 把一段图元包成一张可以直接当背景图的 SVG。 */
  function inlineSvg(body) {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + PIE_SIZE + ' ' + PIE_SIZE + '">'
      + body + '</svg>'
    return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")'
  }

  /** 两位小数，给 path 坐标用。 */
  function round2(value) {
    return Math.round(value * PATH_PRECISION) / PATH_PRECISION
  }

  /** 系统说「减少动态效果」：扩张那一下不跑，直接落定。 */
  function reduceMotion() {
    if (typeof globalThis.matchMedia !== 'function') return false
    return globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches === true
  }

  /**
   * 装上上下文占用饼。
   *
   * 坞那一层带 data-composer-dock，比例圆与统计胶囊都是它的直接子元素；认过就记住，换会话把它换掉时
   * 重认。真正的形状判据在 paint 里，认不出就什么都不做。
   *
   * 观察交给套件的公共扫掠（rt.observe）：流式期间每一次字符变化都会叫到那里，一帧最多认一次。
   * @returns 卸下这一处：断开观察，并把写过的标记、属性、数字轮与内联样式撤干净。
   */
  function installContextMeterPie() {
    let dock = null
    /** 每一枚饼当前的状态；键是那颗按钮。 */
    const painted = new Map()
    /** 这一处写过的按钮（含只写了色阶、饼没画成的那些）。卸载时按它撤。 */
    const touched = new Set()
    /** 被接管的那一截读数 → 它的数字轮写入器。 */
    const reels = new Map()
    /** 量未占用底色的探针；第一次真要画时才建。 */
    let restProbe = null

    /**
     * 未占用那一块的底色：样式表里那条规则把它混出来，这里读的是**求值后**的 background-color。
     *
     * 读自定义属性不行——非注册的自定义属性算出来还是 color-mix 那串文本，不是一个颜色。所以借一枚看
     * 不见的探针，让 CSS 自己算。
     */
    const restColor = function restColor() {
      if (document.body === null) return ''
      if (restProbe === null || !restProbe.isConnected) {
        restProbe = document.createElement('span')
        restProbe.className = REST_PROBE_CLASS
        document.body.appendChild(restProbe)
      }
      return getComputedStyle(restProbe).backgroundColor
    }

    /** 把读数对应的那张图写进那颗按钮。 */
    const paintImage = function paintImage(trigger, percent, tone, rest) {
      trigger.style.backgroundImage = pieImage(percent, tone, rest)
    }

    /**
     * 推一帧：把这一枚饼从起点的读数推到终点的读数。
     *
     * 缓动是收尾那一种（与数字轮那条 CSS 曲线同一档）。JS 里没有现成的三次贝塞尔求值，为一条曲线搬进
     * 来一个求解器不值——220ms 上两者的差别看不出来。
     */
    const advance = function advance(trigger, now) {
      const record = painted.get(trigger)
      if (record === undefined) return
      const progress = Math.min(1, (now - record.startedAt) / GROW_MS)
      if (progress >= 1) {
        record.percent = record.to
        record.handle = 0
        paintImage(trigger, record.to, record.tone, record.rest)
        return
      }
      const eased = 1 - Math.pow(1 - progress, 3)
      record.percent = record.from + (record.to - record.from) * eased
      paintImage(trigger, record.percent, record.tone, record.rest)
      record.handle = requestAnimationFrame(function nextStep(next) { advance(trigger, next) })
    }

    /**
     * 把读数对应的那张图画进那颗按钮，落在原来那枚图标所占据的那一格上。
     *
     * 底色与扇形色都从计算样式里读：段标记刚写上去，读数那一截的 color 就是这一档的颜色。读不到色就
     * 什么都不画——那说明样式表没上（或者名字改了），此时代替原来的环会是一块空白，不如让原环留着。
     * @returns 这一帧接上了没有；没接上时调用方不该让原环让位。
     */
    const paintPie = function paintPie(trigger, target, reading) {
      const tone = getComputedStyle(reading).color
      const rest = restColor()
      if (tone === '' || rest === '') return false

      const existing = painted.get(trigger)
      // 读数与色都没变、也没有一帧在跑：不写第二遍。
      if (existing !== undefined && existing.handle === 0 && existing.percent === target
        && existing.tone === tone && existing.rest === rest) return true
      // 上一次还在跑就被新读数打断了：从它当前显示的那一格接着往新目标走，不从起点重来。
      if (existing !== undefined && existing.handle !== 0) cancelAnimationFrame(existing.handle)
      const from = existing === undefined ? 0 : existing.percent

      // 背景图那四个属性只在接管时写一次，之后的每一帧只换图。
      if (existing === undefined) {
        trigger.style.backgroundRepeat = 'no-repeat'
        trigger.style.backgroundSize = PIE_SIZE + 'px ' + PIE_SIZE + 'px'
        // 内容框的原点就是图标那一格的左边缘；饼比那一格宽 2px，起点往左借一半才与图标同心。
        trigger.style.backgroundOrigin = 'content-box'
        trigger.style.backgroundPosition = -(PIE_SIZE - ICON_SIZE) / 2 + 'px center'
      }

      const record = {
        percent: from,
        handle: 0,
        tone: tone,
        rest: rest,
        from: from,
        to: target,
        startedAt: performance.now(),
      }
      painted.set(trigger, record)
      paintImage(trigger, from, tone, rest)
      // 刚挂上就从 0 长出来（与数字轮那个先例一致），以及读数没变、系统要求减少动态效果：都不跑帧。
      if (from === target || reduceMotion()) {
        record.percent = target
        paintImage(trigger, target, tone, rest)
        return true
      }
      record.handle = requestAnimationFrame(function firstStep(now) { advance(trigger, now) })
      return true
    }

    /**
     * 在读数那一截旁边放上（或更新）数字轮。
     *
     * 挂的位置是那一截读数的**父级**（那颗按钮），不是读数自己里面——这一处唯一脆的地方就在这里。dsh
     * 用 React 渲染那个读数 span，读数一变它走 setTextContent：它在「首尾是同一个文本节点」时才只改
     * nodeValue，否则整段重设 textContent，**连带清掉我们塞进去的节点**。塞在读数里的写法因此每次读数
     * 更新都被抹掉一次（挂上、被抹、再挂），流式期间几乎看不见；更糟的是那一截的 textContent 会读成
     * 26%26%，判据随即认不出读数，连饼也不再重画。挂在父级上没有这两回事：React 只管它自己那两个子
     * 节点（图标与读数），我们这一个它不感知。
     */
    const paintReel = function paintReel(host, reading, text) {
      if (READING_PATTERN.exec(text) === null) return false
      reading.setAttribute(REEL_TAKEOVER_ATTRIBUTE, '')
      const existing = reels.get(reading)
      if (existing !== undefined && existing.writer.container.isConnected && existing.host === host) {
        existing.writer.update(text)
        existing.text = text
        return true
      }
      if (existing !== undefined) {
        existing.writer.destroy()
        reels.delete(reading)
      }
      const writer = createDomReel(host, text)
      reels.set(reading, { writer: writer, host: host, text: text })
      return true
    }

    /**
     * 认一枚比例圆：读它的百分比，把色阶的段与位置写到按钮上，再给读数挂上数字轮、把饼画成按钮的背景图。
     * @param root - 候选元素；认不出来就什么都不做。
     */
    const paint = function paint(root) {
      const trigger = root.querySelector(PIE_TRIGGER_SELECTOR)
      if (!(trigger instanceof HTMLElement) || trigger.querySelector('svg') === null) return
      const reading = trigger.querySelector('span')
      if (!(reading instanceof HTMLElement)) return
      const text = reading.textContent === null ? '' : reading.textContent.trim()
      const matched = READING_PATTERN.exec(text)
      if (matched === null) return
      const captured = matched[1]
      if (captured === undefined) return

      const percent = Number(captured)
      const ramp = rampPosition(percent, CONTEXT_STOPS)
      touched.add(trigger)
      // 值没变就不写：属性与内联样式虽然不喂观察者（那只盯 childList 与 characterData），但每次同步都
      // 重写一遍会让样式失效白白重算。
      if (trigger.getAttribute(RAMP_SPAN_ATTRIBUTE) !== ramp.span) {
        trigger.setAttribute(RAMP_SPAN_ATTRIBUTE, ramp.span)
      }
      if (trigger.style.getPropertyValue(RAMP_POSITION_VAR) !== ramp.mix) {
        trigger.style.setProperty(RAMP_POSITION_VAR, ramp.mix)
      }
      // 数字轮挂在那串读数的旁边（按钮上），不是它里面。
      paintReel(trigger, reading, text)
      // 先让位、再读色：让位与色阶都由这条属性开门，属性晚一步的话 getComputedStyle 读到的还是 dsh 给
      // 那颗按钮的默认文字色——饼会画成灰的，而且要等到下一次 DOM 变化才会重画。
      root.setAttribute(CONTEXT_PIE_ATTRIBUTE, '')
      // 画不出来就把属性撤回去：原环还在，读者看到的是一个环，而不是「环被藏起来、饼又没有」的空格。
      if (!paintPie(trigger, percent, reading)) root.removeAttribute(CONTEXT_PIE_ATTRIBUTE)
    }

    /**
     * 这一轮要认的候选。坞那一层带 data-composer-dock，比例圆与统计胶囊都是它的直接子元素。
     * @returns 候选元素；页面上还没有输入框时是空的。
     */
    const candidates = function candidates() {
      if (dock !== null && dock.isConnected) return Array.from(dock.children)
      dock = document.querySelector(COMPOSER_DOCK_SELECTOR)
      return dock === null ? [] : Array.from(dock.children)
    }

    const sync = function sync() {
      for (const candidate of candidates()) {
        if (!(candidate instanceof HTMLSpanElement)) continue
        if (candidate.hasAttribute(STAT_ATTRIBUTE)) continue
        paint(candidate)
      }
      // 换会话会把整个输入坞换掉：跟着它走的数字轮一并撤掉，否则容器留在已断开的节点上。
      for (const entry of Array.from(reels.entries())) {
        const reading = entry[0]
        const record = entry[1]
        if (reading.isConnected && record.writer.container.isConnected) continue
        record.writer.destroy()
        reading.removeAttribute(REEL_TAKEOVER_ATTRIBUTE)
        reels.delete(reading)
      }
    }

    /** 把写过的标记、色阶、数字轮与内联样式撤干净，让原环原样回来。 */
    const releaseAll = function releaseAll() {
      for (const entry of reels) {
        entry[1].writer.destroy()
        entry[0].removeAttribute(REEL_TAKEOVER_ATTRIBUTE)
      }
      reels.clear()
      for (const root of document.querySelectorAll('[' + CONTEXT_PIE_ATTRIBUTE + ']')) {
        root.removeAttribute(CONTEXT_PIE_ATTRIBUTE)
      }
      for (const trigger of touched) {
        const record = painted.get(trigger)
        if (record !== undefined && record.handle !== 0) cancelAnimationFrame(record.handle)
        trigger.removeAttribute(RAMP_SPAN_ATTRIBUTE)
        trigger.style.removeProperty(RAMP_POSITION_VAR)
        trigger.style.removeProperty('background-image')
        trigger.style.removeProperty('background-repeat')
        trigger.style.removeProperty('background-size')
        trigger.style.removeProperty('background-origin')
        trigger.style.removeProperty('background-position')
      }
      painted.clear()
      touched.clear()
      if (restProbe !== null && restProbe.parentNode !== null) restProbe.parentNode.removeChild(restProbe)
      restProbe = null
      dock = null
    }

    const unobserve = rt.observe(sync)
    sync()

    return function dispose() {
      unobserve()
      releaseAll()
    }
  }

  /* ==================================================================== */
  /* 命中率胶囊                                                          */
  /* ==================================================================== */

  /**
   * 一份镜像：把 dsh 自己那份 ui-chat 表单里的某个字段接到 React 的订阅上。
   *
   * 这个座位只有一处安装，读者在设置页改完不必重新安装任何东西，所以取值与订阅都收在这一份里。
   * @param initial - 表单缺席时的取值。
   * @param pick - 从表单取值里挑出这个字段。
   */
  function createSettingMirror(initial, pick) {
    let current = initial
    const listeners = new Set()
    return {
      read: function read() { return current },
      subscribe: function subscribe(listener) {
        listeners.add(listener)
        return function off() { listeners.delete(listener) }
      },
      /** 把一份共享表单接上这一份镜像；没有这一份表单时保持默认值。 */
      adopt: function adopt(form) {
        if (form === undefined || form === null || typeof form.subscribe !== 'function') {
          return function noop() {}
        }
        const apply = function apply() {
          let next = initial
          try {
            const snapshot = form.getSnapshot()
            const value = snapshot === undefined || snapshot === null ? undefined : snapshot.value
            next = pick(value)
          } catch (error) {
            next = initial
          }
          if (next === current) return
          current = next
          for (const listener of listeners) listener()
        }
        let off = null
        try {
          off = form.subscribe(apply)
        } catch (error) {
          off = null
        }
        apply()
        return typeof off === 'function' ? off : function noop() {}
      },
    }
  }

  /** 档位镜像：简洁只留命中率读数，详细另给 token 总量与明细。 */
  const usageModeMirror = createSettingMirror(DEFAULT_PERFORMANCE_USAGE, function pickMode(section) {
    if (section === undefined || section === null) return DEFAULT_PERFORMANCE_USAGE
    return section.performanceUsage === 'compact' ? 'compact' : DEFAULT_PERFORMANCE_USAGE
  })

  /** 订阅档位；ui-chat 那一份表单变了就重画。 */
  function useUsageMode() {
    return React.useSyncExternalStore(usageModeMirror.subscribe, usageModeMirror.read)
  }

  /** primitives 缺席时的退化钩子：两者都不动，只是让 hook 调用次数保持恒定。 */
  function useNoPosition() { return null }
  function useNoDismiss() {}

  /** 一个永远不返回投影的座位，供 useProjection 缺席时顶上。 */
  function useNoProjection() { return undefined }

  /** 把兜底文案里的占位符换掉。 */
  function interpolate(template, params) {
    if (params === undefined) return template
    return template.replace(/\{(\w+)\}/g, function replace(match, name) {
      return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
    })
  }

  /**
   * 文案：先问 seat 给的那一支 t（它绑在 chat 命名空间上，内置那一枚用的就是它），键落空时退回本组件
   * 自带的那一份。t 在套件里不是必有的：某个部署若不向这个客户端暴露那一份字典，t 会把键原样吐回来。
   */
  function tr(t, key, params, fallback) {
    if (typeof t === 'function') {
      try {
        const text = t(key, params)
        if (typeof text === 'string' && text !== '' && text !== key) return text
      } catch (error) {
        /* 落到兜底那一份 */
      }
    }
    return interpolate(fallback, params)
  }

  /** 三个互不重叠的输入计费桶之和。 */
  function billedInputTokens(usage) {
    return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
  }

  /**
   * 命中率文本，恒一位小数。
   *
   * 先把千分之一的整数单位算出来再落成文本，躲开浮点误差在 x.x5 上翻面。部分命中不许读成满命中：舍进
   * 100.0 但没有全中的压回 99.9。
   * @returns 97.3 这样的文本；没有计过价的输入时是 null。
   */
  function formatHitPercent(cacheReadTokens, billed) {
    if (billed === 0) return null
    const units = Math.round(cacheReadTokens * PERCENT_UNITS_PER_TENTH / billed)
    const capped = cacheReadTokens < billed && units > PERCENT_UNITS_CAP ? PERCENT_UNITS_CAP : units
    return (capped / 10).toFixed(1)
  }

  /** 命中率那一截的文本与色阶位置；没有计过价的输入时是 null。 */
  function hitReading(cacheReadTokens, billed) {
    const percent = formatHitPercent(cacheReadTokens, billed)
    if (percent === null) return null
    return { text: percent + '%', tone: rampPosition(Number(percent), HIT_TONE_STOPS) }
  }

  /** 进位之后的缩放数：过百取整，否则留一位小数。 */
  function scaledCount(value) {
    return value >= 100 ? String(Math.round(value)) : String(Math.round(value * 10) / 10)
  }

  /** 紧凑的 token 计数：517 / 12.2K / 517K / 1.2M，与 dsh 的 formatTokens 同规则。 */
  function formatTokens(value, t) {
    if (value < THOUSAND) return String(value)
    if (value < MILLION) return tr(t, 'number.thousand', { value: scaledCount(value / THOUSAND) }, '{value}K')
    return tr(t, 'number.million', { value: scaledCount(value / MILLION) }, '{value}M')
  }

  /** 精确 token 计数，带千分位。 */
  function formatExactTokens(value, t) {
    const digits = String(value)
    const groups = []
    for (let end = digits.length; end > 0; end -= GROUP_SIZE) {
      groups.unshift(digits.slice(Math.max(0, end - GROUP_SIZE), end))
    }
    return groups.join(tr(t, 'number.groupSeparator', undefined, ','))
  }

  /** 明细里的一行：精确计数加 chat 自己的计数单位。 */
  function exactCount(value, t) {
    return tr(t, 'message.turnUsage.count', { count: formatExactTokens(value, t) }, '{count} tok')
  }

  /**
   * 明细面板的键盘与外部点击关闭，与内置的 stat 弹窗同一条规则：Escape 关，点到触发点与面板之外也关
   * ——后者走捕获阶段，让键盘激活旁边那个胶囊时这一颗先关掉，而不是两张面板叠在一起。
   */
  function useEscapeAndOutsideClick(open, setOpen, rootRef, panelRef) {
    React.useEffect(function subscribe() {
      if (!open) return undefined
      const onKeyDown = function onKeyDown(event) {
        if (event.key === 'Escape') setOpen(false)
      }
      const onClick = function onClick(event) {
        if (event.target instanceof Node
          && (rootRef.current === null || !rootRef.current.contains(event.target))
          && (panelRef.current === null || !panelRef.current.contains(event.target))) {
          setOpen(false)
        }
      }
      document.addEventListener('keydown', onKeyDown)
      document.addEventListener('click', onClick, true)
      return function unsubscribe() {
        document.removeEventListener('keydown', onKeyDown)
        document.removeEventListener('click', onClick, true)
      }
    }, [open, setOpen, rootRef, panelRef])
  }

  /**
   * 输入框下方那枚「缓存命中」胶囊。
   *
   * dsh 在 conversation.composer.dock 上发两个座位条目（activity order 0、usage order 1），同一个 id 与
   * 同一个 order 上按 priority 取最低的那个渲染，内置那两个是默认的 0。这一枚用 -1 遮蔽掉 usage 重画一
   * 份：命中率恒取一位小数，并按 90%~99% 的无极色阶取色——低于 90% 一律红，90.0 起由红经橙黄、黄、
   * 黄绿、浅绿走到 99.0 的深绿，99.0 及以后都是深绿，不必等到 100.0；判据用的是显示值本身。
   *
   * 色阶涂在「缓存命中 + 读数」那一组上，所以那个名字与读数同色；详细档里的 token 总量与中间那个分隔点
   * 在这一组之外，留在胶囊自己的文字色上。
   */
  function CacheHitPill(props) {
    const t = props.t
    const project = typeof props.useProjection === 'function' ? props.useProjection : useNoProjection
    const usage = project('tokenUsage')
    const mode = useUsageMode()
    const openState = React.useState(false)
    const open = openState[0]
    const setOpen = openState[1]
    const rootRef = React.useRef(null)
    const panelRef = React.useRef(null)
    const interactive = uiAnchoredPosition !== null && uiDismissOutside !== null
    const anchoredPosition = uiAnchoredPosition === null ? useNoPosition : uiAnchoredPosition
    const dismissOutside = uiDismissOutside === null ? useNoDismiss : uiDismissOutside
    const position = anchoredPosition({
      open: open,
      anchorRef: rootRef,
      panelRef: panelRef,
      side: 'top',
      gap: PANEL_GAP,
      margin: PANEL_MARGIN,
    })
    dismissOutside(rootRef, open, setOpen, panelRef)
    useEscapeAndOutsideClick(open, setOpen, rootRef, panelRef)
    if (usage === undefined || usage === null) return null
    const billedInput = billedInputTokens(usage)
    // 这一场没有计过账时是 null，与内置同一条闸门。
    if (billedInput === 0 && usage.outputTokens === 0) return null

    const hit = hitReading(usage.cacheReadTokens, billedInput)
    const icon = IconDatabase === undefined ? null : h(IconDatabase, null)
    const hitLabel = tr(t, 'message.turnUsage.cacheHit', undefined, '缓存命中')
    // 「缓存命中」这几个字与它后面那串读数是一组，色阶就挂在这一组上（见样式表），名字与读数因此同色。
    // 数字轮那一截自己不带颜色，从这一组继承。
    let reading = null
    if (hit !== null) {
      const readingStyle = {}
      readingStyle[RAMP_POSITION_VAR] = hit.tone.mix
      const readingProps = { className: CACHE_HIT_READING_CLASS, style: readingStyle }
      readingProps[RAMP_SPAN_ATTRIBUTE] = hit.tone.span
      reading = h('span', readingProps, hitLabel, ' ', h(ReelText, { text: hit.text, rolling: true, spoken: true }))
    }

    if (mode === 'compact') {
      if (reading === null) return null
      return h('span', { className: CACHE_HIT_ANCHOR_CLASS, 'data-composer-stat': USAGE_STAT_ID },
        h('span', { className: CACHE_HIT_PILL_CLASS },
          icon,
          h('span', { className: CACHE_HIT_LABEL_CLASS }, reading)))
    }

    const total = billedInput + usage.outputTokens
    const totalText = tr(t, 'message.turnUsage.count', { count: formatTokens(total, t) }, '{count} tok')
    const title = tr(t, 'stats.dialog.usageTitle', undefined, 'Token 用量')
    const summary = hit === null ? totalText : totalText + ' · ' + hitLabel + ' ' + hit.text
    const labelChildren = [totalText]
    if (reading !== null) {
      labelChildren.push(h('span', { key: 'sep', className: CACHE_HIT_SEP_CLASS, 'aria-hidden': true }, '·'))
      labelChildren.push(reading)
    }
    // primitives 缺席：不弹明细，只把读数摆出来（与内置的静态胶囊同形）。
    if (!interactive) {
      return h('span', { className: CACHE_HIT_ANCHOR_CLASS, 'data-composer-stat': USAGE_STAT_ID },
        h('span', { className: CACHE_HIT_PILL_CLASS },
          icon,
          h('span', { className: CACHE_HIT_LABEL_CLASS }, labelChildren)))
    }
    const panel = h('div', {
      ref: panelRef,
      className: CACHE_HIT_PANEL_CLASS,
      role: 'dialog',
      'aria-label': title,
      style: position === null || position === undefined ? MEASURE_STYLE : position,
    },
    h('div', { className: CACHE_HIT_TITLE_CLASS },
      h('span', { className: CACHE_HIT_TITLE_LABEL_CLASS }, icon, title),
      h('span', { className: CACHE_HIT_TITLE_VALUE_CLASS }, exactCount(total, t))),
    h('div', { className: CACHE_HIT_RULE_CLASS, 'aria-hidden': true }),
    h('dl', { className: CACHE_HIT_DETAILS_CLASS },
      hit === null ? null : h(Fragment, null,
        h('dt', null, hitLabel),
        h('dd', null, hit.text)),
      h('dt', null, tr(t, 'message.turnUsage.input', undefined, '未缓存输入')),
      h('dd', null, exactCount(usage.uncachedInputTokens, t)),
      h('dt', null, tr(t, 'message.turnUsage.cacheRead', undefined, '缓存读取')),
      h('dd', null, exactCount(usage.cacheReadTokens, t)),
      usage.cacheWriteTokens === 0 ? null : h(Fragment, null,
        h('dt', null, tr(t, 'message.turnUsage.cacheWrite', undefined, '缓存写入')),
        h('dd', null, exactCount(usage.cacheWriteTokens, t))),
      h('dt', null, tr(t, 'message.turnUsage.output', undefined, '输出')),
      h('dd', null, exactCount(usage.outputTokens, t))))

    return h('span', { ref: rootRef, className: CACHE_HIT_ANCHOR_CLASS, 'data-composer-stat': USAGE_STAT_ID },
      h('button', {
        type: 'button',
        className: CACHE_HIT_PILL_CLASS,
        'aria-haspopup': 'dialog',
        'aria-expanded': open,
        'aria-label': summary,
        onClick: function onClick() { setOpen(!open) },
      }, icon, h('span', { className: CACHE_HIT_LABEL_CLASS }, labelChildren)),
      open
        ? (createPortal === null ? panel : createPortal(panel, document.body))
        : null)
  }

  /**
   * 遮蔽 conversation.composer.dock 上的 usage 座位，换成自带一位小数与六档取色的那一枚。
   *
   * 座位注册在 inject 的回调里而不是装配时，因为 slots 服务可能还没就位；inject 会等它而不是抛错。
   *
   * 座位声明的 locale 是 chat：内置那两枚用的就是它，message.turnUsage 与 stats.dialog 这两组键都在
   * 那个命名空间里。换一个命名空间，t 会把键原样吐回来，胶囊上就会显示 key 本身。
   */
  function installCacheHitPill() {
    /**
     * 这个座位只该注册一次。slots 服务会在条目表变化时再跑一遍注册工厂，而同 id 同 priority 的第二次
     * register 会抛错；所以工厂自己记住状态：第二次直接把组件还回去，不再注册。
     */
    let registered = false
    let release = null
    rt.ctx.inject(['slots'], function registerSeat(scope) {
      if (registered) return
      try {
        scope.slots.inject(SLOT_NAME, function factory() {
          if (registered) return CacheHitPill
          registered = true
          try {
            release = scope.slots.register({
              name: SLOT_NAME,
              id: USAGE_STAT_ID,
              order: USAGE_STAT_ORDER,
              priority: USAGE_STAT_PRIORITY,
              locale: CHAT_NAMESPACE,
            }, CacheHitPill)
          } catch (error) {
            rt.warn('chat-motion: usage seat not taken over (' + String(error) + ')')
          }
          return CacheHitPill
        })
      } catch (error) {
        rt.warn('chat-motion: usage seat not taken over (' + String(error) + ')')
      }
    })
    rt.effect(function () {
      return function () {
        if (typeof release === 'function') release()
        release = null
        registered = false
      }
    }, 'chat-motion: usage seat')
  }

  /* ==================================================================== */
  /* 样式表                                                               */
  /* ==================================================================== */

  const STYLESHEET = `
/* ------------------------------------------------------------------ *
 * 色阶与动效常量
 *
 * 七个色调全部从语义令牌派生：红与绿走状态色，中间那几档在它们之间按 OKLab 混。上游那一组
 * #cf222e / #7ee787 之类的字面值因此一个都不留，深浅两套也不用各写一份——语义令牌自己会跟着主题
 * 解析。
 * ------------------------------------------------------------------ */
body {
  --dshui-cm-tone-red: var(--dshui-danger);
  --dshui-cm-tone-red-orange: color-mix(in oklab, var(--dshui-danger) 65%, var(--dshui-warn) 35%);
  --dshui-cm-tone-orange: color-mix(in oklab, var(--dshui-danger) 30%, var(--dshui-warn) 70%);
  --dshui-cm-tone-yellow: var(--dshui-warn);
  --dshui-cm-tone-lime: color-mix(in oklab, var(--dshui-warn) 50%, var(--dshui-success) 50%);
  --dshui-cm-tone-green-light: color-mix(in oklab, var(--dshui-warn) 18%, var(--dshui-success) 82%);
  --dshui-cm-tone-green: var(--dshui-success);

  /* 数字轮：常规档五百毫秒，高频档二百二十毫秒，低位比高位晚七十毫秒起手。 */
  --dshui-cm-reel-cell: 20px;
  --dshui-cm-reel-turn: 500ms;
  --dshui-cm-reel-turn-fast: 220ms;

  /* 饼里「未占用」那一块的底色：借语义文字色混出来，读色那一侧取的是求值后的颜色。 */
  --dshui-cm-context-rest: color-mix(in oklab, var(--dshui-text-tertiary) 32%, transparent);
}

/* 量底色用的探针：形状归零、不可见、不参与命中测试，只让 CSS 把颜色算出来。 */
.${REST_PROBE_CLASS} {
  position: fixed;
  left: 0;
  top: 0;
  width: 0;
  height: 0;
  visibility: hidden;
  pointer-events: none;
  background: var(--dshui-cm-context-rest);
}

/* ------------------------------------------------------------------ *
 * 插入符位移
 *
 * 三条规则：把原生插入符按下去，给挂那根的父元素补定位上下文，把自绘的那根画出来。前两条只认脚本写
 * 上的标记——脚本半途没跑起来时一条规则都不命中，原生插入符还在。这是这套动效唯一真正会伤人的地方
 * （读者看不见光标），所以隐藏永远由脚本自己开启，CSS 不先斩后奏。
 *
 * 需要压过的是 dsh 自己给每种面定的 caret-color：主输入框与作答框都是一个类（0-1-0）。下面那两条是
 * 两个属性选择器（0-2-0）与「标签 + 属性」（0-1-1），都赢。
 *
 * 自绘的那根会落进别人的容器里当子元素，容器给子元素定的规则也会落到它身上——作答框的字段层就给每
 * 个子元素写了 grid-area、padding 与一整套字体。所以它自己的规则用三个同名属性选择器抬到 0-3-0，并且
 * 把会改变盒子大小与位置的那几项全部显式写回去。
 *
 * 过渡的是 transform 而不是 top/left：没有理由为一次光标位移付布局的代价。
 * ------------------------------------------------------------------ */
[data-composer-input][${CARET_ATTRIBUTE}],
textarea[${CARET_ATTRIBUTE}] {
  caret-color: transparent;
}

/* 挂那根的父元素原本不是定位上下文时才有这个标记。它们都没有绝对定位的后代，所以这一条不改任何布局。 */
[${CARET_HOST_ATTRIBUTE}] {
  position: relative;
}

[${CARET_LAYER_ATTRIBUTE}][${CARET_LAYER_ATTRIBUTE}] {
  position: absolute;
  top: 0;
  left: 0;
  grid-area: auto;
  box-sizing: content-box;
  width: 2px;
  min-width: 0;
  max-width: none;
  min-height: 0;
  max-height: none;
  margin: 0;
  padding: 0;
  border: 0;
  visibility: hidden;
  pointer-events: none;
  /* 颜色是接管那一刻从这个面的原生插入符上读下来的；读到之前退回 dsh 给主输入框定的那一支。 */
  background: var(${CARET_COLOR_PROPERTY}, var(--dshui-business, currentColor));
  transition: transform var(--dshui-duration-instant) var(--dshui-ease-standard);
  will-change: transform;
  /* 原生那根被按下去了，闪烁得自己来。 */
  animation: ${CARET_BLINK_NAME} 1s step-end infinite;
}

[${CARET_LAYER_ATTRIBUTE}][${CARET_LAYER_ATTRIBUTE}][${CARET_VISIBLE_ATTRIBUTE}] {
  visibility: visible;
}

@keyframes ${CARET_BLINK_NAME} {
  50% { opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  /* 连闪烁一起停：这一档要的是少动，恒亮的光标正好是上游 solid 档的样子。 */
  [${CARET_LAYER_ATTRIBUTE}][${CARET_LAYER_ATTRIBUTE}] {
    transition: none;
    animation: none;
  }
}

/* ------------------------------------------------------------------ *
 * 数字轮：变了的那一位原地弹一下
 *
 * 一位上最多两个数字（现在的、上一个），落在同一个槽位上各播一段短动画：新的从下方 6px 处淡入，旧的
 * 朝反方向淡出；两条用同一条带过冲的曲线。位移只有 6px，四周接得住，不需要裁切窗口。
 *
 * 这两条动画里只有 transform 与 opacity，一件非合成属性的活都没有；数字位自己还常驻一个 will-change
 * （层要在动画之前就建好）。
 *
 * 行高只写一个数（20px）：字形盒放在里面，上下各余一点，读者换字体也裁不到；小数点与百分号跟着用同一
 * 个行高，所以数字与它们必然齐平，不靠对齐属性去凑。
 *
 * 字号写在这一层自己身上，不靠父级给：接管那一处的父级是 dsh 的按钮，它的字号 dsh 自己会按主题与字号
 * 档位重算，靠继承就意味着读者把正文调大之后接管方必须跟着重算。自带一份反而稳。
 * ------------------------------------------------------------------ */
.${REEL_TEXT_CLASS} {
  display: inline-flex;
  align-items: center;
  height: var(--dshui-cm-reel-cell);
  font-size: calc(var(--dsh-content-font-size-secondary, 13px) - 1px);
}

/* 高频那一档：只换时长，位移、曲线、错峰起手都不动。 */
.${REEL_FAST_CLASS} {
  --dshui-cm-reel-turn: var(--dshui-cm-reel-turn-fast);
}

/* 一位数：一个槽位。现在的数字在文档流里（槽宽由它决定），上一个数字绝对定位压在同一个位置上。 */
.${REEL_SLOT_CLASS} {
  display: block;
  position: relative;
  /* 胶囊挤的时候，这一位也不许被压窄。 */
  flex: none;
  height: var(--dshui-cm-reel-cell);
}

/* 现在的那个数字：从下方落回来。终态零位移——动画走完，数字就落在它本来的位置上。
 *
 * 这里用 backwards 而不是 both：填满终态会把动画里那套声明一直挂在元素上，而它与没动过的那几位
 * （小数点、百分号、没变的数字）就不是同一条渲染路径了。backwards 只覆盖延迟那一段（每位错开起手时
 * 需要），结束后元素回到干净的静态态。
 *
 * will-change 常驻：属性是合成的还不够，元素得有自己那一层。切会话时读数这一位是**新挂载**的，动画起
 * 手那一刻正是主线程最忙的时候，等那时才决定建层就晚了。 */
.${REEL_CELL_CLASS} {
  display: block;
  height: 100%;
  line-height: var(--dshui-cm-reel-cell);
  text-align: center;
  will-change: transform, opacity;
  animation: dsh-cm-reel-in var(--dshui-cm-reel-turn) var(--dshui-ease-spring) backwards;
}

/* 上一个数字：朝反方向淡出，走完停在自己的零透明度上，不碍事。它必须**脱离文档流**压在同一个槽位上：
 * 两个 display 为 block 的格子上下排的话，槽位会被撑成两格高，读数整行跟着长高。 */
.${REEL_WAS_CLASS} {
  display: block;
  position: absolute;
  inset: 0;
  line-height: var(--dshui-cm-reel-cell);
  text-align: center;
  will-change: transform, opacity;
  animation: dsh-cm-reel-out var(--dshui-cm-reel-turn) var(--dshui-ease-spring) both;
}

@keyframes dsh-cm-reel-in {
  from {
    transform: translateY(6px);
    opacity: 0;
  }
  to {
    transform: none;
    opacity: 1;
  }
}

@keyframes dsh-cm-reel-out {
  from {
    transform: none;
    opacity: 1;
  }
  to {
    transform: translateY(-6px);
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  /* 系统说「减少动态效果」：两个数字都不动，上一个直接不显示。 */
  .${REEL_CELL_CLASS},
  .${REEL_WAS_CLASS} {
    animation: none;
  }

  .${REEL_WAS_CLASS} {
    display: none;
  }
}

/* 小数点与百分号也进同一个行盒：三处行高相同，数字与它们必然齐平。
 * flex 那条不能省：胶囊挤的时候，flex 会先把没有固定尺寸的小数点压成零宽——读者那边就是「小数点
 * 不见了」。 */
.${REEL_STATIC_CLASS} {
  display: block;
  flex: none;
  height: var(--dshui-cm-reel-cell);
  line-height: var(--dshui-cm-reel-cell);
}

/* 给读屏的那一份读数：视觉上藏起来，读出来还是 97.3%。 */
.${REEL_SPOKEN_CLASS} {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

/* ------------------------------------------------------------------ *
 * 上下文占用饼
 *
 * 这一处只管三件事：把原环留成占位（不塌格）、给出色阶、给出未占用那一角的底色。饼本身由脚本画：内联
 * SVG 作为那颗按钮的背景图，几何在 JS 里算。
 *
 * 为什么不用伪元素加 conic-gradient（那种写法不碰内联样式，本来更干净）：dsh 的主题把 corner-shape 全
 * 局设成 superellipse(1.5)（连前后两个伪元素一起），任何 border-radius 为 50% 的盒子都画成圆角方块；
 * 而伪元素又只能从自定义属性里取值。改成自己画一张图，这两处一起绕开。
 * ------------------------------------------------------------------ */

/* 原环让位但不塌格：图标那一格还在原处，饼就是按那一格画的。 */
[${CONTEXT_PIE_ATTRIBUTE}] button > svg {
  visibility: hidden;
}

/* 读数与饼同色（就是下面那条 color 算出来的色）。字号按输入框下方另一枚胶囊那一份来，同样减 1px：dsh
 * 自己这两处本来就差 1px，于是同一行里两个挨着的数字不一样大，读者一眼看得出不齐。 */
[${CONTEXT_PIE_ATTRIBUTE}] button > span {
  font-size: calc(var(--dsh-content-font-size-secondary, 13px) - 1px);
}

/* 接管之后原文本让位：视觉上收起，读屏照旧读得到。不用 display 为 none（文本节点不生成盒子，藏了读屏
 * 也没了），也不用字号归零——那一手要靠接手方从父级那里把字号再拿回来，多一层继承；这里用惯常的
 * 「视觉隐藏」：绝对定位加 1px 加裁剪，既不占位也不显示。
 *
 * 绝对定位同时把这一截从按钮那个 flex 行里摘出去——图标与它之间那道 6px 的间隔也就不再算它——接手的
 * 数字轮（挂在按钮上）紧跟在图标后面，落点与原来的读数完全一样。 */
[${CONTEXT_PIE_ATTRIBUTE}] button > span[${REEL_TAKEOVER_ATTRIBUTE}] {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  white-space: nowrap;
  clip-path: inset(50%);
}

/* 六个色标：20 绿、24 浅绿、28 黄、32 橙黄、36 橙红、40 红。低于 20 一律绿，40 及以后一律红——读者不
 * 必等到 50 才看见红。段规则只把这一段的两个端点挂上去（端点只是引用那组共用的色调，主题不同解析出来
 * 的就不同），插值交给浏览器的 color-mix；两条饱和段只有一个端点，所以恒色。 */
[${CONTEXT_PIE_ATTRIBUTE}] [${RAMP_SPAN_ATTRIBUTE}='${RAMP_SPAN_LOW}'] {
  --dshui-cm-context-from: var(--dshui-cm-tone-green);
}

[${CONTEXT_PIE_ATTRIBUTE}] [${RAMP_SPAN_ATTRIBUTE}='0'] {
  --dshui-cm-context-from: var(--dshui-cm-tone-green);
  --dshui-cm-context-to: var(--dshui-cm-tone-green-light);
}

[${CONTEXT_PIE_ATTRIBUTE}] [${RAMP_SPAN_ATTRIBUTE}='1'] {
  --dshui-cm-context-from: var(--dshui-cm-tone-green-light);
  --dshui-cm-context-to: var(--dshui-cm-tone-yellow);
}

[${CONTEXT_PIE_ATTRIBUTE}] [${RAMP_SPAN_ATTRIBUTE}='2'] {
  --dshui-cm-context-from: var(--dshui-cm-tone-yellow);
  --dshui-cm-context-to: var(--dshui-cm-tone-orange);
}

[${CONTEXT_PIE_ATTRIBUTE}] [${RAMP_SPAN_ATTRIBUTE}='3'] {
  --dshui-cm-context-from: var(--dshui-cm-tone-orange);
  --dshui-cm-context-to: var(--dshui-cm-tone-red-orange);
}

[${CONTEXT_PIE_ATTRIBUTE}] [${RAMP_SPAN_ATTRIBUTE}='4'] {
  --dshui-cm-context-from: var(--dshui-cm-tone-red-orange);
  --dshui-cm-context-to: var(--dshui-cm-tone-red);
}

/* 40 及以后：不必等到 50，两端都是红。 */
[${CONTEXT_PIE_ATTRIBUTE}] [${RAMP_SPAN_ATTRIBUTE}='${RAMP_SPAN_HIGH}'] {
  --dshui-cm-context-from: var(--dshui-cm-tone-red);
}

/* 扇形色与读数色是同一个：色只写在这一处，脚本把它读出来涂进 SVG。兜底那一条给的是段起点色（撑不起
 * color-mix 时退成六档取色），读数与饼仍然同色。 */
[${CONTEXT_PIE_ATTRIBUTE}] button > span {
  color: var(--dshui-cm-context-from, currentColor);
}

/* 括号里必须是一个「属性 冒号 值」的声明。写成裸的函数调用会被规范归入「未知的函数形式」而恒为假，
 * 整块规则静默跳过。 */
@supports (color: color-mix(in oklch, red, blue 50%)) {
  [${CONTEXT_PIE_ATTRIBUTE}] button > span {
    color: color-mix(
      in oklch,
      var(--dshui-cm-context-from),
      var(--dshui-cm-context-to, var(--dshui-cm-context-from)) var(${RAMP_POSITION_VAR}, 0%)
    );
  }
}

/* ------------------------------------------------------------------ *
 * 缓存命中胶囊
 *
 * 这一处遮蔽了 dsh 在 conversation.composer.dock 上 id 为 usage 的那个座位，所以内置的胶囊皮肤与
 * stat 弹窗皮肤都要在这里重写一份——那两套类名带构建期 hash，既拿不到、也不能当接口。尺寸、令牌与节奏
 * 逐条对齐，只有命中率那一处是新的：它按 90%~99% 的无极色阶取色。色阶涂在「缓存命中 + 读数」那一组
 * 上，所以那个名字与读数同色。
 * ------------------------------------------------------------------ */
.${CACHE_HIT_ANCHOR_CLASS} {
  display: inline-flex;
  min-width: 0;
  font-size: calc(var(--dsh-content-font-size-secondary, 13px) - 1px);
  line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px));
}

.${CACHE_HIT_PILL_CLASS} {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  box-sizing: border-box;
  max-width: 100%;
  padding: 1px 8px;
  border: none;
  /* 与 dsh 0.2.1-rc.1 起统计控件的小圆角一致。 */
  border-radius: var(--dshui-radius-sm);
  background: transparent;
  color: var(--dshui-text-tertiary);
  font: inherit;
  font-variant-numeric: tabular-nums;
  line-height: inherit;
  white-space: nowrap;
}

.${CACHE_HIT_PILL_CLASS} svg {
  width: 14px;
  height: 14px;
  flex: none;
}

/* 只有能点开明细的 button 形才邀请交互；静态读数保持三级文字色。 */
button.${CACHE_HIT_PILL_CLASS} {
  cursor: pointer;
}

button.${CACHE_HIT_PILL_CLASS}:hover,
button.${CACHE_HIT_PILL_CLASS}[aria-expanded='true'] {
  background: var(--dshui-surface-hover);
  color: var(--dshui-text-secondary);
}

.${CACHE_HIT_LABEL_CLASS} {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.${CACHE_HIT_SEP_CLASS} {
  color: var(--dshui-text-dimmed);
  margin: 0 6px;
}

/* 色阶挂在「缓存命中 + 读数」这一组上：那几个字与读数同色。同一行里的 token 总量与那个分隔点不在这一组
 * 里，仍留在胶囊自己的三级文字色上；这一组自带颜色，所以胶囊 hover 时它不跟着变，色阶一路看得见。
 *
 * 颜色分两步走：下面这几条段规则把这一组的两个端点挂在 --dshui-cm-hit-from 与 --dshui-cm-hit-to 上，
 * 脚本只写一个段内位置。这一处敢套两层 var()，是因为读这些色值的只有浏览器自己——没有任何 JS 去
 * getComputedStyle。 */

/* 低于 90%：两端都是红，所以插值恒等于红，不另开一档颜色。 */
.${CACHE_HIT_READING_CLASS}[${RAMP_SPAN_ATTRIBUTE}='${RAMP_SPAN_LOW}'] {
  --dshui-cm-hit-from: var(--dshui-cm-tone-red);
}

.${CACHE_HIT_READING_CLASS}[${RAMP_SPAN_ATTRIBUTE}='0'] {
  --dshui-cm-hit-from: var(--dshui-cm-tone-red);
  --dshui-cm-hit-to: var(--dshui-cm-tone-orange);
}

.${CACHE_HIT_READING_CLASS}[${RAMP_SPAN_ATTRIBUTE}='1'] {
  --dshui-cm-hit-from: var(--dshui-cm-tone-orange);
  --dshui-cm-hit-to: var(--dshui-cm-tone-yellow);
}

.${CACHE_HIT_READING_CLASS}[${RAMP_SPAN_ATTRIBUTE}='2'] {
  --dshui-cm-hit-from: var(--dshui-cm-tone-yellow);
  --dshui-cm-hit-to: var(--dshui-cm-tone-lime);
}

.${CACHE_HIT_READING_CLASS}[${RAMP_SPAN_ATTRIBUTE}='3'] {
  --dshui-cm-hit-from: var(--dshui-cm-tone-lime);
  --dshui-cm-hit-to: var(--dshui-cm-tone-green-light);
}

.${CACHE_HIT_READING_CLASS}[${RAMP_SPAN_ATTRIBUTE}='4'] {
  --dshui-cm-hit-from: var(--dshui-cm-tone-green-light);
  --dshui-cm-hit-to: var(--dshui-cm-tone-green);
}

/* 99.0 及以后：不必等到 100.0，两端都是深绿。 */
.${CACHE_HIT_READING_CLASS}[${RAMP_SPAN_ATTRIBUTE}='${RAMP_SPAN_HIGH}'] {
  --dshui-cm-hit-from: var(--dshui-cm-tone-green);
}

/* 撑不起 color-mix 的浏览器停在段起点色上：退成六档取色，读数、布局与翻动一个都不受影响。段标记也没写
 * 上时退回胶囊自己的文字色，而不是变成看不出的一团。 */
.${CACHE_HIT_READING_CLASS} {
  color: var(--dshui-cm-hit-from, currentColor);
}

@supports (color: color-mix(in oklch, red, blue 50%)) {
  .${CACHE_HIT_READING_CLASS} {
    color: color-mix(
      in oklch,
      var(--dshui-cm-hit-from),
      var(--dshui-cm-hit-to, var(--dshui-cm-hit-from)) var(${RAMP_POSITION_VAR}, 0%)
    );
  }
}

/* 明细面板：菜单面、突出阴影，与内置的 stat 弹窗同一层。定位由 primitives 的锚定钩子给。 */
.${CACHE_HIT_PANEL_CLASS} {
  position: fixed;
  z-index: calc(var(--dshui-z-menu) + 100);
  box-sizing: border-box;
  width: max-content;
  min-width: min(300px, calc(100vw - 24px));
  max-width: min(440px, calc(100vw - 24px));
  padding: 16px;
  border: 0;
  border-radius: var(--dshui-radius-lg);
  background: var(--dshui-surface-menu);
  backdrop-filter: var(--dshui-backdrop-blur);
  --dsw-elevation-stroke-color: var(--dshui-border-1);
  box-shadow: var(--dshui-shadow-3);
  font-size: 12px;
  line-height: 18px;
  color: var(--dshui-text-secondary);
  cursor: default;
}

.${CACHE_HIT_TITLE_CLASS} {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 8px;
  color: var(--dshui-text-primary);
  font-weight: 500;
}

.${CACHE_HIT_TITLE_LABEL_CLASS} {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.${CACHE_HIT_TITLE_LABEL_CLASS} svg {
  width: 14px;
  height: 14px;
  flex: none;
}

.${CACHE_HIT_TITLE_VALUE_CLASS} {
  font-variant-numeric: tabular-nums;
}

.${CACHE_HIT_RULE_CLASS} {
  margin-bottom: 10px;
  border-top: 0.5px solid var(--dshui-border-2);
}

.${CACHE_HIT_DETAILS_CLASS} {
  display: grid;
  grid-template-columns: minmax(76px, auto) minmax(0, 1fr);
  gap: 6px 16px;
  margin: 0;
  color: var(--dshui-text-tertiary);
}

.${CACHE_HIT_DETAILS_CLASS} dt,
.${CACHE_HIT_DETAILS_CLASS} dd {
  min-width: 0;
  margin: 0;
}

.${CACHE_HIT_DETAILS_CLASS} dd {
  color: var(--dshui-text-secondary);
  font-variant-numeric: tabular-nums;
  text-align: right;
}
`

  /* ==================================================================== */
  /* 装配                                                                 */
  /* ==================================================================== */

  // 一张样式表承载这一半的全部内容：插入符、数字轮、饼、胶囊。先装它，后面几块的效果才不会有一帧裸奔。
  rt.effect(function installSheet() {
    const removeSheet = rt.style('chat-motion', STYLESHEET)
    return function uninstallSheet() {
      removeSheet()
    }
  }, 'chat-motion: stylesheet')

  // 上游的开关在这里固定成默认档：插入符「无论何时」、饼与转轮常开。装与卸都在这一处，卸载时三块各把
  // 自己的监听、属性与内联样式撤干净。
  rt.effect(function installCaret() {
    const handle = installCaretMotion()
    return function uninstallCaret() {
      handle.dispose()
    }
  }, 'chat-motion: caret motion')

  rt.effect(function installPie() {
    return installContextMeterPie()
  }, 'chat-motion: context meter pie')

  installCacheHitPill()

  // ui-chat 那一份表单只读一个字段：简洁 / 详细。读不到就按 dsh 自己的默认档「详细」走。
  try {
    rt.ctx.inject(['configForms'], function onForms(scope) {
      let form = null
      try {
        form = scope.configForms.get(CHAT_SETTINGS_NAMESPACE)
      } catch (error) {
        form = null
      }
      if (form === null || form === undefined) return undefined
      return usageModeMirror.adopt(form)
    })
  } catch (error) {
    /* 没有 configForms 服务：保持默认档 */
  }
}
