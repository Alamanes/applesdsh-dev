/**
 * Command Code plan quota — three ring gauges beside the model picker.
 *
 * Registers one quota gauge into the conversation-owned
 * `conversation.input.right` list slot, which the input bar renders immediately
 * to the left of the model picker, and one section into the settings panel's
 * `settings.section` list slot: the plan × model call-count table. Both ask the
 * host for the same quota report over the exact Fetch route the suite's quota
 * host half registers on the shared `/api` transport, and each renders the credit
 * windows at the size its own seat can afford.
 *
 * There is deliberately no sidebar surface. The rings beside the model picker
 * are where the numbers are actually looked at, and two live copies of the same
 * report only invited them to disagree.
 *
 * The call-count table answers a different question — roughly how many calls each
 * model allows — which belongs where a user goes to think about configuration,
 * not in the always-visible surfaces. Only the section looks at the report's
 * `catalog` field, and it hides itself when the host is too old to send one.
 *
 * Presentation rules:
 *
 * - Windows run shortest first (5 hours, weekly, monthly), so the tightest
 *   constraint sits where your eye lands first.
 * - The gauge shows one window, the tightest one, and nothing else takes a seat
 *   in the composer. The used *percentage* is both the number beside the ring and
 *   the arc inside it, because that is the whole question a gauge answers: how
 *   deep into the window am I? It rounds to a whole percent — the same rounding
 *   the official dashboard uses — so the composer and the website can be compared
 *   without a mental conversion; the exact one-decimal value of every window, the
 *   window names, and the dollar amounts stay one hover away.
 * - Space is deliberately scarce: the input row is one line and the model picker
 *   already competes for it. Only the monthly allowance is ever shown in money,
 *   and only on the tooltip — it is the one total a user budgets against — while
 *   the rolling windows stay percentage-only, because the API reports them as
 *   pass/fail limits rather than as something to track in dollars.
 * - Nothing is deduced about *pace*. How fast a user burns credit is their
 *   business; a gauge that editorialises about "over pace" tells someone who
 *   simply has work to do something they cannot act on.
 * - Nothing renders at all when this host has no Command Code provider, so
 *   installing the component cannot park an error box in the composer of somebody
 *   who does not use the service.
 *
 * Written as a hand-authored component: `React.createElement` rather than JSX,
 * and styling is one `rt.style` sheet keyed on the `.ccq-` prefix using the
 * suite's design tokens.
 */
