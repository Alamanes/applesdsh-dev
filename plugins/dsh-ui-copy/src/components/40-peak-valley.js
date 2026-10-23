/**
 * Sidebar-foot peak/valley hint.
 *
 * Renders as one `sidebar.footer.action` entry — the slot the sidebar declares
 * for "optional actions beside Settings" — so the column owns the placement,
 * hands the entry the column state (`wide`) and the bound translator, and this
 * component owns nothing but its own row. In the 56px rail there is no room for
 * a sentence, so it renders nothing at all.
 *
 * The rule, as the API bills it:
 *
 *   - peak: Monday to Friday, 09:00–12:00 and 14:00–18:00 Beijing time, on days
 *     that are not a public holiday;
 *   - valley: every other hour, including all of Saturday and Sunday and all of
 *     a public holiday, at any hour.
 *
 * Beijing is a fixed +08:00 offset, so the clock is arithmetic on the epoch
 * rather than a time zone lookup, and the hint reads the same on a machine in
 * any locale.
 *
 * The switch scan walks Beijing's own hour boundaries — 00:00, 09:00, 12:00,
 * 14:00, 18:00 — forward until the verdict flips, which covers a nine-day
 * holiday run with room to spare. The countdown ticks once a second; the label
 * itself only changes at a switch.
 *
 * Holiday dates are the one part a clock cannot derive. The suite's host half
 * serves them on {@link HOLIDAY_ROUTE}; this half starts on
 * {@link FALLBACK_HOLIDAYS}, so the first paint is already right, then adopts
 * the route's answer when it arrives. A route that fails or answers empty
 * leaves the fallback in place: that is the only path that can go stale, and it
 * only happens while the source is unreachable.
 *
 * Two packages come from outside this bundle. React is required for the row
 * itself; the primitives package only supplies the optional tooltip, so its
 * absence degrades to the plain row instead of disabling the component.
 */
