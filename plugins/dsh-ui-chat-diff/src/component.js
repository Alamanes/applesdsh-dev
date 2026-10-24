/**
 * run_code 内部的 write / edit 子调用行。
 *
 * 内置的文件变更行只给**根调用**画 diff 卡片，行尾那个「+96 -0」因此只出现在直接调用的
 * write/edit 上；从 run_code 的程序里派发出去的子调用拿不到它。原因不在渲染层，而在
 * ui-tool 的 diff-card-model：它第一行就写着
 * 「if (block.parentCallId !== undefined) return null」。那行是 a4c296f9fe
 * （"refactor(client): derive tool cards from raw events"）留下的等价补丁——重构前卡片读的是
 * 事件里的 callView / resultView，而 PTC 子调用的事件（tool/ptc-dispatch）只带
 * name / arguments / content，从来不带那两个 view，所以子调用本来就画不出卡片；重构改成从原始
 * 参数重算之后，参数派生对子调用**也会成功**，于是那行检查把行为钉回原样。
 *
 * 这个组件要的正是被钉掉的那一半，所以这里自己写一份派生，唯一的差别就是不放行那行检查。
 *
 * 除此之外这一行还给准备态一次：内置要等参数 JSON 收齐（parsedToolCall 在 preparing 直接返回
 * null），所以流式期间那两个数一直不出现；这里在准备态改读 dsh 的参数视图（block.args），write
 * 的内容一出现就有「+n -0」，并随流式增长；edit 那一对字段**各自到、各自开始数**，不等另一半——
 * 等齐才画的话，行数要等参数里靠后的那个字段，实测滞后 4.5–6.8 s（见 streamedTotals）。
 *
 * 上游（@alm-allen/dsh-chat-ux 0.2.9）把这两处派生挂在插件管理页的「实时改动行数」开关下；套件
 * 没有 configForms，所以这里恒开：准备态的两个数总走参数视图，派发之后的总量也总是先向参数要
 * （intendedHunks 拿不到时退回 streamedHunks）。开关分支与那一支的旧行为不再保留。
 *
 * 代价说得明白些：子调用不持久化 presentationMeta，所以结算之后拿不到「实际应用了什么」，
 * 只能拿参数说话——write 的参数就是整份内容（确定），edit 的参数就是那一对替换（replace_all
 * 或写入失败时可能与实际不符）。
 *
 * 参数那一侧不再自己校验沙箱升级字段。dsh 在 0.2.1-alpha.1 里把这道校验从客户端删掉了
 * （c74f39b4dc），理由是它取决于会话沙箱模式、只有 Host 知道，而被拒的调用本来就会以错误结果
 * 结算；客户端自己猜只会误杀合法行（Bash 就接受「与当前模式相同的模式 + 空 justification」）。
 * 所以这一行与内置同序：只看路径与字段类型。
 *
 * 行尾那两个数走数字轮（本文件自带的 DigitReel，与 chat-motion 各自一份，构建是单文件拼接）：
 * 读数一变，**变了的那一位**原地弹到新值，与命中率、上下文占用同款；流式那两态（preparing /
 * running）只改两处——时长短一档，并且**按节拍换数**。行数跟着换行走，那两态每一两百毫秒就跳
 * 一次，500 ms 那一档下旧数字还没退完就被下一跳换掉，读数会糊在一起；所以宁让读数滞后一拍，也要
 * 让每一轮动画走完整（见 usePacedValue 与 cadence）。外部仍套着 TextShimmer——运行态整行扫光
 * 照旧——而它在活动期间会把这份复合子节点另渲染一棵惰性副本（平台契约里那是给纯展示子节点准备
 * 的）。两份从同一帧挂载、值同源，动画因此同步，代价只是动画期间那一位的透明度叠了一层。
 *
 * 遮蔽的是 keyed 座位：keyed 座位按 priority 升序取最低的那个渲染，同一 priority 上二次注册会
 * 抛错，内置那两行是默认的 0，所以这里用 -1。内置 ToolRow 的组件与 CSS Modules 类名都不在冻结
 * 的基座模块表里，拿不到，所以这一行是照着它的样子重画的（DisclosureRow 等 primitives 是共享
 * 的，行 chrome 本身仍由它们承担）。
 *
 * 类名与自定义属性都以 dshui-diff / dshui-chat-diff 开头：上游那个包若与套件同时安装，两份样式
 * 表不会互相覆盖。这一行不写任何 DOM 属性、不挂任何监听——它是纯 React 的一棵树，卸载时套件按
 * 作用域移除那张 style 元素，座位由 slots.inject 的 fiber 收回。
 *
 * @module dsh-ui-chat-diff/client
 */