function dshuiComponent_quota(rt) {
  const React = rt.require('react')
  if (React === null) {
    rt.warn('react is not in this boot graph; the quota gauge is skipped')
    return
  }
  const h = React.createElement

  /**
   * The harness's own tooltip primitive.
   *
   * The composer is a docked surface with a scroll container directly above it,
   * so a bubble has to escape that ancestor's clipping and its stacking context,
   * and the native `title` attribute cannot do either — it draws the platform's
   * own delayed strip, not a panel. `Tooltip` is a platform seed word in the web
   * shell's `staticModules`, so this resolves to the very instance the composer's
   * own controls use, giving the seat a bubble that matches the chrome around it.
   *
   * Resolved defensively: on a harness whose seed table lacks the primitive, the
   * seat falls back to the `title` attribute instead of failing to load.
   */
  const primitives = rt.require('@deepseek-ai/dsh-client-ui-primitives')
  const Tooltip = primitives !== null && typeof primitives.Tooltip === 'function' ? primitives.Tooltip : null

  /**
   * Channel and endpoint the host half registers.
   *
   * The channel has to stay `/api`: `connection.rpc.call` accepts exactly one
   * channel segment, so the suite's namespace lives in the endpoint instead. The
   * resulting server path is `/api/dsh-ui-copy/quota/cc-quota/report`, and the
   * endpoint doubles as the method inside the request envelope. The host half
   * also answers the pre-suite `cc-quota/report` endpoint as an alias, so a
   * browser half from the standalone plugin keeps reaching it.
   */
  const CHANNEL = '/api'
  const ENDPOINT = 'cc-quota/report'
  /** Locale namespace this component owns. */
  const NS = 'cc-quota'
  /** Poll cadence: relaxed normally, tight once any window is near its cap. */
  const SLOW_MS = 60_000
  const FAST_MS = 15_000
  /**
   * Cadence after the host answers with a snapshot instead of a live read.
   *
   * The host serves its last good report immediately on a cold start so the card
   * can paint at once; a refresh is already running behind that answer. Waiting
   * the usual minute for it would waste the one moment the user is actually
   * looking at the card.
   */
  const REVALIDATE_MS = 3_000
  /**
   * Cadence while the host answers `configured: false` — it has no Command Code
   * provider, so the card stays invisible but still looks again, slowly.
   *
   * The alternative (never asking again) turns a fixable configuration gap into a
   * permanent one: a provider added after this component mounted — the desktop
   * app's first-run migration of `settings.yaml`, a settings edit, a profile
   * switch — would leave the card hidden for the rest of the session, with
   * nothing in the UI to explain why, since an absent card renders no error
   * either. Five minutes costs one local IPC round trip when the host really does
   * not use Command Code.
   */
  const ABSENT_MS = 5 * 60_000
  /** Used percentage at which a window counts as "hot" for polling purposes. */
  const HOT_PERCENT = 85
  /**
   * Above this, a window is spent rather than approaching.
   *
   * Polling faster cannot change what the card would say: an exhausted allowance
   * only moves when someone consumes credit, and the remaining movement is the
   * reset, which the countdown already covers. Without this ceiling an account
   * sitting at 99.8 % — a state that lasts for days near the end of a period —
   * would poll every 15 seconds indefinitely.
   */
  const SPENT_PERCENT = 99.5

  /**
   * Level colours for the ring arcs, quietest state first.
   *
   * Deliberately not green: this sits in the composer, inches from the send
   * control and the model picker, and a saturated green there reads as a success
   * state for the *message* rather than as a quota reading. Brand blue is the
   * harness's own accent, so "fine" looks like part of the chrome while amber and
   * red still stand out as the two states that want attention.
   */
  const LEVELS = [
    { below: 60, color: 'var(--dshui-brand)' },
    { below: 85, color: 'var(--dshui-warn)' },
    { below: Number.POSITIVE_INFINITY, color: 'var(--dshui-danger)' },
  ]

  /** Display order: the shortest window first, the monthly budget last. */
  const WINDOWS = [
    { key: 'fiveHour', label: 'fiveHour' },
    { key: 'weekly', label: 'weekly' },
    { key: 'monthly', label: 'monthly' },
  ]

  /** Every string this component renders, in both shipped UI languages. */
  const DICT = {
    zh: {
      fiveHour: '5 小时',
      weekly: '每周',
      monthly: '月度',
      // The composer ring group's tooltip heading.
      chipTitle: 'Command Code 额度',
      reset: '{time} 后重置',
      left: '剩',
      straddle: '本次读数跨了计费周期，下次刷新会校正',
      belowThreshold: '额度已低于阈值',
      subCanceled: '订阅已取消，{date} 到期',
      subStatus: '订阅状态：{status}',
      none: '该套餐未上报额度窗口',
      degraded: '{count} 项数据这次没取到，稍后自动重试',
      retry: '点击重试',
      stale: '上次成功：{age}前',
      errNetwork: '连不上 Command Code',
      errAuth: 'API key 被拒绝了',
      errRate: '请求太频繁，稍后自动重试',
      errNotFound: '当前套餐不含 API 权限',
      errGeneric: '读取失败',

      // Settings-panel section: the plan-level overview, the per-model table,
      // and every line that qualifies them. Nothing here may imply a number the
      // official site never published — see formatCount().
      nav: '调用次数',
      title: '模型调用次数',
      intro: '当前套餐下，每个模型大概还能调用多少次。数字按官方的模型额度、单价和一次典型请求的用量换算，仅供参考。',
      loading: '正在读取官方次数表…',
      planFallback: '当前套餐',
      planLevel: '套餐级额度',
      planLevelNote: '套餐额度是所有模型共享的总额；单模型次数是「这个模型单独用满额度」的换算值。两者官方口径不同（算法不同），不能互相推算。',
      basis: '换算基准：一次请求约 输入 {in} / 输出 {out} / 缓存读 {cache} tokens。',
      inferred: '官方没有这一档的专页，按 {from} 的数据推断。',
      colModel: '模型',
      colMonthly: '每月',
      colFiveHour: '5 小时',
      colWeek: '每周',
      notGiven: '官方未给',
      dashNote: '「—」表示官方没有公布这个模型的次数，不是 0 次。',
      freeNote: '「Free」是官方标注的免费/不限量，不是我们算出来的数字。',
      derivedNote: '按官方 provider 默认形状推算',
      peak: '峰时：每月 {monthly} · 5 小时 {fiveHour} · 每周 {week}',
      requestsFallback: '约 {count} 次请求',
      expand: '展开全部 {count} 个模型',
      collapse: '收起，只看你配置的模型',
      noConfigured: '没能识别出你配置的模型，下面是这个套餐的全部 {count} 个模型。',
      coverage: '官方次数表覆盖 {published} 个模型，这个套餐可用 {available} 个。',
      empty: '这个套餐暂时没有可显示的模型次数。',
      statusBundled: '内置基线，尚未同步：这些次数来自插件自带的快照，可能已经落后于官方。',
      statusNever: '从未核对过官方数据。',
      statusStale: '已超过 24 小时未核对（上次核对 {time}）。',
      statusChecked: '上次核对 {time}。',
      statusUpdated: '官方数据更新于 {time}。',
      fetchModeHash: '本机用不了官方的 HEAD 校验，改用整篇比对（仍然只在内容变了时重新解析）。',
      failureHead: '{count} 项这次没核对成功：',
      errRefresh: '检查更新失败：{message}',
      refresh: '检查更新',
      refreshing: '正在检查…',
      docLink: '查看官方套餐与限额文档',
      warnPlanMissing: '官方目录里没有这个套餐的条目。',
      warnPlanNotListed: '官方目录里没有 {planId} 这一档。',
    },
    en: {
      fiveHour: '5-hour',
      weekly: 'Weekly',
      monthly: 'Monthly',
      // The composer ring group's tooltip heading; see the zh block.
      chipTitle: 'Command Code quota',
      reset: 'resets in {time}',
      left: 'left',
      straddle: 'this reading straddles a billing boundary; the next refresh corrects it',
      belowThreshold: 'credit is below the configured threshold',
      subCanceled: 'Subscription canceled, ends {date}',
      subStatus: 'Subscription: {status}',
      none: 'this plan reports no credit windows',
      degraded: '{count} reading(s) unavailable this time; retrying shortly',
      retry: 'click to retry',
      stale: 'last success {age} ago',
      errNetwork: 'cannot reach Command Code',
      errAuth: 'the API key was rejected',
      errRate: 'too many requests; retrying shortly',
      errNotFound: 'this plan has no API access',
      errGeneric: 'could not read the account',

      // Settings-panel section; see the zh block for the reasoning.
      nav: 'Call counts',
      title: 'Model call counts',
      intro: 'Roughly how many calls each model allows on the current plan. Estimated from the official model allowance, token prices, and one typical request — a reference, not a limit.',
      loading: 'Reading the official call table…',
      planFallback: 'Current plan',
      planLevel: 'Plan allowance',
      planLevelNote: 'The plan allowance is shared by every model; a per-model count is what that model alone would get from it. The official site computes the two differently, so neither can be derived from the other.',
      basis: 'Basis: one request ≈ {in} in / {out} out / {cache} cache-read tokens.',
      inferred: 'There is no official page for this tier; these numbers are inferred from the {from} data.',
      colModel: 'Model',
      colMonthly: 'Monthly',
      colFiveHour: '5-hour',
      colWeek: 'Weekly',
      notGiven: 'not published',
      dashNote: '“—” means the official table publishes no figure for this model. It does not mean zero.',
      freeNote: '“Free” is the site’s own wording for a free/unlimited model, not a number we computed.',
      derivedNote: 'derived from the provider default shape',
      peak: 'Peak: {monthly} monthly · {fiveHour} 5-hour · {week} weekly',
      requestsFallback: '~{count} requests',
      expand: 'Show all {count} models',
      collapse: 'Collapse to your configured models',
      noConfigured: 'Could not tell which models you configured, so all {count} models on this plan are shown.',
      coverage: 'The official table covers {published} models; {available} are available on this plan.',
      empty: 'This plan has no model counts to show right now.',
      statusBundled: 'Bundled baseline, not synced yet: these counts come from the snapshot shipped with the plugin and may already lag behind the official site.',
      statusNever: 'Never checked against the official data.',
      statusStale: 'Not checked for more than 24 hours (last check {time}).',
      statusChecked: 'Last checked {time}.',
      statusUpdated: 'Official data updated {time}.',
      fetchModeHash: 'This machine cannot use the site’s HEAD check, so the host compares whole documents (it still re-parses only when the content changed).',
      failureHead: '{count} item(s) failed this check:',
      errRefresh: 'Check failed: {message}',
      refresh: 'Check for updates',
      refreshing: 'Checking…',
      docLink: 'View the official plans and limits docs',
      warnPlanMissing: 'The official catalog has no entry for this plan.',
      warnPlanNotListed: 'The official catalog has no {planId} tier.',
    },
  }

  const CSS = `
.ccq-warn{display:flex;align-items:center;gap:var(--dshui-space-3);margin-top:10px;padding:var(--dshui-space-3) var(--dshui-space-4);border-radius:var(--dshui-radius-sm);
  font-size:var(--dshui-text-size-sm);line-height:var(--dshui-line-normal);background:var(--dshui-danger-hover);
  color:var(--dshui-danger)}
.ccq-note{margin-top:var(--dshui-space-3);padding-top:var(--dshui-space-3);border-top:var(--dshui-border-width-strong) solid var(--dshui-border-1);
  font-size:var(--dshui-text-size-sm);line-height:var(--dshui-line-normal);color:var(--dshui-text-caption);
  font-variant-numeric:tabular-nums}
.ccq-note+.ccq-note{margin-top:1px;padding-top:0;border-top:none}
.ccq-link{display:inline-block;margin-top:var(--dshui-space-4);font-size:var(--dshui-text-size-sm);line-height:var(--dshui-line-normal);
  color:var(--dshui-link);text-decoration:none}
.ccq-link:hover{text-decoration:underline}
.ccq-error{font-size:var(--dshui-text-size-sm);line-height:var(--dshui-line-normal);color:var(--dshui-danger)}
/* --- composer gauge ---
   The seat immediately left of the model picker in the input row. That row is
   one line, 28px tall (the model control's own height), and already competes for
   width — so exactly one window takes the seat: the tightest one, drawn as a 20px
   arc with its percentage beside it, and the rest of the report lives on the
   tooltips. The number sits outside the ring because inside it there was no room:
   a 28px box with a 2.5px stroke leaves an 18.5px disc, and the text of 88% at
   10px runs about 20px wide, so the digits crossed their own stroke. No popover: the
   composer is docked at the bottom edge, and anything opening out of it risks
   being clipped by the scroll container above. */
/* Block-level flex, not inline-flex. As an inline-level box the button also
   contributes a line box to the seat: the seat measured 31px against the model
   selector's 28px, and the row centres the seat, so the whole gauge sat 1.5px
   above the control it sits beside. A block-level box adds no leading, the seat
   is exactly 28px, and both centres coincide. */
.ccq-rings{appearance:none;display:flex;align-items:center;gap:var(--dshui-space-3);box-sizing:border-box;
  height:28px;padding:0 var(--dshui-space-3);border:none;border-radius:var(--dshui-radius-sm);background:none;
  color:var(--dshui-text-secondary);font:inherit;cursor:pointer}
.ccq-rings:hover{background:var(--dshui-surface-hover)}
.ccq-rings.ccq-stale{opacity:.62}
.ccq-ring{position:relative;flex:none;width:20px;height:20px;display:inline-flex;
  align-items:center;justify-content:center}
/* The whole gauge is rotated, so an arc always grows from twelve o'clock. */
.ccq-ring svg{position:absolute;inset:0;transform:rotate(-90deg)}
/* A track that stays visible in both themes: the hover fill this used to borrow
   is tuned for a surface change, and on the composer's own fill it disappeared
   in dark mode, leaving a white arc floating with no gauge around it. */
.ccq-ring-track{fill:none;stroke:var(--dshui-border-3);stroke-width:2.5}
.ccq-ring-arc{fill:none;stroke-width:2.5;stroke-linecap:round;
  transition:stroke-dasharray var(--dshui-duration-slow) var(--dshui-ease-standard),stroke var(--dshui-duration-slow) var(--dshui-ease-standard)}
/* The number keeps the readable label colour: a level colour that has to clear
   4.5:1 leaves amber and red too dim at this size. The arc carries the level. */
.ccq-ring-num{font-size:var(--dshui-text-size-sm);font-weight:var(--dshui-weight-semibold);line-height:1;font-variant-numeric:tabular-nums;
  color:var(--dshui-text-primary)}
.ccq-chip-err{display:inline-flex;align-items:center;gap:5px;font-size:var(--dshui-text-size-sm);line-height:var(--dshui-line-tight);
  color:var(--dshui-danger)}
/* Not an error: a metered plan legitimately reports no windows to meter. */
.ccq-ring-note{font-size:var(--dshui-text-size-sm);line-height:var(--dshui-line-tight);color:var(--dshui-text-caption)}
/* --- settings section ---
   The ring rules above are sized for a 28px input row. The settings
   panel is wide with 24px padding, so this block sets its own scale and caps
   the line length: a table stretched across a 1600px window is worse to read
   than one at 760px, and the numbers stay paired with their model name. */
.ccq-sec{box-sizing:border-box;width:100%;text-align:left;
  color:var(--dshui-text-primary);font-family:inherit;font-size:var(--dshui-text-size-md);line-height:var(--dshui-line-normal)}
.ccq-sec-title{margin:0;font-size:var(--dshui-text-size-lg);font-weight:var(--dshui-weight-medium);line-height:var(--dshui-line-normal)}
.ccq-sec-intro{margin:var(--dshui-space-2) 0 0;font-size:var(--dshui-text-size-base);line-height:var(--dshui-line-normal);color:var(--dshui-text-tertiary)}
.ccq-detail{display:flex;align-items:baseline;justify-content:space-between;gap:var(--dshui-space-5)}
.ccq-detail-label{font-size:var(--dshui-text-size-md);line-height:var(--dshui-line-normal);color:var(--dshui-text-caption)}
.ccq-detail-value{font-size:var(--dshui-text-size-md);line-height:var(--dshui-line-normal);font-weight:var(--dshui-weight-medium);
  color:var(--dshui-text-primary);text-align:right}
.ccq-panel{margin-top:var(--dshui-space-5);padding:var(--dshui-space-5) 14px;border-radius:var(--dshui-radius-xl);
  border:var(--dshui-border-width) solid var(--dshui-border-2);background:var(--dshui-surface-2)}
.ccq-sec .ccq-note{margin-top:var(--dshui-space-4)}
.ccq-sec .ccq-warn{margin-top:var(--dshui-space-4)}
/* The settings nav draws its own icon before the section label, picked from a
   hard-coded table of built-in ids; a plugin's own mark therefore arrives as the
   label's first child, and the built-in fallback has to be hidden — otherwise the
   row shows a gear and an hourglass side by side. */
.ccq-navmark{display:inline-flex;align-items:center;gap:var(--dshui-space-3);vertical-align:-3px}
button:has(.ccq-navmark)>svg:first-child{display:none}
.ccq-table-wrap{margin-top:10px;overflow-x:auto}
.ccq-table{width:100%;border-collapse:collapse;font-size:var(--dshui-text-size-md);line-height:var(--dshui-line-normal)}
.ccq-table th,.ccq-table td{padding:7px var(--dshui-space-4);border-bottom:var(--dshui-border-width) solid var(--dshui-border-2)}
.ccq-table thead th{font-size:var(--dshui-text-size-sm);font-weight:var(--dshui-weight-medium);color:var(--dshui-text-caption);white-space:nowrap}
.ccq-table tbody tr:last-child th,.ccq-table tbody tr:last-child td{border-bottom:none}
.ccq-table .ccq-num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.ccq-th-model{text-align:left}
.ccq-model{text-align:left;font-weight:var(--dshui-weight-medium);color:var(--dshui-text-primary)}
.ccq-tag{margin-left:var(--dshui-space-3);padding:1px var(--dshui-space-3);border-radius:var(--dshui-radius-sm);font-size:var(--dshui-text-size-xs);line-height:var(--dshui-line-tight);
  font-weight:var(--dshui-weight-regular);background:var(--dshui-surface-hover);color:var(--dshui-text-tertiary)}
.ccq-actions{display:flex;align-items:center;gap:var(--dshui-space-5);flex-wrap:wrap;margin-top:var(--dshui-space-5)}
.ccq-btn{appearance:none;box-sizing:border-box;padding:var(--dshui-space-3) var(--dshui-space-5);border-radius:var(--dshui-radius-sm);
  border:var(--dshui-border-width-strong) solid var(--dshui-border-2);background:var(--dshui-surface-3);
  color:var(--dshui-text-primary);font:inherit;font-size:var(--dshui-text-size-sm);line-height:var(--dshui-line-tight);cursor:pointer}
.ccq-btn:hover:not(:disabled){background:var(--dshui-surface-hover)}
.ccq-btn:disabled{opacity:.6;cursor:default}
.ccq-fold{appearance:none;margin-top:10px;padding:0;border:none;background:none;
  color:var(--dshui-link);font:inherit;font-size:var(--dshui-text-size-sm);line-height:var(--dshui-line-normal);cursor:pointer;text-align:left}
.ccq-fold:hover{text-decoration:underline}
.ccq-sec .ccq-link{margin-top:0}
`

  /** Substitute `{name}` placeholders; the locale service owns the wording only. */
  function format(template, params) {
    return Object.entries(params ?? {})
      .reduce((text, [key, value]) => text.split(`{${key}}`).join(String(value)), String(template))
  }

  /** Native colour token for a used percentage; unknown reads as neutral. */
  function levelToken(percent) {
    if (percent === undefined) return 'var(--dshui-text-caption)'
    const level = LEVELS.find((entry) => percent < entry.below)
    return level === undefined ? LEVELS[LEVELS.length - 1].color : level.color
  }

  function money(value) {
    return typeof value === 'number' && Number.isFinite(value) ? `$${value.toFixed(2)}` : '—'
  }

  /**
   * A percentage straight from the report, clamped into range.
   *
   * The host clamps too, but the card does not assume it: an over-drawn window
   * must never render as "107%", and a nonsensical negative must never render as
   * "-3%". The "over limit" chip carries that fact instead.
   */
  function percentOf(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
    return Math.max(0, Math.min(100, value))
  }

  function percentText(value) {
    const clamped = percentOf(value)
    return clamped === undefined ? '—' : `${clamped.toFixed(1)}%`
  }

  /** Local wall clock for one epoch-millisecond instant. */
  function when(timestamp) {
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return undefined
    const target = new Date(timestamp)
    const pad = (value) => String(value).padStart(2, '0')
    return `${pad(target.getMonth() + 1)}-${pad(target.getDate())} ${pad(target.getHours())}:${pad(target.getMinutes())}`
  }

  /**
   * Terse countdown to a reset instant: `59m`, `3h25m`, `6d9h`.
   *
   * The rings have no room for this, so it rides on each ring's tooltip — but it
   * is the half of a quota reading that a percentage cannot express.
   */
  function shortCountdown(timestamp) {
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return undefined
    // A reset instant that has already passed leaves nothing to count down to.
    // Printing it beside unmoving numbers reads as a frozen gauge, so the tooltip
    // simply omits it for that window.
    const minutes = Math.floor((timestamp - Date.now()) / 60_000)
    if (minutes <= 0) return undefined
    if (minutes < 60) return `${minutes}m`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h${minutes % 60}m`
    return `${Math.floor(hours / 24)}d${hours % 24}h`
  }

  /** Coarse age of a timestamp, for the stale marker. */
  function ageOf(timestamp) {
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return undefined
    const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000))
    if (minutes < 1) return '<1m'
    if (minutes < 60) return `${minutes}m`
    const hours = Math.floor(minutes / 60)
    return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`
  }

  /**
   * Normalize the report's windows into one render shape.
   *
   * The host derives caps and percentages from the account's own plan, so a plan
   * that reports no window (pay-as-you-go Provider, say) yields no row.
   *
   * @param report - the host's normalized quota report.
   * @returns one row per window the account actually reports.
   */
  function windowsOf(report) {
    const periodEnd = report?.plan?.currentPeriodEnd === undefined
      ? undefined
      : Date.parse(report.plan.currentPeriodEnd)
    const rows = []
    for (const { key, label } of WINDOWS) {
      const source = key === 'monthly' ? report?.monthly : report?.[key]
      if (source === undefined || source === null) continue
      const percent = typeof source.percent === 'number' ? source.percent : undefined
      const used = typeof source.used === 'number' ? source.used : undefined
      const cap = typeof source.cap === 'number' && source.cap > 0 ? source.cap : undefined
      if (percent === undefined && cap === undefined) continue
      rows.push({
        key,
        label,
        percent,
        used,
        cap,
        // Clamped at zero: the report keeps the vendor's raw figure, but a
        // negative "remaining" reads as a rendering bug on a plan card. An
        // overdrawn allowance is already saying "nothing left" through the red
        // bar and the 100% headline.
        remaining: used !== undefined && cap !== undefined ? Math.max(0, cap - used) : undefined,
        resetAt: key === 'monthly' ? periodEnd : source.resetAt,
        exceeded: source.exceeded === true,
        // Set by the host when the two endpoints behind the monthly figures
        // cannot both describe the same instant. The figures are forwarded
        // as-is, but nothing built from them may be presented as fact.
        capSuspect: key === 'monthly' && source.capSuspect === true,
      })
    }
    return rows
  }

  /**
   * True when some window is close enough to its cap to poll faster.
   *
   * "Close to" excludes "past": see {@link SPENT_PERCENT}.
   */
  function anyHot(report) {
    return windowsOf(report).some((row) => {
      const percent = percentOf(row.percent)
      return percent !== undefined && percent >= HOT_PERCENT && percent < SPENT_PERCENT
    })
  }

  /**
   * Everything worth warning about, in priority order.
   *
   * Nothing renders these as a row any more — the rings are percentages only — so
   * they reach the user through the ring group's tooltip. They stay in the
   * component rather than being dropped: a canceled subscription is not something
   * a percentage can express.
   */
  function warningsOf(report, t) {
    const warnings = []
    if (report?.monthly?.belowThreshold === true) warnings.push(t('belowThreshold'))
    const plan = report?.plan
    if (plan?.cancelAtPeriodEnd === true) {
      warnings.push(format(t('subCanceled'), { date: when(Date.parse(plan.currentPeriodEnd)) ?? '—' }))
    } else if (plan?.status !== undefined && plan.status !== 'active') {
      warnings.push(format(t('subStatus'), { status: plan.status }))
    }
    return warnings
  }

  function describeError(result) {
    if (result !== null && typeof result === 'object' && typeof result.error?.message === 'string') {
      return result.error.message
    }
    return 'unrecognized response'
  }

  /**
   * Turn a host error message into something readable in a narrow seat.
   *
   * The host's message is diagnostic — it names endpoints and status codes —
   * which is right for a log and wrong for a card: a wall of stacked lines in a
   * narrow column reads as a rendering bug. Known codes become one short line, the
   * full text stays one hover away, and an unknown code falls back to the message
   * itself, because a card that says nothing is worse than one that says something
   * clumsy.
   */
  function errorText(message, t) {
    const code = /^\[([A-Z_]+)\]/.exec(String(message ?? ''))?.[1]
    const keys = {
      NETWORK: 'errNetwork',
      SERVICE: 'errNetwork',
      AUTH: 'errAuth',
      RATE_LIMIT: 'errRate',
      NOT_FOUND: 'errNotFound',
      BAD_RESPONSE: 'errGeneric',
      MISSING_CREDENTIAL: 'errGeneric',
    }
    const key = keys[code]
    return key === undefined ? String(message ?? '') : t(key)
  }

  /**
   * Fetch the report, then keep fetching on a cadence that tightens while any
   * window is close to its cap. The last good report survives failures, so a
   * transient error dims the numbers instead of blanking the card.
   *
   * @param fetchQuota - transport callback injected by the slot registration.
   * @returns the current state plus a manual refresh.
   */
  function useQuota(fetchQuota) {
    const [state, setState] = React.useState({ phase: 'idle' })
    const [nonce, setNonce] = React.useState(0)

    React.useEffect(() => {
      const controller = new AbortController()
      let timer
      // How many answers in a row have been snapshots. The first one earns a
      // quick re-read — a live report is already on its way, and this is the
      // moment the user is actually looking at the card. If they keep coming,
      // the host is having trouble upstream and hammering it every few seconds
      // would help nobody.
      let staleStreak = 0
      const load = () => {
        const fail = (message) => {
          setState((previous) => ({ phase: 'error', message, report: previous.report, at: previous.at }))
          timer = window.setTimeout(load, SLOW_MS)
        }
        // Promise.resolve() turns a synchronous throw from the transport into
        // a rejection, so the card reports it instead of unmounting.
        Promise.resolve()
          .then(() => fetchQuota(controller.signal))
          .then(
            (result) => {
              if (controller.signal.aborted) return
              if (result === null || typeof result !== 'object' || result.ok !== true) {
                fail(describeError(result))
                return
              }
              const value = result.value
              if (value !== null && typeof value === 'object' && value.configured === false) {
                // This host does not use Command Code: stay invisible, but ask
                // again on a slow cadence rather than never — see ABSENT_MS.
                setState({ phase: 'absent' })
                timer = window.setTimeout(load, ABSENT_MS)
                return
              }
              setState({ phase: 'ready', report: value, at: Date.now() })
              const isSnapshot = value.stale === true
              staleStreak = isSnapshot ? staleStreak + 1 : 0
              timer = window.setTimeout(
                load,
                isSnapshot
                  ? (staleStreak === 1 ? REVALIDATE_MS : SLOW_MS)
                  : (anyHot(value) ? FAST_MS : SLOW_MS),
              )
            },
            (error) => {
              if (controller.signal.aborted) return
              fail(String(error?.message ?? error))
            },
          )
      }
      load()
      return () => {
        window.clearTimeout(timer)
        controller.abort()
      }
    }, [fetchQuota, nonce])

    const refresh = React.useCallback(() => { setNonce((value) => value + 1) }, [])
    return { state, refresh }
  }

  /**
   * Tooltip body: one line per window, so the bubble reads as a small ledger
   * rather than one run-on sentence. The lines are returned separately because
   * the caller joins them with newlines and the bubble honours them.
   *
   * Each line carries everything the seat can say about that window: its name,
   * the exact one-decimal percentage, the money still on it, and when it lifts.
   * The reset countdown belongs here rather than on the ring alone, because the
   * ring's own native tooltip is suppressed once the bubble exists.
   *
   * @param rows - the windows from {@link windowsOf}.
   * @param t - the locale binding.
   * @returns one string per window, shortest window first.
   */
  function summaryTitle(rows, t) {
    return rows.map((row) => {
      const headline = row.capSuspect
        ? `${t(row.label)} ${t('straddle')}`
        : `${t(row.label)} ${percentText(row.percent)}${row.remaining === undefined ? '' : ` (${t('left')} ${money(row.remaining)})`}`
      const countdown = shortCountdown(row.resetAt)
      return countdown === undefined ? headline : `${headline} · ${format(t('reset'), { time: countdown })}`
    })
  }

  /**
   * Ring geometry: a 20px gauge inside the 28px input row.
   *
   * The ring holds no text. At the earlier 28px box with a 2.5px stroke the inner
   * disc was 18.5px across while a 10px `88%` is about 20px wide, so the number
   * crossed its own stroke — which is what made the gauge look broken rather than
   * read. The value now sits beside the ring and the ring keeps only the arc.
   */
  const RING_BOX = 20
  const RING_RADIUS = 8
  /** Circumference, the length the progress arc is measured against. */
  const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

  /**
   * One arc gauge: a full track and a progress arc, with the value beside it.
   *
   * A ring rather than a bar because this is the only gauge in the composer: a
   * short bar beside a longer one reads as a chart to decode, while a circle
   * reads as a single state. The value is the *used* percentage, matching the
   * percentage the official dashboard shows; the arc repeats it as the share of
   * the circle.
   *
   * @param props.percent - used percentage, or undefined when unreported.
   * @param props.color - the arc's level colour, already resolved.
   * @param props.label - accessible name and tooltip, e.g. `5 小时 15.6%`.
   */
  function Ring({ percent, color, label }) {
    const filled = percent === undefined ? 0 : Math.max(0, Math.min(100, percent))
    const arc = (RING_CIRCUMFERENCE * filled) / 100
    // The ring's own label is only the native fallback: with the primitive in
    // place the seat's bubble already names every window, and a second native
    // strip appearing over one ring would fight it.
    return h('span', { className: 'ccq-ring', title: Tooltip === null ? label : undefined },
      h('svg', { viewBox: `0 0 ${RING_BOX} ${RING_BOX}`, width: RING_BOX, height: RING_BOX, 'aria-hidden': 'true' },
        h('circle', {
          className: 'ccq-ring-track',
          cx: RING_BOX / 2, cy: RING_BOX / 2, r: RING_RADIUS,
        }),
        h('circle', {
          className: 'ccq-ring-arc',
          cx: RING_BOX / 2, cy: RING_BOX / 2, r: RING_RADIUS,
          stroke: color,
          // Arc first, then a gap past the whole circumference, so a full ring
          // is drawn once rather than repeating a short dash.
          strokeDasharray: `${arc} ${RING_CIRCUMFERENCE}`,
        }),
      ),
    )
  }

  /**
   * Rank one window by how close it is to its cap, highest first.
   *
   * A window the report flagged as straddling a billing boundary has no
   * percentage anyone should act on, so it ranks below every readable one and
   * only wins when nothing else can be read at all.
   *
   * @param row - one window from {@link windowsOf}.
   * @returns the used percentage, or -1 for an unreadable window.
   */
  function tightness(row) {
    if (row.capSuspect) return -1
    const percent = percentOf(row.percent)
    return percent === undefined ? -1 : percent
  }

  /**
   * Hang a tooltip off one anchor element, or leave the anchor bare when the
   * primitive is unreachable.
   *
   * `side: 'top'` because the composer sits on the bottom edge and there is no
   * room below it; `portal: true` so the bubble is not clipped by the scroll
   * container above the composer; `delayMs: 500` is the delay the composer's own
   * controls use, so hovering the gauge feels like hovering the model picker
   * beside it. The label may be a resolver: it is evaluated only while the bubble
   * is up, so a poll that lands mid-hover shows the new figures without making
   * every render build the text.
   *
   * @param label - bubble text, or a resolver returning it.
   * @param anchor - the single element the bubble hangs off.
   * @returns the anchor, or the anchor wrapped in a tooltip.
   */
  function withTip(label, anchor) {
    if (Tooltip === null) return anchor
    return h(Tooltip, { label, side: 'top', delayMs: 500, gap: 8, portal: true, maxWidth: 360 }, anchor)
  }

  /**
   * The composer gauge: the quota seat immediately left of the model picker.
   *
   * One arc for the *tightest* window and its number beside it, rather than one
   * circle per window. Three equal circles spent roughly 100px of a one-line row
   * repeating two readings that are almost always far from their caps, and they
   * were unlabelled — which window a number belonged to lived only in a tooltip,
   * so each glance cost a guess. The window that is actually about to run out is
   * the one worth the space; the other two, and every exact figure, are on the
   * group's tooltip and one hover away on the ring itself.
   *
   * It renders nothing at all when this host has no Command Code provider, and
   * clicking it re-reads the account after a failure.
   */
  function QuotaChip(props) {
    const { state, refresh } = useQuota(props.fetchQuota)
    const t = props.t

    if (state.phase === 'absent' || state.phase === 'idle') return null

    const report = state.report
    if (report === undefined) {
      // One readable sentence, the host's own diagnostic on the tooltip, and a
      // click to try again.
      const message = state.message ?? ''
      return withTip(message, h('button', {
        type: 'button',
        className: 'ccq-rings',
        title: Tooltip === null ? message : undefined,
        onClick: refresh,
      }, h('span', { className: 'ccq-chip-err' }, errorText(message, t))))
    }

    const rows = windowsOf(report)
    if (rows.length === 0) {
      // A metered plan reports no windows at all. Saying so is the whole point: a
      // seat that quietly disappears reads as a broken component, when in fact the
      // account is fine and simply has nothing to meter.
      const note = `${t('chipTitle')} · ${report.plan?.name ?? 'Command Code'}`
      return withTip(note, h('div', {
        className: 'ccq-rings ccq-stale',
        title: Tooltip === null ? note : undefined,
      }, h('span', { className: 'ccq-ring-note' }, t('none'))))
    }

    const stale = state.phase === 'error' || report.stale === true
    const planName = report.plan?.name ?? 'Command Code'
    // The gauge carries one percentage, so every notice the removed sidebar card
    // used to print lives in this bubble instead. Dropping them along with the
    // card would have quietly removed the only place a canceled subscription or a
    // half-failed read was ever mentioned.
    const degraded = Array.isArray(report.failures) ? report.failures.length : 0

    /**
     * The bubble text, built on demand.
     *
     * A resolver rather than a string: the tooltip evaluates it only while the
     * bubble is up, so the figure inside is whatever the latest poll returned, and
     * the common case of a seat nobody is hovering costs nothing.
     *
     * @returns the multi-line report the bubble shows.
     */
    const tip = () => [`${t('chipTitle')} · ${planName}`]
      .concat(summaryTitle(rows, t))
      .concat(warningsOf(report, t))
      .concat(degraded === 0 ? [] : [format(t('degraded'), { count: degraded })])
      .concat(stale ? [format(t('stale'), { age: ageOf(state.at) ?? '—' })] : [])
      .join('\n')

    // The tightest window wins the seat: it is the next limit to run out, and
    // `windowsOf` already lists the windows shortest first, so a tie keeps the
    // earlier one.
    const tightest = rows.reduce((best, row) => (tightness(row) > tightness(best) ? row : best), rows[0])
    const percent = tightest.capSuspect ? undefined : percentOf(tightest.percent)
    const countdown = shortCountdown(tightest.resetAt)
    // The window, its exact percentage, and when it lifts. A percentage alone
    // cannot say whether a tight window is about to reset.
    const label = [
      `${t(tightest.label)} ${tightest.capSuspect ? t('straddle') : percentText(tightest.percent)}`,
      countdown === undefined ? undefined : format(t('reset'), { time: countdown }),
    ].filter((part) => part !== undefined).join(' · ')

    return withTip(tip, h('button', {
      type: 'button',
      className: `ccq-rings${stale ? ' ccq-stale' : ''}`,
      title: Tooltip === null ? tip() : undefined,
      onClick: refresh,
      'aria-label': tip().replace(/\n/g, ' · '),
    },
      h(Ring, { percent, color: levelToken(percent), label }),
      // The number keeps the readable label colour: at a level colour that has to
      // clear 4.5:1 leaves amber and red too dim at this size. The arc carries
      // the level.
      h('span', { className: 'ccq-ring-num' }, percent === undefined ? '—' : `${Math.round(percent)}%`),
    ))
  }

  /**
   * The site's own number formatting, copied from the host half's `catalog.mjs`.
   *
   * A browser half cannot load a Node module, so this is a deliberate copy
   * rather than a shared helper: **keep it in sync with `formatCount` in
   * `catalog.mjs`** — `toPrecision(3)` through `toLocaleString('en-US')`, `Free`
   * for a model the site prices as unlimited, and `—` for a count the official
   * table never published. Printing `0` where the table is silent would claim a
   * model cannot be called at all. A free model's counts arrive as `null` — JSON
   * has no `Infinity` — and reach this function as `Infinity` through
   * {@link countOf}.
   *
   * @param value - a raw count from the host's catalog view.
   * @returns the display text.
   */
  function formatCount(value) {
    if (value === undefined || value === null) return '—'
    if (!Number.isFinite(value)) return 'Free'
    if (value <= 0) return '0'
    return Number(value.toPrecision(3)).toLocaleString('en-US')
  }

  /**
   * Translator for the settings section.
   *
   * The settings shell owns the props it hands a section — `close`, `t`,
   * `renderSlot`, `useStore` and `actions` are its names, never ours — so the
   * section reads this binding to the component's own `cc-quota` namespace instead
   * of claiming a prop. `install()` sets it before registering the section, and it
   * stays the live reader the locale service returned, so the panel follows a
   * language switch.
   */
  let sectionT = (key) => key

  /** The first argument that is a non-empty string, or undefined. */
  function firstString(...values) {
    return values.find((value) => typeof value === 'string' && value !== '')
  }

  /** Timestamps arrive as ISO strings from the catalog and as epoch ms elsewhere. */
  function whenValue(value) {
    const ms = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : Number.NaN
    return Number.isFinite(ms) ? when(ms) : undefined
  }

  /**
   * True when the official table publishes no count for this model.
   *
   * `estimated === false` is the host's own signal (a model the plan can use but
   * the call table does not cover); the data check behind it is only a fallback
   * for a host that predates that field. A free model is never "missing" — see
   * {@link countOf}.
   */
  function noCount(model) {
    if (model === null || typeof model !== 'object') return false
    if (model.estimated === false) return true
    if (model.estimated !== undefined) return false
    const absent = (value) => value === undefined || value === null
    return model.free !== true && absent(model.monthly) && absent(model.fiveHour) && absent(model.week)
  }

  /**
   * One count as `formatCount` should see it.
   *
   * A free model's counts arrive as `null` — JSON has no `Infinity` — with the
   * model's own `free` flag carrying the meaning. `formatCount` owns the `Free`
   * wording, so the substitution happens here rather than in a second copy of
   * that function.
   */
  function countOf(model, key) {
    if (model?.free === true) return Number.POSITIVE_INFINITY
    return model?.[key]
  }

  /**
   * Normalize one host answer for the settings section.
   *
   * Three answers must never be presented as "your plan has no models": a host
   * whose report predates the catalog field (`hidden`), a host with no Command
   * Code provider at all (`absent`), and a failure (`error`, keeping whatever the
   * section already had). Everything else renders.
   *
   * @param result - the `server-response` envelope the host returns.
   * @param previous - the catalog already on screen, carried across failures.
   * @returns the section's next state.
   */
  function catalogState(result, previous) {
    if (result === null || typeof result !== 'object' || result.ok !== true) {
      return { phase: 'error', message: describeError(result), catalog: previous }
    }
    const value = result.value
    if (value !== null && typeof value === 'object' && value.configured === false) {
      return { phase: 'absent' }
    }
    const catalog = value !== null && typeof value === 'object' ? value.catalog : undefined
    if (catalog === null || typeof catalog !== 'object') {
      // Older host: the report carries no catalog. Hiding is the one honest
      // answer — an empty panel would look like a statement about the plan.
      return { phase: 'hidden' }
    }
    return { phase: 'ready', catalog }
  }

  /**
   * Catalog reads for the settings section.
   *
   * Deliberately not the composer gauge's poll. A settings page is opened on
   * purpose and can be left open for a long time, and every catalog read costs
   * upstream requests against the same account the user is coding on: one read
   * when the section mounts, one per explicit "check for updates".
   *
   * @param props - the section's injected face (`fetchQuota`, `refreshQuota`).
   * @returns the current state, whether a check is running, and the trigger.
   */
  function useCatalog(props) {
    const [state, setState] = React.useState({ phase: 'loading' })
    const [refreshing, setRefreshing] = React.useState(false)
    // The transport lives in a ref: a shell that hands over a fresh injected face
    // on every render must not make the mount read run again.
    const transport = React.useRef(props)
    transport.current = props

    React.useEffect(() => {
      const controller = new AbortController()
      // Promise.resolve() turns a synchronous throw from the transport into a
      // rejection, so a broken face reports itself instead of unmounting.
      Promise.resolve()
        .then(() => transport.current.fetchQuota(controller.signal))
        .then(
          (result) => {
            if (controller.signal.aborted) return
            setState((previous) => catalogState(result, previous.catalog))
          },
          (error) => {
            if (controller.signal.aborted) return
            setState((previous) => ({
              phase: 'error',
              message: String(error?.message ?? error),
              catalog: previous.catalog,
            }))
          },
        )
      return () => { controller.abort() }
    }, [])

    const refresh = React.useCallback(() => {
      setRefreshing(true)
      Promise.resolve()
        .then(() => transport.current.refreshQuota())
        .then(
          (result) => {
            setState((previous) => catalogState(result, previous.catalog))
            setRefreshing(false)
          },
          (error) => {
            // A failed check keeps the numbers: they are still the last thing the
            // official table said, and blanking them would destroy the only
            // information the user came for.
            setState((previous) => ({ ...previous, refreshError: String(error?.message ?? error) }))
            setRefreshing(false)
          },
        )
    }, [])

    return { state, refreshing, refresh }
  }

  /** Human wording for one warning code from the host's catalog view. */
  function warningText(code, t) {
    if (typeof code !== 'string' || code === '') return undefined
    // Already stated by the provenance line, in full sentences.
    if (code === 'catalog-bundled-baseline') return undefined
    if (code === 'catalog-plan-missing') return t('warnPlanMissing')
    if (code.startsWith('catalog-plan-not-listed:')) {
      return format(t('warnPlanNotListed'), { planId: code.slice('catalog-plan-not-listed:'.length) })
    }
    // An unrecognised code is still a fact; show it rather than swallow it.
    return code
  }

  /**
   * Everything that qualifies the numbers, in the order a reader needs it: where
   * the data came from, how fresh it is, then what this check could not read.
   * Nothing here may be skipped — a silent gap is what makes a user blame their
   * own account.
   */
  function catalogStatus(catalog, t) {
    const lines = []
    const checked = whenValue(catalog.checkedAt)
    if (catalog.origin === 'bundled' || catalog.verified !== true) {
      lines.push({ key: 'bundled', tone: 'warn', text: t('statusBundled') })
    }
    if (catalog.neverSynced === true) {
      lines.push({ key: 'never', tone: 'warn', text: t('statusNever') })
    } else if (catalog.stale === true) {
      lines.push({
        key: 'stale',
        tone: 'warn',
        text: checked === undefined ? t('statusNever') : format(t('statusStale'), { time: checked }),
      })
    } else if (checked !== undefined) {
      lines.push({ key: 'checked', tone: 'note', text: format(t('statusChecked'), { time: checked }) })
    }
    const updated = whenValue(catalog.updatedAt)
    if (updated !== undefined) {
      lines.push({ key: 'updated', tone: 'note', text: format(t('statusUpdated'), { time: updated }) })
    }
    // A host whose machine cannot use the site's conditional HEAD request falls
    // back to comparing whole documents. That is a working mode, not a failure:
    // one quiet line, no warning colour.
    if (catalog.fetchMode === 'hash') {
      lines.push({ key: 'fetch-mode', tone: 'note', text: t('fetchModeHash') })
    }
    if (firstString(catalog.inferredFrom) !== undefined) {
      lines.push({
        key: 'inferred',
        tone: 'note',
        text: format(t('inferred'), { from: catalog.inferredFrom }),
      })
    }
    const failures = Array.isArray(catalog.failures) ? catalog.failures : []
    if (failures.length > 0) {
      lines.push({ key: 'failures', tone: 'warn', text: format(t('failureHead'), { count: failures.length }) })
      for (const [index, failure] of failures.entries()) {
        // Name the item: "something failed" is not actionable, a URL and a status
        // code are.
        const code = firstString(failure?.code) ?? t('errGeneric')
        const message = firstString(failure?.message) ?? ''
        const url = firstString(failure?.url)
        lines.push({
          key: `failure-${String(index)}`,
          tone: 'warn',
          text: url === undefined ? `${code}: ${message}` : `${code}: ${message} — ${url}`,
        })
      }
    }
    for (const [index, code] of (Array.isArray(catalog.warnings) ? catalog.warnings : []).entries()) {
      const text = warningText(code, t)
      if (text !== undefined) lines.push({ key: `warning-${String(index)}`, tone: 'note', text })
    }
    return lines
  }

  /**
   * The plan-level row: a label and its value on one line.
   *
   * The standalone bundle called `Detail` here without ever defining it, so the
   * settings section threw as soon as it had a plan to show. This port keeps the
   * call's shape and supplies the component, using the section's own text roles.
   */
  function Detail({ label, value }) {
    return h('div', { className: 'ccq-detail' }, [
      h('span', { className: 'ccq-detail-label', key: 'label' }, label),
      h('span', { className: 'ccq-detail-value', key: 'value' }, value),
    ])
  }

  /** One model row: the name, then the three counts, right-aligned. */
  function ModelRow({ model, t }) {
    const name = firstString(model?.name, model?.key) ?? '—'
    const tips = []
    const modelId = firstString(model?.modelId)
    if (modelId !== undefined) tips.push(modelId)
    const peak = model?.peak
    // A free model has no peak/off-peak distinction to draw: every hour is free.
    if (peak !== null && typeof peak === 'object' && model?.free !== true) {
      // Peak-time pricing only ever reaches a tooltip: the site shows the off-peak
      // shape by default and this section follows the site.
      tips.push(format(t('peak'), {
        monthly: formatCount(peak.monthly),
        fiveHour: formatCount(peak.fiveHour),
        week: formatCount(peak.week),
      }))
    }
    return h('tr', { title: tips.length === 0 ? undefined : tips.join(' · ') },
      h('th', { scope: 'row', className: 'ccq-model' },
        name,
        noCount(model) ? h('span', { className: 'ccq-tag' }, t('notGiven')) : null,
        model.derived === true ? h('span', { className: 'ccq-tag', title: t('derivedNote') }, t('derivedNote')) : null,
      ),
      h('td', { className: 'ccq-num' }, formatCount(countOf(model, 'monthly'))),
      h('td', { className: 'ccq-num' }, formatCount(countOf(model, 'fiveHour'))),
      h('td', { className: 'ccq-num' }, formatCount(countOf(model, 'week'))),
    )
  }

  /** The per-model table: what one model alone would get out of the plan. */
  function ModelTable({ models, t }) {
    return h('div', { className: 'ccq-table-wrap' },
      h('table', { className: 'ccq-table' },
        h('thead', null,
          h('tr', null,
            h('th', { scope: 'col', className: 'ccq-th-model' }, t('colModel')),
            h('th', { scope: 'col', className: 'ccq-num' }, t('colMonthly')),
            h('th', { scope: 'col', className: 'ccq-num' }, t('colFiveHour')),
            h('th', { scope: 'col', className: 'ccq-num' }, t('colWeek')),
          ),
        ),
        h('tbody', null, ...models.map((model, index) => h(ModelRow, {
          key: firstString(model?.key) ?? `model-${String(index)}`,
          model,
          t,
        }))),
      ),
    )
  }

  /**
   * This section's own mark: an hourglass, at the size and stroke the built-in
   * icons use (16px box, 1.3 stroke, single `currentColor`, no fill).
   *
   * It reads as "how much of the allowance is left to spend", which is what the
   * section is about, and it is the one shape in this icon set that nothing else
   * uses — the alternative the host offers is a fallback gear, and borrowing a
   * built-in id would put the wrong label next to someone else's picture.
   */
  function CcqCallsMark({ size = 16 }) {
    return h('svg', {
      width: size,
      height: size,
      viewBox: '0 0 16 16',
      fill: 'none',
      xmlns: 'http://www.w3.org/2000/svg',
      'aria-hidden': 'true',
      strokeWidth: 1.3,
    },
      h('path', { d: 'M3.9 2.5H12.1L8 7L3.9 2.5Z', stroke: 'currentColor' }),
      h('path', { d: 'M3.9 13.5H12.1L8 9L3.9 13.5Z', stroke: 'currentColor' }),
      h('circle', { cx: 8, cy: 5.6, r: 1.15, fill: 'currentColor', stroke: 'none' }),
    )
  }

  /**
   * The settings-panel section: what the current plan allows per model.
   *
   * The shell gives its body vertical scroll and 24px of padding and draws no
   * heading of its own, so this component brings its own title. The default view
   * is the models the user configured; the official table also covers models they
   * do not use, which stay one click away rather than in the way.
   */
  function QuotaSettingsSection(props) {
    const t = sectionT
    const [expanded, setExpanded] = React.useState(false)
    const { state, refreshing, refresh } = useCatalog(props)

    if (state.phase === 'loading') {
      return h('section', { className: 'ccq-sec' },
        h('h2', { className: 'ccq-sec-title' }, t('title')),
        h('div', { className: 'ccq-note' }, t('loading')),
      )
    }
    if (state.phase === 'hidden' || state.phase === 'absent') return null

    const catalog = state.catalog
    const rows = Array.isArray(catalog?.models) ? catalog.models : []
    const configured = rows.filter((model) => model?.configured === true)
    // Only the configured models are hidden, so the fold is worth offering
    // exactly when there is something else to show.
    const foldable = configured.length > 0 && configured.length < rows.length
    const visible = expanded || configured.length === 0 ? rows : configured
    const level = catalog?.planLevel
    const basis = catalog?.basis
    const doc = firstString(catalog?.docUrl, level?.sourceUrl)
    const errorMessage = state.phase === 'error' ? state.message : state.refreshError
    const planName = firstString(catalog?.planName, catalog?.planId) ?? t('planFallback')

    const levelParts = []
    if (level !== null && typeof level === 'object') {
      const label = firstString(level.label)
      const credits = typeof level.credits === 'number' && Number.isFinite(level.credits)
        ? `$${level.credits.toLocaleString('en-US')}`
        : firstString(level.credits)
      const requests = firstString(level.requestsText)
        ?? (typeof level.requests === 'number' && Number.isFinite(level.requests)
          ? format(t('requestsFallback'), { count: formatCount(level.requests) })
          : undefined)
      // The pricing table's own label is usually the plan name again; printing
      // "GOAT · GOAT" reads as a rendering bug, not as emphasis.
      levelParts.push(
        ...[label === planName ? undefined : label, credits, requests].filter((part) => part !== undefined),
      )
    }

    const coverage = catalog?.coverage
    const published = typeof coverage?.published === 'number' ? coverage.published : 0
    const available = typeof coverage?.available === 'number' ? coverage.available : 0

    // A failed first read has no catalog to describe: the error line and the
    // button are then the whole story. A plan panel, a provenance line or a
    // "no counts" note would describe data nobody has.
    const panels = catalog === undefined ? [] : [
      // Plan-level first, and explicitly labelled as a different measurement:
      // the two numbers on this page are the two the site refuses to convert.
      h('div', { key: 'plan', className: 'ccq-panel' },
        h(Detail, {
          label: t('planLevel'),
          value: levelParts.length === 0 ? planName : `${planName} · ${levelParts.join(' · ')}`,
        }),
        h('div', { key: 'level-note', className: 'ccq-note' }, t('planLevelNote')),
        basis === null || typeof basis !== 'object' ? null : h('div', { key: 'basis', className: 'ccq-note' },
          format(t('basis'), {
            in: formatCount(basis.inputTokens),
            out: formatCount(basis.outputTokens),
            cache: formatCount(basis.cacheReadTokens),
          })),
      ),
      ...catalogStatus(catalog, t).map((line) => h('div', {
        key: line.key,
        className: line.tone === 'warn' ? 'ccq-warn' : 'ccq-note',
      }, line.text)),
      h('div', { key: 'models', className: 'ccq-panel' },
        // An empty table is still an explanation, never a blank block.
        rows.length === 0
          ? h('div', { className: 'ccq-note' }, t('empty'))
          : h(ModelTable, { models: visible, t }),
        configured.length === 0 && rows.length > 0
          ? h('div', { key: 'no-config', className: 'ccq-note' }, format(t('noConfigured'), { count: rows.length }))
          : null,
        foldable ? h('button', {
          key: 'fold',
          type: 'button',
          className: 'ccq-fold',
          'aria-expanded': expanded,
          onClick: () => setExpanded((value) => !value),
        }, expanded ? t('collapse') : format(t('expand'), { count: rows.length })) : null,
        visible.some(noCount) ? h('div', { key: 'dash', className: 'ccq-note' }, t('dashNote')) : null,
        visible.some((model) => model?.free === true)
          ? h('div', { key: 'free', className: 'ccq-note' }, t('freeNote'))
          : null,
        published + available === 0 ? null : h('div', { key: 'coverage', className: 'ccq-note' },
          format(t('coverage'), { published: String(published), available: String(available) })),
      ),
    ]

    return h('section', { className: 'ccq-sec' },
      h('h2', { className: 'ccq-sec-title' }, t('title')),
      h('p', { className: 'ccq-sec-intro' }, t('intro')),
      ...panels,
      errorMessage === undefined ? null : h('div', { className: 'ccq-error', title: errorMessage },
        state.phase === 'error'
          ? errorText(errorMessage, t)
          : format(t('errRefresh'), { message: errorText(errorMessage, t) })),
      state.phase === 'error' ? h('div', { className: 'ccq-note' }, t('retry')) : null,
      h('div', { className: 'ccq-actions' },
        h('button', {
          type: 'button',
          className: 'ccq-btn ccq-refresh',
          disabled: refreshing,
          onClick: refresh,
        }, refreshing ? t('refreshing') : t('refresh')),
        doc === undefined ? null : h('a', {
          className: 'ccq-link',
          href: doc,
          target: '_blank',
          rel: 'noreferrer',
        }, t('docLink')),
      ),
    )
  }

  /**
   * Install this component's sheet, its dictionaries, the settings section, and
   * the gauge itself.
   *
   * All three services are awaited together: the gauge needs `connection` for its
   * report, the section needs `locale` for its catalog wording, and both need
   * `slots` to have a seat. A profile that composes none of them simply gets no
   * quota UI — the shipped composer is untouched, which is the same outcome the
   * standalone plugin's `inject` produced.
   *
   * @param ctx - client root context.
   */
  function install(ctx) {
    rt.style('quota', CSS)

    ctx.inject(['locale', 'slots', 'connection'], (scope) => {
      scope.effect(() => scope.locale.register(NS, DICT), 'ui-copy/quota: dictionaries')
      const t = scope.locale.bind(NS)
      // The settings section reads this binding instead of a `t` prop: see sectionT.
      sectionT = t

      // Settings panel: one section on the same ledger as the built-in sections,
      // ordered after every one of them (account -10 … agent-presets 20).
      //
      // The nav row renders `navIcon(id)` first and the label after it, and the
      // icon lookup is a hard-coded table that only knows the built-in ids — a
      // plugin has no `icon` option and gets the fallback gear. The label,
      // however, is rendered as a React child, so it is the one channel a plugin
      // has for its own mark: the node below carries our icon, and the stylesheet
      // hides the gear.
      scope.slots.inject('settings.section', () => scope.slots.register({
        name: 'settings.section',
        id: 'commandcode-quota',
        order: 100,
        label: () => h('span', { className: 'ccq-navmark' }, h(CcqCallsMark, { size: 16 }), t('nav')),
        locale: NS,
        inject: () => ({
          // `payload` is optional; the default `{ catalog: true }` lets the host
          // decide whether the catalog has aged out and needs a re-check, and the
          // answer carries the resulting view. Without it a section mount would
          // return the cache forever: the gauge's own poll never re-validates.
          fetchQuota: (signal, payload) => scope.connection.rpc.call(CHANNEL, ENDPOINT, payload ?? { catalog: true }, signal),
          refreshQuota: (signal) => scope.connection.rpc.call(CHANNEL, ENDPOINT, { catalogRefresh: true }, signal),
        }),
      }, QuotaSettingsSection))

      // The composer chip sits immediately left of the model picker: the
      // conversation package renders `conversation.input.right` and
      // `conversation.input.model` as siblings in one `standardControls` row, so a
      // registration here lands beside the model control rather than replacing it
      // (`conversation.input.model` is a single-occupant seat and registering into
      // it would take the picker away).
      scope.slots.inject('conversation.input.right', () => scope.slots.register({
        name: 'conversation.input.right',
        id: 'cc-quota-chip',
        order: 0,
        inject: () => ({
          fetchQuota: (signal) => scope.connection.rpc.call(CHANNEL, ENDPOINT, {}, signal),
          t,
        }),
      }, QuotaChip))
    })
  }

  install(rt.ctx)
}
