/**
 * dsh-peak-valley-hint — browser half.
 *
 * Draws the current DeepSeek billing window at the right end of the sidebar
 * foot: whether the account is on the peak price right now, and how long is left
 * before the window changes.
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
 * The hint is a `sidebar.footer.action` entry, the slot ui-sidebar declares for
 * "optional actions beside Settings at the sidebar foot", so the sidebar renders
 * it, hands it the column state (`wide`), and the plugin owns nothing but its
 * own element. In the 56px rail there is no room for a sentence, so it renders
 * nothing at all.
 *
 * `HOLIDAYS` is the one piece that cannot be derived: the State Council
 * publishes the next year's leave arrangement every November, and the dates
 * below stop being complete at that point. See the constant.
 *
 * @module dsh-peak-valley-hint/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-peak-valley-hint',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = React.createElement

    /** Locale namespace for the label and the rule sentence; also the footer entry's `locale`. */
    const NS = 'peak-valley-hint'

    /** ui-sidebar's list of optional actions beside Settings. */
    const FOOTER_SLOT = 'sidebar.footer.action'

    /** The primitives tooltip, when this build still exports one. */
    const Tooltip = primitives.Tooltip

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
     * Beijing calendar dates that bill at the valley price all day: every day the
     * State Council puts on leave.
     *
     * Make-up workdays need no entry: 2026's fall on 1/4, 2/14, 2/28, 5/9, 9/20
     * and 10/10, all Saturdays or Sundays, which the weekend rule already bills
     * as valley.
     *
     * Source: 国务院办公厅关于 2026 年部分节假日安排的通知（国办发明电〔2025〕7 号）,
     * matching the footnote on the API pricing page.
     *
     * ⚠️ The leave arrangement for a year is published in the November before
     * it, so this set has to gain that year's dates then. Until it does, the
     * hint reads as peak on those days, which is the wrong price to plan around.
     */
    const HOLIDAYS = new Set([
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
     * The plugin's stylesheet.
     *
     * The row is pushed to the far end of the foot with `margin-left: auto`, so
     * it sits opposite the panel buttons whatever else the foot holds. Peak and
     * valley carry the two colours the shipped pricing surfaces use; the
     * countdown stays in the quieter label tone.
     */
    const STYLESHEET = `
.dsh-pv-hint {
  box-sizing: border-box;
  flex: none;
  display: flex;
  align-items: center;
  gap: 5px;
  margin-left: auto;
  padding: 0 10px 0 4px;
  font-size: 12px;
  line-height: 22px;
  white-space: nowrap;
  user-select: none;
  cursor: default;
}
.dsh-pv-hint[data-peak='true'] { color: #e0433f; }
.dsh-pv-hint[data-peak='false'] { color: #2fa24c; }
.dsh-pv-dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
.dsh-pv-count {
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
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
     * @returns true inside a peak window on a working day.
     */
    function isPeak(ms) {
      const { date, weekday, hour } = beijing(ms)
      if (weekday === 0 || weekday === 6) return false
      if (HOLIDAYS.has(date)) return false
      return PEAK_HOURS.some(([start, end]) => hour >= start && hour < end)
    }

    /**
     * The next instant the verdict flips.
     *
     * Only the five hour boundaries can switch it, so the scan walks those in
     * Beijing order rather than stepping minute by minute.
     *
     * @param ms - epoch milliseconds.
     * @returns epoch milliseconds of the switch, or null when none is in range.
     */
    function nextSwitchAt(ms) {
      const current = isPeak(ms)
      // Beijing midnight of the current day, expressed in the shifted frame.
      const midnight = Math.floor((ms + BEIJING_OFFSET_MS) / DAY_MS) * DAY_MS
      for (let day = 0; day <= SCAN_DAYS; day += 1) {
        for (const hour of SWITCH_HOURS) {
          const candidate = midnight + day * DAY_MS + hour * HOUR_MS - BEIJING_OFFSET_MS
          if (candidate <= ms + 1000) continue
          if (isPeak(candidate) !== current) return candidate
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
     * The hint itself.
     *
     * @param props - the sidebar's owner share (`wide`) and the bound translator.
     * @returns the row, or null while the column is a rail.
     */
    function PeakValleyHint({ wide, t }) {
      const now = useNow()
      if (!wide) return null
      const peak = isPeak(now)
      const next = nextSwitchAt(now)
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
     * Append the stylesheet, or do nothing while `head` is not there yet.
     *
     * @returns the disposer removing the sheet again.
     */
    function installStylesheet() {
      if (document.head === null) return () => {}
      const style = document.createElement('style')
      style.setAttribute('data-dsh-peak-valley-hint', '')
      style.textContent = STYLESHEET
      document.head.appendChild(style)
      return () => style.remove()
    }

    /**
     * Client plugin body: dictionaries, stylesheet, then the footer entry.
     *
     * @param ctx - client root context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'peak-valley-hint: dictionaries')
      ctx.effect(() => installStylesheet(), 'peak-valley-hint: stylesheet')
      ctx.slots.inject(FOOTER_SLOT, () =>
        ctx.slots.register(
          {
            name: FOOTER_SLOT,
            id: 'peak-valley-hint',
            order: 20,
            locale: NS,
          },
          PeakValleyHint,
        ),
      )
    }

    exports.apply = apply
    exports.inject = ['slots', 'locale']
    return module.exports
  },
})