function dshuiComponent_chat_diff(rt) {
  const React = rt.require('react')
  if (React === null) {
    rt.warn('react is not in this boot graph; the file mutation rows stay built in')
    return
  }
  const h = React.createElement

  /**
   * 行 chrome 与 diff 卡片都来自共享的基座模块：DiffBlock 画改动、DisclosureRow 承担行高与
   * leading、TextShimmer 负责运行态扫光、diffTotals 与内置取同一份增删口径。缺任何一件都不该
   * 硬画一条半像不像的行——那时保留内置的两行更诚实。
   */
  const primitives = rt.require('@deepseek-ai/dsh-client-ui-primitives')
  if (primitives === null) {
    rt.warn('ui primitives are not in this boot graph; the file mutation rows stay built in')
    return
  }
  const DiffBlock = primitives.DiffBlock
  const DisclosureRow = primitives.DisclosureRow
  const TextShimmer = primitives.TextShimmer
  const diffTotals = primitives.diffTotals
  // 两枚图标只影响观感：缺了就把图标槽留空，轨迹入口只剩文字。
  const IconEditOutlineRegular = primitives.IconEditOutlineRegular
  const IconInspectOutlineRegular = primitives.IconInspectOutlineRegular
  if (DiffBlock == null || DisclosureRow == null || TextShimmer == null || typeof diffTotals !== 'function') {
    rt.warn('ui primitives lack the diff row surface; the file mutation rows stay built in')
    return
  }

  /** 聊天行里 diff 卡片折叠中段前展示的行数；与内置的 CHAT_DIFF_MAX_LINES 取同一个值。 */
  const CHAT_DIFF_MAX_LINES = 9

  /** 三个内容字段：write 用第一个，edit 用后两个。行尾那个输入大小算的就是它们。 */
  const CONTENT_FIELDS = ['content', 'old_string', 'new_string']

  /** 路径字段的候选键，按优先级排列（与内置的文件变更行同序）。 */
  const PATH_KEYS = ['path', 'file_path']

  /** 一个 KB 的字符数。 */
  const KILOBYTE = 1024

  /** 线上原子调用行的 keyed 座位，以及它认的文案命名空间。 */
  const TOOLVIEW_SLOT = 'tool.call.toolview'
  const CONVERSATION_NS = 'conversation'

  /**
   * 流式期间两拍之间的间隔（毫秒），见 usePacedValue。
   *
   * 它要盖过快档那一轮的**完整周期**——新数字落回来 220 ms，低位再按位序晚起手（最多三位 70 ms）——
   * 所以取 300 而不是 220：到点换数时上一轮已经走完，不会被下一批参数打断。
   */
  const PACE_STEP_MS = 300

  /**
   * 数字轮的两档时长（毫秒）：500 ms 是常规档，220 ms 是流式那两态的短档。
   *
   * 500 ms 与下面那个 70 ms 都是照着那张参考卡取的：280 ms 那一版在真机上「动完了但没看见」，
   * 一位数字的位移只有 6px，时间一短就只剩一次闪烁。时长与起手延后是一对，一起改。
   */
  const REEL_TURN_MS = 500
  const REEL_TURN_FAST_MS = 220

  /** 低位比高位晚这么多起手，动起来的次序从左往右。同样对齐那张参考卡。 */
  const REEL_STAGGER_MS = 70

  /** 进场的起点：从下方这么多像素往上落回来。 */
  const REEL_RISE = '6px'

  /** 那一条曲线：中段冲过终点、末尾弹回来。过冲量是位移的 45%，所以位移必须小。 */
  const REEL_EASE = 'cubic-bezier(0.34, 1.45, 0.64, 1)'

  /* ---- class names ----------------------------------------------------
   * 每个类名只写一处：样式表由它们拼出来，渲染侧引用同一批常量，改名字不会漏掉一半。 */

  /** 行根节点。 */
  const FILE_ROW_CLASS = 'dshui-diff-root'
  /** DisclosureRow 的 row 元素：悬停提亮的挂点。 */
  const FILE_ROW_LINE_CLASS = 'dshui-diff-row'
  /** 图标槽。 */
  const FILE_LEADING_CLASS = 'dshui-diff-leading'
  /** 开合 chevron。 */
  const FILE_CHEVRON_CLASS = 'dshui-diff-chevron'
  /** 标题（编辑 / 写入）。 */
  const FILE_TITLE_CLASS = 'dshui-diff-title'
  /** 标题与摘要之间的那个点。 */
  const FILE_SEP_CLASS = 'dshui-diff-sep'
  /** 摘要文本。 */
  const FILE_SUMMARY_CLASS = 'dshui-diff-summary'
  /** 摘要上的失败色。 */
  const FILE_ERROR_CLASS = 'dshui-diff-error'
  /** 摘要上的中断色。 */
  const FILE_STOPPED_CLASS = 'dshui-diff-stopped'
  /** 可点的文件路径。 */
  const FILE_LINK_CLASS = 'dshui-diff-link'
  /** 行尾那一小截统计的容器。 */
  const FILE_SUFFIX_CLASS = 'dshui-diff-suffix'
  /** 统计数字共用的字级。 */
  const FILE_STAT_CLASS = 'dshui-diff-stat'
  /** 新增数（绿色）。 */
  const FILE_ADD_CLASS = 'dshui-diff-add'
  /** 删除数（红色）。 */
  const FILE_DEL_CLASS = 'dshui-diff-del'
  /** 展开体容器。 */
  const FILE_BODY_CLASS = 'dshui-diff-body'
  /** 展开体里的 diff 卡片。 */
  const FILE_DIFF_CLASS = 'dshui-diff-diff'
  /** 展开体里的 IN/OUT 卡片。 */
  const FILE_IO_CLASS = 'dshui-diff-io'
  /** IN/OUT 卡片的一节。 */
  const FILE_IO_SECTION_CLASS = 'dshui-diff-io-section'
  /** IN/OUT 之间的发丝线。 */
  const FILE_IO_DIVIDER_CLASS = 'dshui-diff-io-divider'
  /** IN / OUT 两个侧标。 */
  const FILE_IO_LABEL_CLASS = 'dshui-diff-io-label'
  /** IN / OUT 的正文。 */
  const FILE_IO_TEXT_CLASS = 'dshui-diff-io-text'
  /** 轨迹入口那颗小胶囊。 */
  const FILE_INSPECT_CLASS = 'dshui-diff-inspect'
  /** 只给读屏看的运行态标签。 */
  const FILE_HIDDEN_CLASS = 'dshui-diff-hidden'

  /** 数字轮的容器：几位数字与正负号并排。 */
  const REEL_TEXT_CLASS = 'dshui-diff-reel-text'
  /** 高频那一档：挂在这一截的容器上，时长经自定义属性往下传。 */
  const REEL_FAST_CLASS = 'dshui-diff-reel-fast'
  /** 一位数占的那个槽位。 */
  const REEL_SLOT_CLASS = 'dshui-diff-reel-slot'
  /** 槽位里现在的那个数字。 */
  const REEL_CELL_CLASS = 'dshui-diff-reel-cell'
  /** 上一个数字。 */
  const REEL_WAS_CLASS = 'dshui-diff-reel-was'
  /** 不弹的固定字符（正负号、小数点）。 */
  const REEL_STATIC_CLASS = 'dshui-diff-reel-static'
  /** 给读屏的那一份读数。 */
  const REEL_SPOKEN_CLASS = 'dshui-diff-reel-spoken'

  /** 两个文件工具共用同一枚图标：编辑铅笔。 */
  const FILE_ICON = IconEditOutlineRegular == null ? null : h(IconEditOutlineRegular, { size: 14 })

  /* ---- stylesheet ----------------------------------------------------- */

  /**
   * 文件变更行自己的样式表。
   *
   * 这一行在 tool.call.toolview 的 edit / write 座位上遮蔽了内置的文件变更行，所以内置
   * ToolRow.module.css 里那些规则要在这里重写一份——那套类名带构建期 hash，既拿不到、也不能当
   * 接口。尺寸、令牌与节奏逐条对齐：行高与 leading 由共享的 DisclosureRow 承担，这里只补它没画
   * 的那几样（分隔点、摘要、行尾统计、路径链接、IN/OUT 卡片、轨迹入口）。
   *
   * 颜色全部走令牌：正文、边框、表面沿用套件令牌，增删那一对走文件改动专用的
   * marker 令牌（原因见下一条注释），一处硬编码色值都没有。
   */
  const STYLESHEET = `
/* 增删色：引用 dsh 自己为「文件改动标记」准备的那一对令牌，而不是 diff 卡片正文用的
   state-success/error-primary。理由是这两处要的东西不同：正文那对里绿色只有一种取值
   （深浅两套都是 rgb(34,197,94)），在浅色画布上做 11px 的小字偏亮；marker 这一对天生
   分了两套——浅色 rgb(1,162,65) / rgb(186,39,35)，深色 rgb(65,201,119) / rgb(250,66,62)，
   正好是小字号要的对比度。想再微调就改下面这两个变量，深浅色各写一份即可。

   与上游的一处差别：这两个变量挂在行根上，不写在 body 上。套件的样式表按组件作用域注入，
   卸载时整张 style 元素一起走，声明跟着消失，不必再回 body 上清一遍。 */
.${FILE_ROW_CLASS} {
  --dshui-chat-diff-added: var(--dshui-success);
  --dshui-chat-diff-deleted: var(--dshui-danger);
  display: flex;
  flex-direction: column;
}

.${FILE_LEADING_CLASS} {
  flex-shrink: 0;
}

.${FILE_CHEVRON_CLASS} {
  color: var(--dshui-text-secondary);
}

.${FILE_TITLE_CLASS} {
  font-weight: 400;
  transition: color 100ms ease;
}

/* 2x2 的点：标题与摘要之间那道轻分隔。 */
.${FILE_SEP_CLASS} {
  flex: none;
  width: 2px;
  height: 2px;
  border-radius: var(--dshui-radius-circle);
  margin: 0 8px;
  background: var(--dshui-text-caption);
}

.${FILE_SUMMARY_CLASS} {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: calc(24px + var(--dsh-content-font-delta, 0px));
  color: var(--dshui-text-tertiary);
  transition: color 100ms ease;
}

/* 行尾那一小截：挤在摘要的省略号之外，所以自己带一份同款字级。两个数字之间留一道固定的缝——
   比空格宽，免得「+12」和「-3」挨成一个数。 */
.${FILE_SUFFIX_CLASS} {
  flex: none;
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  margin-left: 10px;
  white-space: nowrap;
}

/* 数字本身：等宽字体、比路径小两号，再用半像素把基线推回行框正中。 */
.${FILE_STAT_CLASS} {
  font-family: var(--ds-font-family-code);
  font-size: calc(var(--dsh-content-font-size-secondary, 13px) - 2px);
  line-height: calc(24px + var(--dsh-content-font-delta, 0px));
  transform: translateY(0.5px);
}

/* 行尾那两个数现在是数字轮（见下面 REEL 那一段），两处都要按这一行的口径重写：

   1. 字号：这一截自带的是「次级文字减一号」，比行尾统计的「减两号」大一号。
   2. 槽高：这一截默认一个 20px 的行盒，而这一行的行盒是 24px + delta。两者的半行距差多少，
      数字的基线就偏多少——实测 2px（数字会浮到与旁边那个 3KB 不在一条线上），所以槽高取同一个
      表达式。

   选择器比 reel 里那一份多两层，所以不靠两份规则在同一张样式表里的先后取胜。 */
.${FILE_SUFFIX_CLASS} .${FILE_STAT_CLASS} .${REEL_TEXT_CLASS} {
  --dshui-chat-diff-reel-cell: calc(24px + var(--dsh-content-font-delta, 0px));
  font-size: calc(var(--dsh-content-font-size-secondary, 13px) - 2px);
}

.${FILE_ADD_CLASS} {
  color: var(--dshui-chat-diff-added);
}

.${FILE_DEL_CLASS} {
  color: var(--dshui-chat-diff-deleted);
}

/* 悬停整行提亮，但行尾那两个数字不跟——它们是这一行的结论，颜色本身就是信息，
   跟着变成正文色就等于把结论擦掉。 */
.${FILE_ROW_LINE_CLASS}:hover .${FILE_TITLE_CLASS},
.${FILE_ROW_LINE_CLASS}:hover .${FILE_SUMMARY_CLASS}:not(.${FILE_ERROR_CLASS}):not(.${FILE_STOPPED_CLASS}) {
  color: var(--dshui-text-primary);
}

/* 文件路径：同字级，点状下划线说明它可点。收缩到文字宽度，行内剩下的空白仍然属于开合目标。 */
.${FILE_LINK_CLASS} {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin: 0;
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  text-align: left;
  font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: calc(24px + var(--dsh-content-font-delta, 0px));
  color: var(--dshui-text-secondary);
  text-decoration: underline dotted;
  text-decoration-color: var(--dshui-text-tertiary);
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
  cursor: pointer;
  transition: color 100ms ease;
}

.${FILE_ROW_LINE_CLASS}:hover .${FILE_LINK_CLASS},
.${FILE_LINK_CLASS}:hover {
  color: var(--dshui-text-primary);
  text-decoration-color: currentColor;
}

.${FILE_ERROR_CLASS} {
  color: var(--dshui-danger);
}

.${FILE_STOPPED_CLASS} {
  color: var(--dshui-warn);
}

.${FILE_BODY_CLASS} {
  display: flex;
  flex-direction: column;
}

/* 展开体：diff 卡片与 IN/OUT 卡片共用同一份左缩进，行与行之间也共用同一份节奏。 */
.${FILE_DIFF_CLASS},
.${FILE_IO_CLASS} {
  margin: 4px 0 4px 4px;
}

/* IN/OUT 卡片：代码块那套表面与圆角，两节各自滚动，中间一道发丝线。 */
.${FILE_IO_CLASS} {
  display: flex;
  flex-direction: column;
  border: 0.5px solid var(--dshui-border-1);
  border-radius: var(--dshui-radius-md);
  background: var(--dshui-surface-sunken);
  font: var(--dshui-font-mono);
}

.${FILE_IO_SECTION_CLASS} {
  display: grid;
  grid-template-columns: max-content 1fr;
  column-gap: 14px;
  align-items: baseline;
  padding: 12px 16px;
  max-height: 150px;
  overflow-y: auto;
}

.${FILE_IO_DIVIDER_CLASS} {
  flex: none;
  height: 0.5px;
  background: var(--dshui-border-2);
}

.${FILE_IO_LABEL_CLASS} {
  position: sticky;
  top: 0;
  align-self: start;
  color: var(--dshui-text-caption);
}

.${FILE_IO_TEXT_CLASS} {
  min-width: 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--dshui-text-secondary);
}

.${FILE_IO_TEXT_CLASS}[data-error] {
  color: var(--dshui-danger);
}

/* 轨迹入口：悬停整行（含标题行）或键盘聚焦时显形，平时不占视觉。 */
.${FILE_INSPECT_CLASS} {
  display: inline-flex;
  align-self: flex-start;
  align-items: center;
  gap: 4px;
  margin: 4px 0 2px 4px;
  padding: 2px 8px;
  border: 0.5px solid var(--dshui-border-3);
  border-radius: var(--dshui-radius-pill);
  corner-shape: round;
  background: var(--dshui-surface-base);
  color: var(--dshui-text-secondary);
  font-size: var(--dshui-text-size-xs);
  line-height: 16px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 100ms ease;
}

.${FILE_ROW_CLASS}:hover .${FILE_INSPECT_CLASS},
.${FILE_INSPECT_CLASS}:focus-visible {
  opacity: 1;
}

.${FILE_INSPECT_CLASS}:hover {
  background: var(--dshui-surface-hover);
  color: var(--dshui-text-primary);
}

/* 运行态只靠图标与扫光表达，所以状态本身要有一条给读屏的文本。 */
.${FILE_HIDDEN_CLASS} {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

/* ---- 数字轮 ----------------------------------------------------------
 *
 * 变了的那一位，原地弹一下。一位上最多两个数字（现在的、上一个），落在同一个槽位上各播一段短
 * 动画：新的从下方 6px 处淡入，旧的朝反方向淡出；两条用同一条带过冲的曲线——落定前先越过去一点
 * 再弹回来。位移只有 6px，所以那 45% 的过冲也就是 2.7px，槽位四周接得住，不需要裁切窗口。
 *
 * 这两条动画里**只有 transform 与 opacity**，一件非合成属性的活都没有；数字位自己还常驻一个
 * will-change（层要在动画之前就建好）。
 *
 * 2026-10 试过在进场那一帧加 1.1px 的模糊（落回来时聚清），两件事一起发生，又退掉了：切会话仍
 * 然卡（模糊每帧重新栅格化，will-change 保得住层、保不住这一步），而且落定之后那一位与相邻的
 * 数字、正负号在渲染路径上分了家（它们没有 filter），看着像没落在同一条线上。要模糊就得回到
 * 「每帧重新栅格化」那条路上，代价就是切会话那一下。
 *
 * 2026-10 之前那一版是「一格格滚」：每位一个 overflow: hidden 的窗口，新数字从下面一整格
 * （translateY(100%)）托上来。问题不在实现而在幅度——整格位移下带过冲的曲线会把数字顶出窗口、
 * 切掉小半个字，于是只能用一条不带过冲的缓动；而那几个 20px 的窗口又把「一格有多高」渗进了每
 * 一处位移的写法。位移收到 6px 之后这两样一起没了：现在只剩行盒高度这一个数，它管对齐，不管
 * 位移。
 *
 * 行高只写一个数（20px）：字形盒 17px 放在里面，上下各余一点，读者换字体也裁不到；正负号跟着
 * 用同一个行高，所以数字与它们必然齐平，不靠对齐属性去凑。
 *
 * 字号写在这一层自己身上，不靠父级给：靠继承就意味着「读者把正文调大之后，这里必须跟着重算」；
 * 自带一份反而稳。行尾统计那一处再由上一条规则把槽高与字号重写成这一行的口径。
 */

.${REEL_TEXT_CLASS} {
  --dshui-chat-diff-reel-cell: 20px;
  --dshui-chat-diff-reel-turn: ${REEL_TURN_MS}ms;
  display: inline-flex;
  align-items: center;
  height: var(--dshui-chat-diff-reel-cell);
  font-size: calc(var(--dsh-content-font-size-secondary, 13px) - 1px);
}

/* 高频那一档：只换时长，位移、曲线、错峰起手都不动。 */
.${REEL_FAST_CLASS} {
  --dshui-chat-diff-reel-turn: ${REEL_TURN_FAST_MS}ms;
}

/* 一位数：一个槽位。现在的数字在文档流里（槽宽由它决定），上一个数字绝对定位压在同一个位置上。 */
.${REEL_SLOT_CLASS} {
  display: block;
  position: relative;
  /* 胶囊挤的时候，这一位也不许被压窄。 */
  flex: none;
  height: var(--dshui-chat-diff-reel-cell);
}

/* 现在的那个数字：从下方落回来。终态零位移——动画走完，数字就落在它本来的位置上，没有可歪的
   余地（位移不参与排版，只是一个 transform）。

   这里用 backwards 而不是 both：填满终态会把动画里那套声明一直挂在元素上，而它与没动过的那几位
   （正负号、没变的数字）就不是同一条渲染路径了。backwards 只覆盖延迟那一段（每位错开起手时
   需要），结束后元素回到干净的静态态。

   will-change 常驻：属性是合成的还不够，元素得有自己那一层。切会话时读数这一位是**新挂载**的，
   动画起手那一刻正是主线程最忙的时候，等那时才决定建层就晚了——实测画面会在长任务期间整段不动。 */
.${REEL_CELL_CLASS} {
  display: block;
  height: 100%;
  line-height: var(--dshui-chat-diff-reel-cell);
  text-align: center;
  will-change: transform, opacity;
  animation: dshui-chat-diff-reel-in var(--dshui-chat-diff-reel-turn) ${REEL_EASE} backwards;
}

/* 上一个数字：朝反方向淡出，走完停在自己的零透明度上，不碍事。
   它必须**脱离文档流**压在同一个槽位上：两个 display: block 上下排的话，槽位会被撑成两格高，
   读数整行跟着长高。 */
.${REEL_WAS_CLASS} {
  display: block;
  position: absolute;
  inset: 0;
  line-height: var(--dshui-chat-diff-reel-cell);
  text-align: center;
  will-change: transform, opacity;
  animation: dshui-chat-diff-reel-out var(--dshui-chat-diff-reel-turn) ${REEL_EASE} both;
}

@keyframes dshui-chat-diff-reel-in {
  from {
    transform: translateY(${REEL_RISE});
    opacity: 0;
  }
  to {
    transform: none;
    opacity: 1;
  }
}

@keyframes dshui-chat-diff-reel-out {
  from {
    transform: none;
    opacity: 1;
  }
  to {
    transform: translateY(-${REEL_RISE});
    opacity: 0;
  }
}

/* 系统说「减少动态效果」：两个数字都不动，上一个直接不显示。 */
@media (prefers-reduced-motion: reduce) {
  .${REEL_CELL_CLASS},
  .${REEL_WAS_CLASS} {
    animation: none;
  }

  .${REEL_WAS_CLASS} {
    display: none;
  }
}

/* 正负号也进同一个行盒：三处行高相同，数字与它们必然齐平。
   flex: none 不能省：胶囊挤的时候，flex 会先把没有固定尺寸的那一位压成零宽——读者那边就是
   「正号不见了」。 */
.${REEL_STATIC_CLASS} {
  display: block;
  flex: none;
  height: var(--dshui-chat-diff-reel-cell);
  line-height: var(--dshui-chat-diff-reel-cell);
}

/* 给读屏的那一份读数：视觉上藏起来，读出来还是「+96」。 */
.${REEL_SPOKEN_CLASS} {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
`

  /* ---- run-state hooks ------------------------------------------------ */

  /**
   * 每个调用自己的展开状态由聊天层注入。取不到时退回到自己的那份状态，免得一次组合改动把整行
   * 画成空白。
   */
  function useLocalDisclosure() {
    const [expanded, setExpanded] = React.useState(false)
    const toggle = React.useCallback(function () {
      setExpanded(function (value) {
        return !value
      })
    }, [])
    return { expanded: expanded, toggle: toggle }
  }

  /**
   * 按节拍交出读数：流式期间最多每 PACE_STEP_MS 换一次，其余情形实时跟随。
   *
   * 节拍只压「换数的频率」，不压真值——交给下游的仍是最新读数（只是晚到下一拍），所以一轮数字轮的
   * 动画不会被下一批参数打断，读者看到的每一次都是完整的一跳。这是有意的取舍：**优先让动画走完整，
   * 宁可读数滞后一拍**。过冲与位移只有 6px，一轮被打断就等于白动。
   *
   * 一拍都没到的那几批不是丢掉、是记住（最新读数一直写在 ref 里），到点应用的是那一刻的真值，所以
   * 陡增时不会一跳一跳地补播中间值。
   */
  function usePacedValue(target, paced) {
    const [shown, setShown] = React.useState(target)
    const targetRef = React.useRef(target)
    const nextAtRef = React.useRef(null)
    const pendingRef = React.useRef(false)
    targetRef.current = target
    React.useEffect(function () {
      // 不在流式（或这一处没有读数）：实时跟随，并让节拍归零——上一次流式的相位不该影响下一次。
      if (!paced) {
        nextAtRef.current = null
        pendingRef.current = false
        setShown(target)
        return undefined
      }
      const now = Date.now()
      // 第一次换数：读数刚出现，直接给（这一拍就是它的起点）。若这里也走「等一拍」，节拍会因为
      // nextAtRef 一直是 null 而永远起不来。
      if (nextAtRef.current === null) {
        nextAtRef.current = now + PACE_STEP_MS
        setShown(target)
        return undefined
      }
      const wait = nextAtRef.current - now
      if (wait <= 0) {
        nextAtRef.current = now + PACE_STEP_MS
        setShown(target)
        return undefined
      }
      // 这一段里读数还会继续长；到点取那一刻的最新值，所以只需一个定时器，不必每批都重排。
      if (pendingRef.current) return undefined
      pendingRef.current = true
      const timer = setTimeout(function () {
        pendingRef.current = false
        nextAtRef.current = Date.now() + PACE_STEP_MS
        setShown(targetRef.current)
      }, wait)
      return function () {
        pendingRef.current = false
        clearTimeout(timer)
      }
    }, [paced, target])
    return shown
  }

  /* ---- digit reel ----------------------------------------------------- */

  /** 读数中间那一段的形状：一至六位整数，可带一位小数。首尾那两个不变的标记由调用方给。 */
  const READING_PATTERN = /^(\d{1,6})(?:\.(\d))?$/

  /**
   * 这一截读数：开着时是几位数字加正负号，关着时是一段纯文本。
   *
   * 整枚刚挂上（切换会话、第一帧）与位数变了新长出来的那一位也照弹：没有上一个数字，就只有新数字
   * 进场。读数的形状由调用方那一侧决定，这里只认「一个可选的不变前缀 + 几位数字 + 可选的一位小数 +
   * 一个可选的不变后缀」。行尾统计用前缀（+ / -）、没有后缀，整数位比三位的占用多也照认——行数会
   * 过千。
   *
   * 颜色不在这里：这一截**不写 color**，从调用方挂在它外面那一层继承。段标记与段内位置也归调用
   * 方写。
   */
  function DigitReel(props) {
    const text = props.text
    const prefix = props.prefix === undefined ? '' : props.prefix
    const suffix = props.suffix === undefined ? '' : props.suffix
    const reading = splitReading(text, prefix, suffix)
    // 形状对不上（dsh 那边换了口径）、或者调用方关掉了这一项时，退回纯文本：这一截照旧是那个读数。
    if (!props.rolling || reading === null) {
      return h('span', { className: REEL_TEXT_CLASS }, text)
    }
    // 时长经自定义属性往下传，不写成内联 style：关键帧那一侧要用 var()，内联只写得了声明值。
    const className = props.cadence === 'fast' ? REEL_TEXT_CLASS + ' ' + REEL_FAST_CLASS : REEL_TEXT_CLASS
    const digits = reading.integer.split('')
    const parts = []
    // 首尾两个标记不弹，与数字位并排；它们跟着调用方给的形状走。
    if (prefix !== '') parts.push(h('span', { key: 'prefix', className: REEL_STATIC_CLASS }, prefix))
    for (let index = 0; index < digits.length; index += 1) {
      parts.push(h(Digit, { key: digits.length - 1 - index, digit: Number(digits[index]), place: index }))
    }
    if (reading.decimal !== null) {
      parts.push(h('span', { key: 'point', className: REEL_STATIC_CLASS }, '.'))
      parts.push(h(Digit, { key: 'decimal', digit: Number(reading.decimal), place: digits.length }))
    }
    if (suffix !== '') parts.push(h('span', { key: 'suffix', className: REEL_STATIC_CLASS }, suffix))
    return h(
      React.Fragment,
      null,
      h('span', { className: className, 'aria-hidden': true }, parts),
      props.spoken ? h('span', { className: REEL_SPOKEN_CLASS }, text) : null,
    )
  }

  /**
   * 一个数字位：一个槽位，里头最多两个数字——现在的在文档流里，上一个压在它上面。
   *
   * 读数一变就把原来那个挪到「上一个」的位置，新数字接替它。key 用的是数字本身，所以**没变的那一
   * 位不会重新挂载**、也就不会播动画：读数一变就让每位都弹，看着像一直在抽。
   */
  function Digit(props) {
    const digit = props.digit
    const place = props.place
    const pair = React.useState({ shown: digit, previous: null })
    const state = pair[0]
    const setState = pair[1]
    if (state.shown !== digit) setState({ shown: digit, previous: state.shown })
    const delay = { animationDelay: String(place * REEL_STAGGER_MS) + 'ms' }
    return h(
      'span',
      { className: REEL_SLOT_CLASS },
      state.previous !== null
        ? h('span', { key: 'was-' + String(state.previous), className: REEL_WAS_CLASS, style: delay }, state.previous)
        : null,
      h('span', { key: 'now-' + String(state.shown), className: REEL_CELL_CLASS, style: delay }, digit),
    )
  }

  /**
   * 把读数拆成整数部分与那一位小数：先按调用方给的形状削掉首尾那两个不变的标记，再认中间那一段。
   *
   * 两个标记都是空串时就是「削掉零个字符」，所以「有没有标记」这一层不必单独判。
   */
  function splitReading(text, prefix, suffix) {
    if (!text.startsWith(prefix) || !text.endsWith(suffix)) return null
    const matched = READING_PATTERN.exec(text.slice(prefix.length, text.length - suffix.length))
    if (matched === null) return null
    const integer = matched[1]
    if (integer === undefined) return null
    return { integer: integer, decimal: matched[2] === undefined ? null : matched[2] }
  }

  /* ---- row ------------------------------------------------------------ */

  /**
   * 渲染一次 write / edit 调用：折叠态是标题、路径与 +n -m，展开态是 diff 卡片。
   *
   * 座位交给这一层的载荷是 owner 那套（block / toolName / cwd / home / openFile / inspect /
   * useDisclosure）加上 conversation 命名空间的 t；组件本身不向座位要别的东西。
   */
  function FileMutationRow(props) {
    const t = props.t
    const toolName = props.toolName
    const cwd = props.cwd
    const home = props.home
    const openFile = props.openFile
    const inspect = props.inspect
    const useDisclosure = typeof props.useDisclosure === 'function' ? props.useDisclosure : useLocalDisclosure
    const disclosure = useDisclosure()
    const expanded = disclosure.expanded
    const toggle = disclosure.toggle
    // dsh 0.2.1-alpha.1 起每个阶段都带 args 视图；准备态的读数直接读它，不再有旧版那个前缀订阅口。
    const block = props.block
    const args = React.useMemo(function () {
      const head = callHead(block)
      return head === null ? null : parseArgs(head.argsRaw)
    }, [block])
    const model = React.useMemo(function () {
      return rowModel(toolName, block, args, cwd, home)
    }, [args, block, cwd, home, toolName])
    const hunks = React.useMemo(function () {
      return diffHunks(block, args)
    }, [args, block])
    const labels = React.useMemo(function () {
      return diffBlockLabels(t)
    }, [t])
    // 准备态也算在跑，与内置 ToolRow 的判据一致（state === 'running' || state === 'preparing'）。
    // 否则这一段里路径与输入大小都不扫光，而它们旁边就是正在扫光的标题。
    const running = model.state === 'running' || model.state === 'preparing'
    const rawTotals = React.useMemo(function () {
      return rowTotals(block, hunks)
    }, [block, hunks])
    // 老虎机常开，只是流式那两态换一档更短的弹动。
    const cadence = running ? 'fast' : undefined
    // 两个工具都走节拍：读者要的是**每一轮动画走完整**，宁可读数滞后一拍。
    //
    // 早先只给 edit 上节拍、write 逐批跟随——那是为了让写入的数字尽早长（当时它确实几乎到终态才
    // 出现）。可那个毛病的主因是**路径后置**（write 把 file_path 排在最后一个字符，见下面 size 那
    // 一段），那一处已经修掉了；现在内容一到就显示数字，逐批跟随只会让 220 ms 的动画每 48 ms 被
    // 下一批参数打断，读数看着像**硬切**——同一个行尾，编辑在跳、写入在闪。
    const totals = usePacedValue(rawTotals, running)
    // 准备态不给展开：那份是半截内容，摊成 diff 会被读成改完了，而且流式的每一批都要重跑一次。
    const expandable = model.state !== 'preparing' && (hunks !== null || model.output !== null || model.bodyRaw !== null)
    const open = expanded && expandable
    const summaryText = model.errorSummary === null ? model.summary : model.errorSummary
    // 输入大小只要读得到就显示——**不再要求路径已经有了**。
    //
    // 内置的 summarySuffix 是「有路径才显示」，照抄它会踩到一个很具体的坑：模型给 write 生成的参
    // 数顺序是 content 在前、file_path 在**最后一个字符**（2026-10-11 量了 30 次真实 write：content
    // 在第 1 批，file_path 在第 1041 批、即整段参数流的 100%），而 edit 反过来是 file_path 在最前
    // （0%）。于是同样的规则下：写入的整段内容流式期间那两个数都被挡掉、只在末尾一起冒出来，编辑
    // 却从头就在长。
    //
    // 没有路径时它直接跟在描述后面（那个分隔点只在有描述时渲染，所以不会留下一个孤立的点）。
    // 输入大小自己拼，不借 dsh 那句 tool.preparing.content（「正在准备内容 5KB」）——准备态那一行
    // 本来就只有这一个读数，前面那句把行头撑长一倍，读者要看的就是这个数。
    const size = model.kilobytes === null ? null : model.kilobytes + 'KB'
    const status = stateLabel(model.state, t)
    // 失败与中断的行不给路径链接：那两态下摘要换成的是裁决或失败信息，链接会把它读成一次正常改动。
    const linkAvailable = model.filePath !== undefined && model.state !== 'error' && model.state !== 'stopped'
    const openFileClick = React.useCallback(function (event) {
      event.stopPropagation()
      if (model.filePath === undefined) return
      if (typeof openFile !== 'function') return
      openFile(model.filePath)
    }, [model.filePath, openFile])
    // 路径链接是行内的一个按钮，而整行也是开合目标：Enter / 空格要落在这颗按钮上，
    // 不能冒泡到行的 keydown 里去。
    const linkKeyDown = React.useCallback(function (event) {
      if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
    }, [])

    // 那一截紧凑内容由三块拼成：路径（或摘要）、输入大小、增删两个数。**路径缺席时另两块照旧显示**——
    // 原因见上面 size 那一段注释（write 的 file_path 在参数最末）。
    const collapsedContent = summaryText === '' && size === null && totals === null
      ? null
      : h(
        React.Fragment,
        null,
        summaryText !== ''
          ? h(
            React.Fragment,
            null,
            // 那个分隔点是「标题 · 路径」之间的一颗点：没有路径时它不该单独出现。
            h('span', { className: FILE_SEP_CLASS, 'aria-hidden': true }),
            linkAvailable
              ? h(
                'button',
                { type: 'button', className: FILE_LINK_CLASS, onClick: openFileClick, onKeyDown: linkKeyDown },
                h(TextShimmer, { active: running }, summaryText),
              )
              : h(
                'span',
                { className: summaryClassName(model.state) },
                h(TextShimmer, { active: running }, summaryText),
              ),
          )
          : null,
        size !== null || totals !== null
          ? h(
            'span',
            { className: FILE_SUFFIX_CLASS },
            size !== null ? h(TextShimmer, { className: FILE_STAT_CLASS, active: running }, size) : null,
            totals !== null
              ? h(
                React.Fragment,
                null,
                h(
                  TextShimmer,
                  { className: FILE_STAT_CLASS + ' ' + FILE_ADD_CLASS, active: running },
                  h(DigitReel, {
                    text: '+' + totals.added,
                    prefix: '+',
                    suffix: '',
                    rolling: true,
                    cadence: cadence,
                    spoken: true,
                  }),
                ),
                h(
                  TextShimmer,
                  { className: FILE_STAT_CLASS + ' ' + FILE_DEL_CLASS, active: running },
                  h(DigitReel, {
                    text: '-' + totals.removed,
                    prefix: '-',
                    suffix: '',
                    rolling: true,
                    cadence: cadence,
                    spoken: true,
                  }),
                ),
              )
              : null,
          )
          : null,
      )

    const expandedContent = open
      ? h(
        'div',
        { className: FILE_BODY_CLASS },
        hunks !== null
          ? h(DiffBlock, { diffs: hunks, labels: labels, maxLines: CHAT_DIFF_MAX_LINES, className: FILE_DIFF_CLASS })
          : h(
            'div',
            { className: FILE_IO_CLASS },
            model.bodyRaw !== null
              ? h(
                'div',
                { className: FILE_IO_SECTION_CLASS },
                h('span', { className: FILE_IO_LABEL_CLASS }, t('row.input')),
                h('span', { className: FILE_IO_TEXT_CLASS }, model.bodyRaw),
              )
              : null,
            model.bodyRaw !== null && model.output !== null
              ? h('span', { className: FILE_IO_DIVIDER_CLASS, 'aria-hidden': true })
              : null,
            model.output !== null
              ? h(
                'div',
                { className: FILE_IO_SECTION_CLASS },
                h('span', { className: FILE_IO_LABEL_CLASS }, t('row.output')),
                h(
                  'span',
                  { className: FILE_IO_TEXT_CLASS, 'data-error': model.state === 'error' ? true : undefined },
                  model.output,
                ),
              )
              : null,
          ),
        inspect !== undefined
          ? h(
            'button',
            { type: 'button', className: FILE_INSPECT_CLASS, onClick: inspect },
            IconInspectOutlineRegular == null ? null : h(IconInspectOutlineRegular, null),
            t('row.inspect'),
          )
          : null,
      )
      : undefined

    return h(
      'div',
      {
        className: FILE_ROW_CLASS,
        'data-variant': model.variant,
        'data-tool': toolName,
        'data-state': model.state,
      },
      status === null ? null : h('span', { className: FILE_HIDDEN_CLASS }, status),
      h(
        DisclosureRow,
        {
          rowClassName: FILE_ROW_LINE_CLASS,
          leadingClassName: FILE_LEADING_CLASS,
          titleClassName: FILE_TITLE_CLASS,
          chevronClassName: FILE_CHEVRON_CLASS,
          icon: FILE_ICON,
          title: t(model.titleKey),
          running: running,
          open: open,
          expandable: expandable,
          expandOnRowClick: true,
          keepContentWhenOpen: true,
          onToggle: toggle,
          collapsedContent: collapsedContent,
        },
        expandedContent,
      ),
    )
  }

  /* ---- models --------------------------------------------------------- */

  /**
   * 派生这一行要展示的改动。
   *
   * 与内置 diff-card-model 只有一处不同：**不排除子调用**（原因见模块注释）。其余分支保持同序：
   * 未结算时只有参数可用；结算后优先用结果元数据里真实应用的 hunks，拿不到才退回参数。
   *
   * 上游那个「实时改动行数」开关在套件里恒开，所以准备态这一支只剩一种走法：不产出 hunks，
   * 那两个数交给 rowTotals 直接读参数视图（见 streamedTotals）。
   */
  function diffHunks(block, args) {
    if (!('kind' in block)) {
      if (block.phase === 'preparing') return null
      const intended = intendedHunks(block.name, args)
      return intended === null ? streamedHunks(block.name, block.args) : intended
    }
    if (block.isError) return null
    const applied = appliedHunks(block.meta)
    if (applied !== null && applied !== 'empty') return applied
    // 没有真实 hunks 可依：write 的参数就是整份内容，edit 的参数就是那一对替换。
    if (block.call == null) return null
    return intendedHunks(block.call.name, args)
  }

  /**
   * 从调用参数派生改动：write 是整份内容，edit 是那一对替换。
   *
   * 返回单个 hunk，或 null（参数不是这一行的形状）。
   */
  function intendedHunks(name, args) {
    if (args === null) return null
    const path = pickString(args, PATH_KEYS)
    if (path === undefined) return null
    if (name === 'write') {
      const content = args.content
      return typeof content === 'string' ? [{ path: path, oldText: null, newText: content }] : null
    }
    if (name !== 'edit') return null
    const oldText = args.old_string
    const newText = args.new_string
    if (typeof oldText !== 'string' || typeof newText !== 'string') return null
    const replaceAll = args.replace_all
    if (replaceAll !== undefined && typeof replaceAll !== 'boolean') return null
    return [{ path: path, oldText: oldText === '' ? null : oldText, newText: newText }]
  }

  /**
   * 从参数视图派生改动：准备态唯一拿得到的材料就是视图给出的字段文本——已解码，可能还没收尾。
   *
   * write 用已收到的那一截内容：oldText 为 null 时它同时就是「新增了多少行」的答案，与结算后的
   * 口径（diffTotals 对一份全 + 的改动计数）恒等。edit 要等价的两个字段都收尾才画——行级匹配在
   * 部分文本上没有稳定答案（部分 new 会先被算成删除，补齐后又变回来），宁可不画，也不给一个会上
   * 下跳的数字。
   */
  function streamedHunks(name, view) {
    if (view === undefined || view === null) return null
    const path = viewPath(view)
    if (path === undefined) return null
    if (name === 'write') {
      if (!view.has('content')) return null
      const content = view.text('content')
      return content === undefined ? null : [{ path: path, oldText: null, newText: content }]
    }
    if (name !== 'edit') return null
    if (!view.complete('old_string') || !view.complete('new_string')) return null
    const oldText = view.text('old_string')
    const newText = view.text('new_string')
    if (oldText === undefined || newText === undefined) return null
    return [{ path: path, oldText: oldText === '' ? null : oldText, newText: newText }]
  }

  /**
   * 读结果元数据里真实应用的 hunks。
   *
   * 返回校验过的 hunks、'empty'（元数据明确说没有改动），或 null（不可用）。
   */
  function appliedHunks(meta) {
    if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return null
    const diffs = meta.diffs
    if (!Array.isArray(diffs)) return null
    if (diffs.length === 0) return 'empty'
    const hunks = []
    for (let index = 0; index < diffs.length; index += 1) {
      const hunk = diffs[index]
      if (typeof hunk !== 'object' || hunk === null) return null
      const hunkPath = hunk.path
      const oldText = hunk.oldText
      const newText = hunk.newText
      if (typeof hunkPath !== 'string') return null
      if (oldText !== null && typeof oldText !== 'string') return null
      if (typeof newText !== 'string') return null
      hunks.push({ path: hunkPath, oldText: oldText, newText: newText })
    }
    return hunks
  }

  /**
   * 派生整行的展示模型。
   *
   * 行状态与内置 ToolRowState 同名同义：preparing / running / ok / error / stopped，中断按
   * error.code 判，与内置同序。
   */
  function rowModel(toolName, block, args, cwd, home) {
    const done = 'kind' in block
    const head = callHead(block)
    const state = !done
      ? block.phase === 'preparing' ? 'preparing' : 'running'
      : block.error != null && block.error.code === 'interrupted' ? 'stopped' : block.isError ? 'error' : 'ok'
    const path = argumentPath(block, args)
    const output = done ? resultText(block) || null : null
    return {
      titleKey: toolName === 'write' ? 'tool.title.write' : 'tool.title.edit',
      variant: toolName === 'write' ? 'write' : 'edit',
      summary: path === undefined ? '' : shortenPath(path, cwd, home),
      filePath: path,
      bodyRaw: head === null || head.argsRaw === '' ? null : head.argsRaw,
      output: output,
      errorSummary: state === 'error' && output !== null ? firstLine(output) : null,
      state: state,
      kilobytes: contentKilobytes(block.args),
    }
  }

  /**
   * 把一次结算结果摊成展示文本：文本块原样，其余块转成 JSON；空内容又带结构化错误时退回
   * 「name: code」一行。
   */
  function resultText(node) {
    const parts = []
    const content = Array.isArray(node.content) ? node.content : []
    for (let index = 0; index < content.length; index += 1) {
      const block = content[index]
      if (block.type === 'text' && typeof block.text === 'string') {
        parts.push(block.text)
        continue
      }
      parts.push(JSON.stringify(block, null, 2))
    }
    if (parts.length === 0 && node.error !== undefined) parts.push(node.error.name + ': ' + node.error.code)
    return parts.join('\n')
  }

  /**
   * 这一行的调用头：已结算的看结果节点带回的那一份，仍在跑的看它自己的参数。
   *
   * 返回 null 表示参数还在流进来的准备态（或窗口丢掉了调用头）。
   */
  function callHead(block) {
    if ('kind' in block) return block.call == null ? null : block.call
    return block.phase === 'start' ? { name: block.name, argsRaw: block.argsRaw } : null
  }

  /**
   * 解析原始参数 JSON。
   *
   * 返回参数对象，或 null（流式中途截断、或不是对象）。
   */
  function parseArgs(argsRaw) {
    let value
    try {
      value = JSON.parse(argsRaw)
    } catch (error) {
      return null
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
    return value
  }

  /**
   * 按顺序取第一个非空字符串字段。
   */
  function pickString(args, keys) {
    for (let index = 0; index < keys.length; index += 1) {
      const value = args[keys[index]]
      if (typeof value === 'string' && value !== '') return value
    }
    return undefined
  }

  /**
   * 这一行的目标路径：先读参数视图（每个阶段都在，准备态可能还不完整），再退回派发后的原始参数。
   */
  function argumentPath(block, args) {
    const fromView = viewPath(block.args)
    if (fromView !== undefined) return fromView
    return args === null ? undefined : pickString(args, PATH_KEYS)
  }

  /**
   * 路径的视图读法。
   *
   * 与内置的文件变更行同一条规则：字段收尾了才算数——准备态可能只到了半截——解码失败
   * （转义不完整）也当没有。
   */
  function viewPath(view) {
    if (view === undefined || view === null) return undefined
    for (let index = 0; index < PATH_KEYS.length; index += 1) {
      const key = PATH_KEYS[index]
      if (!view.has(key) || !view.complete(key)) continue
      const text = view.text(key)
      if (text !== undefined && text !== '') return text
    }
    return undefined
  }

  /**
   * 已收到的输入大小（KB）：内容字段的解码长度之和。
   *
   * 与内置的文件变更行取同一个口径，所以同一个位置在两边显示同一个数：正在流进来的那一个字段按
   * 已收到的部分算，已经收完的按整段算。一个内容字段都还没出现时返回 null——行头不摆一个 0KB。
   */
  function contentKilobytes(view) {
    if (view === undefined || view === null || typeof view !== 'object') return null
    let open
    for (let index = 0; index < CONTENT_FIELDS.length; index += 1) {
      const key = CONTENT_FIELDS[index]
      if (view.has(key) && !view.complete(key)) {
        open = key
        break
      }
    }
    let completed = 0
    for (let index = 0; index < CONTENT_FIELDS.length; index += 1) {
      const key = CONTENT_FIELDS[index]
      if (key === open || !view.complete(key)) continue
      const length = view.stringLength(key, { step: KILOBYTE })
      completed += length === undefined ? 0 : length
    }
    const remembered = countedKilobytes.get(view)
    let next
    if (open === undefined) {
      let any = false
      for (let index = 0; index < CONTENT_FIELDS.length; index += 1) {
        if (view.has(CONTENT_FIELDS[index])) {
          any = true
          break
        }
      }
      next = any ? Math.ceil(completed / KILOBYTE) : null
    } else {
      const streamed = view.stringLength(open, { step: KILOBYTE, offset: completed })
      next = Math.ceil((completed + (streamed === undefined ? 0 : streamed)) / KILOBYTE)
    }
    if (next === null) return remembered === undefined ? null : remembered
    // 解码一时读不出来时 stringLength 给 undefined，上面按 0 计——那会让这个数掉回来。参数只追加，
    // 它本该只往上长，所以拿上一次的数兜底、取两者的较大值。
    const value = remembered === undefined ? next : Math.max(remembered, next)
    countedKilobytes.set(view, value)
    return value
  }

  /**
   * 内容字段已收到的行数，按 dsh 自己的口径：末尾那个换行是行终止符、不算新的一行，正文为空是零行。
   *
   * 流式期每一批都要问一次，所以记住上一次数到哪、数出多少行，只扫新来的后缀；视图被换成新的
   * 一份（字段收尾，或 settle 用权威文本替换）时记忆自然落空，整段重数一次。
   */
  function streamedLineCount(view, key) {
    let memory
    let remembered
    if (view !== undefined && view !== null) {
      memory = countedLines.get(view)
      if (memory === undefined) {
        memory = new Map()
        countedLines.set(view, memory)
      }
      remembered = memory.get(key)
    }
    const text = view === undefined || view === null ? undefined : view.text(key)
    // 转义序列还在路上时这一字段解码不出来（text 给 undefined）。那不能读成「这一段是空的」——
    // 参数只追加，这个数本该只往上长，归零就是一次假的回落，所以保留上一次数过的结果。
    if (text === undefined) return remembered === undefined ? 0 : remembered.lines
    const body = text.endsWith('\n') ? text.slice(0, -1) : text
    if (body === '') return 0
    let lines = remembered === undefined ? 1 : remembered.lines
    const from = remembered === undefined ? 0 : remembered.length
    for (let at = from; at < body.length; at += 1) if (body[at] === '\n') lines += 1
    if (memory !== undefined) memory.set(key, { length: body.length, lines: lines })
    return lines
  }

  /**
   * 行尾那两个数。
   *
   * 准备态走 streamedTotals，只看参数视图。其余情形与内置同序：结算后优先用结果元数据里真实应用的
   * hunks，拿不到就用参数派生的那一份。
   */
  function rowTotals(block, hunks) {
    if (!('kind' in block) && block.phase === 'preparing') return streamedTotals(block.name, block.args)
    if (hunks === null) return null
    return diffTotals(hunks)
  }

  /**
   * 准备态那两个数：只看参数视图，不跑行级 diff。
   *
   * write 是「已收到的内容行数 / 0」；edit 是「已收到的新文本行数 / 已收到的旧文本行数」——两段各自
   * 数原始行数，所以两个数都只往上长，不会因为另一半补齐而回头。派发或结算之后换成真实应用的
   * hunks，于是落定那一下会按真实 diff 修正一次。
   *
   * 行级 diff 在部分文本上没有稳定答案（部分 new 会先被算成删除，补齐后又变回来），而这一处要的是
   * 一个只会往上跳的数——与数字轮那边的口径一致。
   *
   * **两个字段各自到、各自开始数**，不等另一半：等齐才画意味着行数要等参数 JSON 里**靠后**的那一
   * 个字段到达——模型先把 old_string 写完再写 new_string 时，那是一整段原文的时长（实测同一段参数
   * 流里 KB 在 96 ms 就显示，行数要等 4.5–6.8 s）。那一位没到之前先报 0，到齐之前它只往上跳；
   * 等齐写法反而会在另一半到达时把已经数过的那一半按新进度重报一次，读数往回跳，与数字轮那一套相冲。
   */
  function streamedTotals(name, view) {
    if (view === undefined || view === null) return null
    if (name === 'write') {
      return view.has('content') ? { added: streamedLineCount(view, 'content'), removed: 0 } : null
    }
    if (name !== 'edit') return null
    const hasOld = view.has('old_string')
    const hasNew = view.has('new_string')
    if (!hasOld && !hasNew) return null
    return {
      added: hasNew ? streamedLineCount(view, 'new_string') : 0,
      removed: hasOld ? streamedLineCount(view, 'old_string') : 0,
    }
  }

  /**
   * 把绝对路径缩成读者更容易对上的形状：先相对会话工作区，再把残留的主目录前缀写成 ~。
   */
  function shortenPath(path, cwd, home) {
    if (cwd !== undefined && cwd !== '' && path.startsWith(cwd)) {
      const rest = path.slice(cwd.length).replace(/^[\\/]+/, '')
      if (rest !== '') return rest
    }
    if (home !== undefined && home !== '' && path.startsWith(home)) {
      const rest = path.slice(home.length)
      if (rest === '' || rest.startsWith('/') || rest.startsWith('\\')) return '~' + rest.replace(/\\/g, '/')
    }
    return path
  }

  /**
   * 取一段文本的第一行。
   */
  function firstLine(text) {
    const lineBreakAt = text.indexOf('\n')
    return lineBreakAt === -1 ? text : text.slice(0, lineBreakAt)
  }

  /**
   * 摘要那半截的类名：失败与中断各自带自己的状态色。
   */
  function summaryClassName(state) {
    if (state === 'error') return FILE_SUMMARY_CLASS + ' ' + FILE_ERROR_CLASS
    if (state === 'stopped') return FILE_SUMMARY_CLASS + ' ' + FILE_STOPPED_CLASS
    return FILE_SUMMARY_CLASS
  }

  /**
   * 给读屏的状态文本：图标与扫光都不表达状态，这句话替它们说。
   *
   * 准备态不播报——那一行本来就在准备，内置那句「正在准备调用」会与旁边扫光的标题重复。
   */
  function stateLabel(state, t) {
    if (state === 'running') return t('row.running')
    if (state === 'error') return t('row.failed')
    if (state === 'stopped') return t('row.stopped')
    return null
  }

  /**
   * 组装 diff 卡片自己的 chrome 文案。
   */
  function diffBlockLabels(t) {
    return {
      codeLabel: t('codeBlock.title'),
      wrapLabel: t('codeBlock.wrap'),
      unwrapLabel: t('codeBlock.unwrap'),
      copy: t('copy'),
      copied: t('copied'),
      collapseAria: t('diff.collapseAria'),
      expandAria: function (hidden) {
        return t('diff.expandAria', { count: hidden })
      },
      collapse: t('collapse'),
      expand: function (hidden) {
        return t('diff.expandRest', { count: hidden })
      },
    }
  }

  /* ---- module state --------------------------------------------------- */

  /**
   * 每份参数视图、每个字段一份数行记忆：视图是原地追加的，所以只数新来的那一截。
   *
   * 键必须带上字段名——edit 那一对字段（old_string / new_string）各数各的，共用一个键会互相算错。
   */
  const countedLines = new WeakMap()

  /** 每份参数视图一份 KB 记忆：用来兜住解码一时读不出来的那些帧，不让这个数回落。 */
  const countedKilobytes = new WeakMap()

  /* ---- install -------------------------------------------------------- */

  /**
   * 装上样式表，并在 edit / write 两个座位上遮蔽内置的文件变更行。
   *
   * 座位是 keyed 的：同一 key 上 priority 最小者渲染，内置那两行是默认的 0，所以这里用 -1。
   * 两次注册都挂在同一个 inject 回调里，fiber 收回时一起撤销；样式表由套件的表注册表持有，
   * 卸载时随组件一起消失——这一行没有别的 DOM 写入、属性和监听，需要清的只有这两样。
   */
  function install(ctx) {
    rt.effect(function () {
      const removeSheet = rt.style('chat-diff', STYLESHEET)
      let offToolview = null
      try {
        offToolview = ctx.slots.inject(TOOLVIEW_SLOT, function () {
          const seat = { name: TOOLVIEW_SLOT, priority: -1, locale: CONVERSATION_NS }
          const disposeEdit = ctx.slots.register({ ...seat, key: 'edit' }, FileMutationRow)
          const disposeWrite = ctx.slots.register({ ...seat, key: 'write' }, FileMutationRow)
          return function () {
            disposeEdit()
            disposeWrite()
          }
        })
      } catch (error) {
        // 座位没声明（组合里没有聊天层）时不要留下那张样式表，也不要抛断整个套件。
        rt.error(error)
      }
      return function () {
        if (offToolview !== null) offToolview()
        removeSheet()
      }
    }, 'ui-chat-diff: file mutation rows')
  }

  /**
   * 服务等待在这里声明，而不是写在插件清单上：组合里没有座位表时这一块保持惰性，
   * 套件的其余组件照常运行。
   */
  rt.ctx.inject(['slots'], function (scope) {
    install(scope)
  })
}