function dshuiComponent_peak_valley(rt) {
  const React = rt.require('react')
  if (React === null) {
    rt.warn('react is not in this boot graph; the peak-valley hint is skipped')
    return
  }
  const h = React.createElement

  /**
   * The primitives package, when this boot graph carries it.
   *
   * `rt.require` answers null for a package the graph does not carry, and a
   * release may drop the export, so both are checked before use.
   */
  const primitives = rt.require('@deepseek-ai/dsh-client-ui-primitives')

  /**
   * The tooltip, or null.
   *
   * Null is the documented fallback: the row is then plain text whose `title`
   * carries the very sentence the tooltip would have shown, so the rule is
   * still reachable — only the styled bubble is gone.
   */
  const Tooltip = primitives !== null && typeof primitives === 'object' ? primitives.Tooltip : null

  /** Locale namespace for the label and the rule sentence; also the footer entry's `locale`. */
  const NS = 'peak-valley-hint'

  /** The sidebar's list of optional actions beside Settings. */
  const FOOTER_SLOT = 'sidebar.footer.action'

  /** The suite host half's holiday route; the hint prefers it over the baked-in list. */
  const HOLIDAY_ROUTE = '/dsh-ui-copy/peak-valley/holidays.json'

  /** Beijing's fixed offset; the billing clock is UTC+8 the year round. */
  const BEIJING_OFFSET_MS = 8 * 3600 * 1000

  const HOUR_MS = 3600000
  const DAY_MS = 86400000

  /**
   * Peak windows in Beijing hours, half-open: a window runs from `start` up to
   * but not including `end`.
   */
  const PEAK_HOURS = [
    [9, 12],
    [14, 18],
  ]

  /** The only Beijing hours a window can start or end on. */
  const SWITCH_HOURS = [0, 9, 12, 14, 18]

  /** Days the switch scan looks ahead: the longest holiday run is nine days. */
  const SCAN_DAYS = 12

  /**
   * Leave dates baked in for the case the host route cannot answer.
   *
   * Make-up workdays need no entry: they fall on weekends, which the weekend
   * rule already bills as valley.
   *
   * This list does not have to keep up with the calendar. The route is the
   * source of truth and follows each year's notice on its own; these dates only
   * decide the hint while the network or the source is down.
   */
  const FALLBACK_HOLIDAYS = new Set([
    '2026-01-01', '2026-01-02', '2026-01-03',
    '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19',
    '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
    '2026-04-04', '2026-04-05', '2026-04-06',
    '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
    '2026-06-19', '2026-06-20', '2026-06-21',
    '2026-09-25', '2026-09-26', '2026-09-27',
    '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
    '2026-10-05', '2026-10-06', '2026-10-07',
  ])

  /** Simplified Chinese dictionary (the key-set source of truth). */
  const zh = {
    peak: '高峰时段',
    valley: '低谷时段',
    rule: '高峰：周一至周五 09:00–12:00、14:00–18:00（中国法定节假日除外）；低谷：其余全部时段，含周末与法定节假日全天。时间均为北京时间。',
  }

  /** English dictionary, checked complete against the zh key set. */
  const en = {
    peak: 'Peak hours',
    valley: 'Off-peak hours',
    rule: 'Peak: Monday to Friday 09:00–12:00 and 14:00–18:00 Beijing time, excluding Chinese public holidays. Off-peak: every other hour, including all weekend and holiday hours.',
  }

  /**
   * The component's stylesheet, registered through `rt.style`.
   *
   * `margin-left: auto` pushes the row to the far end of the foot, so it sits
   * opposite the panel buttons whatever else the foot holds. Peak and valley
   * take their colour from the danger and success roles (the red and green the
   * shipped pricing surfaces use), and the countdown stays in the quieter text
   * tone. The row's 22px line box and the dot's 6px size are geometry rather
   * than visual language, and they are what lines the row up with the Settings
   * button beside it.
   */
  const STYLESHEET = `
.dsh-pv-hint {
  box-sizing: border-box;
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--dshui-space-2);
  margin-left: auto;
  padding: 0 var(--dshui-space-5) 0 var(--dshui-space-2);
  font-size: var(--dshui-text-size-sm);
  line-height: 22px;
  white-space: nowrap;
  user-select: none;
  cursor: default;
}
.dsh-pv-hint[data-peak='true'] { color: var(--dshui-danger); }
.dsh-pv-hint[data-peak='false'] { color: var(--dshui-success); }
.dsh-pv-dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: var(--dshui-radius-circle);
  background: currentColor;
}
.dsh-pv-count {
  color: var(--dshui-text-tertiary, var(--dshui-text-secondary));
  font-variant-numeric: tabular-nums;
}
`

  /**
   * Beijing calendar fields for an instant.
   *
   * Shifting the epoch and reading it back as UTC is what makes the calendar
   * day, the weekday and the hour all come out in Beijing terms on a machine
   * set to any zone.
   *
   * @param ms - epoch milliseconds.
   * @returns the Beijing date string, weekday (0 = Sunday) and hour.
   */
  function beijing(ms) {
    const shifted = new Date(ms + BEIJING_OFFSET_MS)
    return {
      date: shifted.toISOString().slice(0, 10),
      weekday: shifted.getUTCDay(),
      hour: shifted.getUTCHours(),
    }
  }

  /**
   * Whether an instant bills at the peak price.
   *
   * @param ms - epoch milliseconds.
   * @param holidays - the leave dates in force.
   * @returns true inside a peak window on a working day.
   */
  function isPeak(ms, holidays) {
    const { date, weekday, hour } = beijing(ms)
    if (weekday === 0 || weekday === 6) return false
    if (holidays.has(date)) return false
    return PEAK_HOURS.some(([start, end]) => hour >= start && hour < end)
  }

  /**
   * The next instant the verdict flips.
   *
   * Only the five hour boundaries can switch it, so the scan walks those in
   * Beijing order rather than stepping minute by minute.
   *
   * @param ms - epoch milliseconds.
   * @param holidays - the leave dates in force.
   * @returns epoch milliseconds of the switch, or null when none is in range.
   */
  function nextSwitchAt(ms, holidays) {
    const current = isPeak(ms, holidays)
    // Beijing midnight of the current day, expressed in the shifted frame.
    const midnight = Math.floor((ms + BEIJING_OFFSET_MS) / DAY_MS) * DAY_MS
    for (let day = 0; day <= SCAN_DAYS; day += 1) {
      for (const hour of SWITCH_HOURS) {
        const candidate = midnight + day * DAY_MS + hour * HOUR_MS - BEIJING_OFFSET_MS
        if (candidate <= ms + 1000) continue
        if (isPeak(candidate, holidays) !== current) return candidate
      }
    }
    return null
  }

  /**
   * Format a remaining span as HH:MM:SS.
   *
   * Hours are not wrapped at 24: a Friday evening runs three days into the
   * weekend, and the countdown says so.
   *
   * @param ms - remaining milliseconds.
   * @returns the formatted span.
   */
  function countdownText(ms) {
    const total = Math.max(0, Math.floor(ms / 1000))
    const pad = (value) => String(value).padStart(2, '0')
    return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`
  }

  /**
   * The wall clock the hint renders from, re-read once a second.
   *
   * @returns the current epoch milliseconds.
   */
  function useNow() {
    const [now, setNow] = React.useState(() => Date.now())
    React.useEffect(() => {
      const timer = window.setInterval(() => setNow(Date.now()), 1000)
      return () => window.clearInterval(timer)
    }, [])
    return now
  }

  /**
   * The holiday calendar the hint judges with, asked for once per page.
   *
   * @returns the leave dates in force.
   */
  function useHolidays() {
    const [holidays, setHolidays] = React.useState(() => FALLBACK_HOLIDAYS)
    React.useEffect(() => {
      let alive = true
      fetch(HOLIDAY_ROUTE, { headers: { accept: 'application/json' } })
        .then((response) => (response.ok ? response.json() : null))
        .then((body) => {
          if (!alive) return
          if (body === null || body.ok !== true || !Array.isArray(body.holidays) || body.holidays.length === 0) return
          setHolidays(new Set(body.holidays))
        })
        .catch(() => {})
      return () => {
        alive = false
      }
    }, [])
    return holidays
  }

  /**
   * The hint itself.
   *
   * The tooltip is the only part that depends on the primitives package: with
   * it the rule sentence lives in a bubble, without it the same sentence rides
   * on the row's native `title`.
   *
   * @param props - the sidebar's owner share (`wide`) and the bound translator.
   * @returns the row, or null while the column is a rail.
   */
  function PeakValleyHint({ wide, t }) {
    const now = useNow()
    const holidays = useHolidays()
    if (!wide) return null
    const peak = isPeak(now, holidays)
    const next = nextSwitchAt(now, holidays)
    const label = peak ? t('peak') : t('valley')
    const remaining = next === null ? null : countdownText(next - now)
    const rule = t('rule')
    const row = h(
      'div',
      {
        className: 'dsh-pv-hint',
        'data-peak': peak ? 'true' : 'false',
        'aria-label': remaining === null ? label : `${label} ${remaining}`,
        title: typeof Tooltip === 'function' ? undefined : rule,
      },
      h('span', { className: 'dsh-pv-dot', key: 'dot', 'aria-hidden': 'true' }),
      h('span', { className: 'dsh-pv-label', key: 'label' }, label),
      remaining === null ? null : h('span', { className: 'dsh-pv-count', key: 'count' }, remaining),
    )
    if (typeof Tooltip !== 'function') return row
    return h(Tooltip, { label: rule, delayMs: 400 }, row)
  }

  /**
   * Component body: stylesheet, dictionaries, then the footer entry.
   *
   * The sheet goes up front so the first paint of the slot is already styled.
   * Both services are waited for through one `ctx.inject`, so a host without the
   * sidebar's slot or without a locale service disables this component and
   * touches nothing else in the suite.
   *
   * @param ctx - the client root context.
   */
  function install(ctx) {
    rt.effect(() => rt.style('peak-valley', STYLESHEET), 'ui-copy/peak-valley: stylesheet')

    ctx.inject(['slots', 'locale'], (scope) => {
      scope.effect(() => scope.locale.register(NS, { zh, en }), 'ui-copy/peak-valley: dictionaries')
      scope.slots.inject(FOOTER_SLOT, () =>
        scope.slots.register(
          {
            name: FOOTER_SLOT,
            id: 'peak-valley-hint',
            order: 20,
            locale: NS,
          },
          PeakValleyHint,
        ),
      )
    })
  }

  install(rt.ctx)
}
