/**
 * Codex-style reasoning effort slider.
 *
 * Replaces the model picker's own reasoning-effort trigger with the Codex
 * desktop popover: the trigger shows the model name and its current level, and
 * the popover holds the model switcher, the Fast toggle, the reset button and a
 * draggable rail whose knob walks the levels the host reports for the model
 * (Off / Minimal / Low / Medium / High / Xhigh / Ultra — Ultra is DeepSeek's
 * `max` level). The top level earns the reference design's purple treatment.
 *
 * The registration goes into `conversation.input.model`, the single-occupant seat
 * of the model control, because the trigger has to *be* that control rather than
 * sit beside it. Selecting a level writes through the host's own model-directory
 * selection path (`directory.select`), which is the same call the shipped picker
 * makes, so the session state and the transcript notice stay identical.
 *
 * Dependencies, all resolved through the suite runtime and each one degraded on
 * its own:
 *
 *   - `react` is mandatory — without it nothing can render at all, so the
 *     component returns and the shipped trigger stays;
 *   - `slots`, `modelDirectories`, `sessions`, `locale` and `remote` are awaited
 *     with `ctx.inject`. A profile that composes none of them never runs the
 *     callback, which is exactly the standalone plugin's `inject` behaviour: the
 *     shipped model trigger is simply left in place. The explicit shape check on
 *     the callback keeps the same outcome if a release hands over a partial
 *     scope, and says so in the console instead of half-replacing the control.
 *
 * The visual language stays the reference design's: the Codex palette (its blue
 * and the Ultra purple) is component-scoped below, while every piece of chrome
 * the suite owns — labels, borders, surfaces, radii, spacing, type, motion —
 * reads a `--dshui-*` token.
 */
function dshuiComponent_effort_slider(rt) {
  const React = rt.require('react')
  if (React === null) {
    rt.warn('react is not in this boot graph; the effort slider is skipped')
    return
  }
  const h = React.createElement
  const { useState, useEffect, useLayoutEffect, useRef, useSyncExternalStore } = React
  const NS = 'dsh-codex-reasoning-effort-slider';
  const zh = {
    choose: '选择模型', effort: '思考等级', fast: '1.5倍速', usage: '用量更多', visual: '(无实际作用)',
    reset: '重置为默认', warning: '更快消耗使用额度', model: '切换模型', back: '返回',
    loading: '正在加载模型', empty: '没有可用模型', unsupported: '此模型未提供思考等级',
    retry: '重试', busy: '正在切换', failed: '切换失败', unavailable: '此会话不能切换模型'
  };
  const en = {
    choose: 'Select model', effort: 'Reasoning effort', fast: '1.5x speed', usage: 'Uses more quota', visual: '(No actual effect)',
    reset: 'Reset to default', warning: 'Consumes usage quota faster', model: 'Switch model', back: 'Back',
    loading: 'Loading models', empty: 'No available models', unsupported: 'No reasoning levels for this model',
    retry: 'Retry', busy: 'Switching', failed: 'Selection failed', unavailable: 'Model selection unavailable'
  };
  // Every pi-ai thinking level, in escalation order. The slider renders whatever
  // levels the host reports, not just the four Codex desktop ones.
  const labels = { off: 'Off', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Xhigh', max: 'Ultra' };
  const order = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
  const styles = `
      .dsh-codex-reasoning-effort-slider-root{position:relative;display:inline-flex;
        font-family:var(--dshui-font-family);font-size:var(--dshui-text-size-base);letter-spacing:var(--dshui-tracking-normal);
        /* The reference design's own palette, scoped to this component: the suite
           themes its chrome, and the escalation colours belong to the design being
           reproduced rather than to the suite's accent. */
        --dsces-accent:var(--dshui-brand);
        --dsces-ultra:#9c4ce3;
        --dsces-ultra-soft:#a965dd;
        --dsces-ultra-deep:#653780;
        --dsces-fill:linear-gradient(95deg,#3065de 0%,#7757ee 32%,#b052f1 53%,#7d42e7 76%,#5631d0 100%)}
      .dsh-codex-reasoning-effort-slider-root *{box-sizing:border-box;corner-shape:round}
      .dsh-codex-reasoning-effort-slider-root button{font:inherit;cursor:pointer;border:0}
      .dsh-codex-reasoning-effort-slider-trigger{display:inline-flex;align-items:center;gap:5px;max-width:250px;height:28px;padding:0 7px;background:transparent;color:var(--dshui-text-caption);border-radius:var(--dshui-radius-sm);font-size:var(--dshui-text-size-md)!important}
      .dsh-codex-reasoning-effort-slider-trigger:hover{background:var(--dshui-surface-hover)}
      .dsh-codex-reasoning-effort-slider-trigger>.dsh-codex-reasoning-effort-slider-icon{transition:transform var(--dshui-duration-base) var(--dshui-ease-standard)}
      .dsh-codex-reasoning-effort-slider-trigger[aria-expanded=true]>.dsh-codex-reasoning-effort-slider-icon{transform:rotate(180deg)}
      .dsh-codex-reasoning-effort-slider-trigger[aria-busy=true]{opacity:.7}
      .dsh-codex-reasoning-effort-slider-caption{display:var(--dsh-composer-model-text-display,inline);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dsh-codex-reasoning-effort-slider-trigger.ultra .dsh-codex-reasoning-effort-slider-trigger-effort{color:var(--dsces-ultra)}
      .dsh-codex-reasoning-effort-slider-trigger-bolt{width:14px;height:16px;flex:none;fill:currentColor;stroke:currentColor;stroke-width:.7;stroke-linejoin:round;color:var(--dshui-text-primary)}
      .dsh-codex-reasoning-effort-slider-compact{display:var(--dsh-composer-model-icon-display,none)}
      .dsh-codex-reasoning-effort-slider-root button:disabled{cursor:default;opacity:.5}
      .dsh-codex-reasoning-effort-slider-root button:focus-visible,.dsh-codex-reasoning-effort-slider-rail:focus-visible{outline:2px solid var(--dshui-border-focus);outline-offset:2px}
      .dsh-codex-reasoning-effort-slider-popup{position:fixed;bottom:var(--dsh-codex-reasoning-effort-slider-bottom,40px);left:var(--dsh-codex-reasoning-effort-slider-left,12px);width:272px;max-width:calc(100vw - 24px);height:var(--dsh-codex-reasoning-effort-slider-height,104px);max-height:calc(100vh - var(--dsh-codex-reasoning-effort-slider-bottom,40px) - 12px);padding:0;background:var(--dshui-surface-menu);border-radius:var(--dshui-radius-md);box-shadow:var(--dshui-shadow-panel);backdrop-filter:blur(var(--dshui-backdrop-blur));z-index:120;transform-origin:bottom left;transition:opacity var(--dshui-duration-base) var(--dshui-ease-standard),transform var(--dshui-duration-base) var(--dshui-ease-standard),height var(--dshui-duration-base) var(--dshui-ease-enter),visibility 0s}
      .dsh-codex-reasoning-effort-slider-popup.closed{opacity:0;pointer-events:none;visibility:hidden;transform:translateY(5px) scale(.98);transition-delay:0s,0s,0s,var(--dshui-duration-base)}
      .dsh-codex-reasoning-effort-slider-pane{position:absolute;left:0;right:0;bottom:0;opacity:1;transform:translateY(0);transition:opacity var(--dshui-duration-fast) var(--dshui-ease-standard),transform var(--dshui-duration-base) var(--dshui-ease-standard),visibility 0s}
      .dsh-codex-reasoning-effort-slider-pane.hidden{opacity:0;pointer-events:none;visibility:hidden;transform:translateY(5px);transition-delay:0s,0s,var(--dshui-duration-fast)}
      .dsh-codex-reasoning-effort-slider-main{height:104px}
      .dsh-codex-reasoning-effort-slider-icon{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;flex:none}
      .dsh-codex-reasoning-effort-slider-small{width:14px;height:14px}
      .dsh-codex-reasoning-effort-slider-tool{position:absolute;top:7px;width:28px;height:28px;display:flex;align-items:center;justify-content:center;padding:0;background:transparent;border-radius:var(--dshui-radius-sm);color:var(--dshui-text-caption)}
      .dsh-codex-reasoning-effort-slider-tool:hover{background:var(--dshui-surface-hover)}
      .dsh-codex-reasoning-effort-slider-fast{left:7px}.dsh-codex-reasoning-effort-slider-reset{right:7px}
      .dsh-codex-reasoning-effort-slider-tool>.dsh-codex-reasoning-effort-slider-icon{width:16px;height:16px}
      .dsh-codex-reasoning-effort-slider-fast.active{color:var(--dsces-accent)}.dsh-codex-reasoning-effort-slider-popup.ultra .dsh-codex-reasoning-effort-slider-fast.active{color:var(--dsces-ultra)}
      .dsh-codex-reasoning-effort-slider-bolt{width:15px;height:17px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linejoin:round}
      .dsh-codex-reasoning-effort-slider-fast.active .dsh-codex-reasoning-effort-slider-bolt{fill:currentColor;stroke-width:.7}
      .dsh-codex-reasoning-effort-slider-model-link{position:absolute;left:43px;right:43px;top:8px;height:42px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2px 4px;background:transparent;border-radius:5px;transition:opacity var(--dshui-duration-base) var(--dshui-ease-standard)}
      .dsh-codex-reasoning-effort-slider-model-link:hover{background:var(--dshui-surface-hover)}
      .dsh-codex-reasoning-effort-slider-heading{display:flex;gap:3px;justify-content:center;align-items:center;max-width:100%;height:20px;color:var(--dsces-accent);font-size:var(--dshui-text-size-base);line-height:var(--dshui-line-normal)}
      .dsh-codex-reasoning-effort-slider-popup.ultra .dsh-codex-reasoning-effort-slider-heading{color:var(--dsces-ultra)}
      .dsh-codex-reasoning-effort-slider-heading .dsh-codex-reasoning-effort-slider-icon{width:10px;height:10px;color:var(--dshui-text-caption)}
      .dsh-codex-reasoning-effort-slider-model{display:block;max-width:100%;height:18px;color:var(--dshui-text-secondary);font-size:var(--dshui-text-size-sm);line-height:var(--dshui-line-normal);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .dsh-codex-reasoning-effort-slider-tool,.dsh-codex-reasoning-effort-slider-warning{transition:opacity var(--dshui-duration-base) var(--dshui-ease-standard)}
      .dsh-codex-reasoning-effort-slider-warning{position:absolute;left:29px;right:29px;top:20px;text-align:center;line-height:var(--dshui-line-normal);font-size:var(--dshui-text-size-md);opacity:0;pointer-events:none}
      .dsh-codex-reasoning-effort-slider-warning span{display:inline-block;background:linear-gradient(90deg,var(--dsces-ultra-soft) 0%,var(--dsces-ultra-soft) 42%,var(--dsces-ultra-deep) 50%,var(--dsces-ultra-soft) 58%,var(--dsces-ultra-soft) 100%);background-size:300% 100%;background-position:0% 0;background-clip:text;-webkit-background-clip:text;color:transparent;-webkit-text-fill-color:transparent}
      .dsh-codex-reasoning-effort-slider-popup.message .dsh-codex-reasoning-effort-slider-model-link,.dsh-codex-reasoning-effort-slider-popup.message .dsh-codex-reasoning-effort-slider-tool{opacity:0;pointer-events:none}
      .dsh-codex-reasoning-effort-slider-popup.message .dsh-codex-reasoning-effort-slider-warning{opacity:1}
      .dsh-codex-reasoning-effort-slider-popup.message .dsh-codex-reasoning-effort-slider-warning span{animation:dsh-codex-reasoning-effort-slider-sweep 1.1s linear .2s 1 both}
      @keyframes dsh-codex-reasoning-effort-slider-sweep{from{background-position:100% 0}to{background-position:0% 0}}
      .dsh-codex-reasoning-effort-slider-rail{position:absolute;left:12px;right:12px;top:65px;height:26px;border-radius:var(--dshui-radius-lg);background:var(--dshui-border-2);touch-action:none;cursor:grab}
      .dsh-codex-reasoning-effort-slider-rail.dragging{cursor:grabbing}
      .dsh-codex-reasoning-effort-slider-fill,.dsh-codex-reasoning-effort-slider-sparks{position:absolute;inset:0 auto 0 0;width:calc((100% - 30px)*var(--dsh-codex-reasoning-effort-slider-pos,0) + 15px);border-radius:var(--dshui-radius-lg);overflow:hidden;pointer-events:none;transition:width var(--dshui-duration-base) var(--dshui-ease-enter)}
      .dsh-codex-reasoning-effort-slider-fill{background:var(--dsces-accent);overflow:hidden}
      .dsh-codex-reasoning-effort-slider-fill:after{content:"";position:absolute;inset:-12px -24px;border-radius:28px;background:var(--dsces-fill);filter:blur(5px);opacity:0;mask-image:linear-gradient(90deg,transparent 0%,#000 22%,#000 78%,transparent 100%);-webkit-mask-image:linear-gradient(90deg,transparent 0%,#000 22%,#000 78%,transparent 100%);transform:translateX(42%);transform-origin:right center;transition:transform 1.8s var(--dshui-ease-enter),opacity 1.25s var(--dshui-ease-standard),filter 1.8s var(--dshui-ease-standard)}
      .dsh-codex-reasoning-effort-slider-popup.ultra .dsh-codex-reasoning-effort-slider-fill:after{opacity:.9;transform:translateX(0)}
      .dsh-codex-reasoning-effort-slider-popup.ultra .dsh-codex-reasoning-effort-slider-fill:before{content:"";position:absolute;inset:-10px -40px;background:linear-gradient(100deg,transparent 18%,color-mix(in srgb,var(--dshui-text-on-brand) 3%,transparent) 35%,color-mix(in srgb,var(--dshui-text-on-brand) 19%,transparent) 48%,color-mix(in srgb,var(--dshui-text-on-brand) 2%,transparent) 66%,transparent 84%);animation:dsh-codex-reasoning-effort-slider-shimmer 4.5s ease-in-out infinite alternate;z-index:1}
      @keyframes dsh-codex-reasoning-effort-slider-colorflow{from{background-position:0 0}to{background-position:100% 0}}
      @keyframes dsh-codex-reasoning-effort-slider-shimmer{from{transform:translateX(-45%)}to{transform:translateX(45%)}}
      .dsh-codex-reasoning-effort-slider-dot{position:absolute;top:11px;left:calc((100% - 30px)*var(--dsh-codex-reasoning-effort-slider-tick) + 15px);width:4px;height:4px;margin-left:-2px;border-radius:var(--dshui-radius-circle);background:var(--dshui-text-caption);pointer-events:none;transition:opacity var(--dshui-duration-base) var(--dshui-ease-standard) .22s,transform var(--dshui-duration-fast) var(--dshui-ease-standard)}
      .dsh-codex-reasoning-effort-slider-dot.passed{background:color-mix(in srgb,var(--dshui-text-on-brand) 40%,transparent)}.dsh-codex-reasoning-effort-slider-dot.hovered{transform:scale(1.75)}
      .dsh-codex-reasoning-effort-slider-popup.ultra .dsh-codex-reasoning-effort-slider-dot,.dsh-codex-reasoning-effort-slider-popup.fast-mode .dsh-codex-reasoning-effort-slider-dot.covered{opacity:0;transition-delay:0s}
      .dsh-codex-reasoning-effort-slider-sparks{opacity:0;transition:width var(--dshui-duration-base) var(--dshui-ease-enter),opacity var(--dshui-duration-slow) var(--dshui-ease-standard)}
      .dsh-codex-reasoning-effort-slider-popup.fast-mode .dsh-codex-reasoning-effort-slider-sparks{opacity:1;transition-delay:0s,var(--dshui-duration-base)}
      .dsh-codex-reasoning-effort-slider-popup.ultra .dsh-codex-reasoning-effort-slider-sparks{opacity:1}
      .dsh-codex-reasoning-effort-slider-particles{display:block;width:var(--dsh-codex-reasoning-effort-slider-rail-width,248px);height:26px}
      .dsh-codex-reasoning-effort-slider-knob{position:absolute;left:calc((100% - 30px)*var(--dsh-codex-reasoning-effort-slider-pos,0));top:-2px;width:30px;height:30px;border-radius:var(--dshui-radius-circle);background:var(--dshui-surface-2);box-shadow:var(--dshui-shadow-panel);border:var(--dshui-border-width) solid var(--dshui-border-1);pointer-events:auto;cursor:grab;transform:scale(1);transition:left var(--dshui-duration-base) var(--dshui-ease-enter),transform var(--dshui-duration-fast) var(--dshui-ease-standard)}
      .dsh-codex-reasoning-effort-slider-knob:hover,.dsh-codex-reasoning-effort-slider-rail.dragging .dsh-codex-reasoning-effort-slider-knob{transform:scale(1.08)}
      .dsh-codex-reasoning-effort-slider-rail.dragging .dsh-codex-reasoning-effort-slider-knob{cursor:grabbing}
      .dsh-codex-reasoning-effort-slider-burst{position:absolute;left:calc(100% - 41px);top:-13px;width:52px;height:52px;pointer-events:none;z-index:4}
      .dsh-codex-reasoning-effort-slider-tooltip{position:absolute;bottom:calc(100% + 4px);padding:var(--dshui-space-3) 9px;white-space:nowrap;background:var(--dshui-surface-2);box-shadow:var(--dshui-shadow-panel);border-radius:var(--dshui-radius-sm);font-size:var(--dshui-text-size-sm);line-height:var(--dshui-line-normal);text-align:center;color:var(--dshui-text-primary);opacity:0;pointer-events:none;transition:opacity var(--dshui-duration-fast) var(--dshui-ease-standard);z-index:130}
      .dsh-codex-reasoning-effort-slider-tooltip span{color:var(--dshui-text-secondary)}
      .dsh-codex-reasoning-effort-slider-fast .dsh-codex-reasoning-effort-slider-tooltip span{display:block}
      .dsh-codex-reasoning-effort-slider-fast .dsh-codex-reasoning-effort-slider-tooltip span:first-child{color:var(--dshui-text-primary)}
      .dsh-codex-reasoning-effort-slider-fast .dsh-codex-reasoning-effort-slider-tooltip{left:50%;transform:translateX(-50%)}.dsh-codex-reasoning-effort-slider-reset .dsh-codex-reasoning-effort-slider-tooltip{right:-15px}
      .dsh-codex-reasoning-effort-slider-tool:hover .dsh-codex-reasoning-effort-slider-tooltip,.dsh-codex-reasoning-effort-slider-tool:focus-visible .dsh-codex-reasoning-effort-slider-tooltip{opacity:1}
      .dsh-codex-reasoning-effort-slider-models{height:100%;padding:5px;overflow:auto;overscroll-behavior:contain}
      .dsh-codex-reasoning-effort-slider-menu-title{display:flex;align-items:center;justify-content:space-between;height:24px;padding:0 var(--dshui-space-4);color:var(--dshui-text-caption);font-size:var(--dshui-text-size-sm)}
      .dsh-codex-reasoning-effort-slider-menu-back{display:flex;align-items:center;justify-content:center;flex:none;width:22px;height:22px;padding:0;border-radius:5px;background:transparent;color:inherit}
      .dsh-codex-reasoning-effort-slider-menu-back:hover{background:var(--dshui-surface-hover)}
      .dsh-codex-reasoning-effort-slider-group{height:22px;padding:3px var(--dshui-space-4);color:var(--dshui-text-secondary);font-size:var(--dshui-text-size-xs)}
      .dsh-codex-reasoning-effort-slider-option{width:100%;height:30px;display:flex;align-items:center;justify-content:space-between;gap:var(--dshui-space-4);text-align:left;padding:0 var(--dshui-space-4);border-radius:var(--dshui-radius-sm);background:transparent;color:var(--dshui-text-primary);font-size:var(--dshui-text-size-md)!important}
      .dsh-codex-reasoning-effort-slider-option:hover,.dsh-codex-reasoning-effort-slider-option:focus-visible{background:var(--dshui-surface-hover)}
      .dsh-codex-reasoning-effort-slider-option-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:var(--dshui-line-normal)}
      .dsh-codex-reasoning-effort-slider-status{padding:var(--dshui-space-4);color:var(--dshui-text-secondary);font-size:var(--dshui-text-size-xs);line-height:var(--dshui-line-tight)}
      .dsh-codex-reasoning-effort-slider-error{position:absolute;top:7px;left:37px;right:37px;display:flex;align-items:center;gap:var(--dshui-space-2);padding:3px 5px;max-height:48px;background:var(--dshui-surface-menu);color:var(--dshui-danger);border-radius:5px;z-index:5}
      .dsh-codex-reasoning-effort-slider-error-text{overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
      .dsh-codex-reasoning-effort-slider-sr{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
      .dsh-codex-reasoning-effort-slider-noeffort{position:absolute;top:65px;left:12px;right:12px;text-align:center;font-size:var(--dshui-text-size-sm);color:var(--dshui-text-secondary)}
    `;
  const particleSeeds = [[17,15],[20,12],[28,18],[48,21],[69,23],[95,15],[112,20],
    [134,15],[138,24],[150,9],[165,20],[177,10],[190,22],[198,26],[217,15],
    [237,18],[254,12],[275,24],[290,14],[315,20]];
  function icon(name, small = false) {
    const paths = {
      chevron: 'm9 18 6-6-6-6', down: 'm6 9 6 6 6-6',
      reset: 'M3 11a9 9 0 1 1 2.6 7M3 4v7h7',
      check: 'm20 6-11 11-5-5', back: 'm15 18-6-6 6-6',
      model: 'M12 3 3 8l9 5 9-5-9-5ZM3 12l9 5 9-5M3 16l9 5 9-5'
    };
    return h('svg', { className: `dsh-codex-reasoning-effort-slider-icon${small ? ' dsh-codex-reasoning-effort-slider-small' : ''}`, viewBox: '0 0 24 24', 'aria-hidden': true },
      h('path', { d: paths[name] || paths.model }));
  }
  function Selector({ directory, load, select, available, locked, t }) {
    const state = useSyncExternalStore(fn => directory.subscribe(fn), () => directory.getSnapshot());
    const [open, setOpen] = useState(false);
    const [present, setPresent] = useState(false);
    const [pane, setPane] = useState('effort');
    const [fast, setFast] = useState(false);
    const [preview, setPreview] = useState(null);
    const [hovered, setHovered] = useState(-1);
    const [dragging, setDragging] = useState(false);
    const [message, setMessage] = useState(false);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const rootRef = useRef(null), popupRef = useRef(null), railRef = useRef(null);
    const canvasRef = useRef(null), burstRef = useRef(null), triggerRef = useRef(null);
    const previewRef = useRef(null), dragRef = useRef(false), dragPointerRef = useRef(null), mountedRef = useRef(true);
    const busyRef = useRef(false);
    const timersRef = useRef([]);
    const latest = useRef({});
    const selection = state.pending || state.current;
    const group = state.groups.find(g => g.id === selection?.provider);
    const model = group?.models.find(m => m.id === selection?.model);
    const efforts = (model?.reasoning?.efforts || []).filter(e => order.includes(e.id))
      .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    const savedEffort = selection?.reasoningEffort || model?.reasoning?.defaultEffort;
    const displayed = preview || savedEffort;
    const index = Math.max(0, efforts.findIndex(e => e.id === displayed));
    const fraction = efforts.length > 1 ? index / (efforts.length - 1) : 0;
    const ultra = displayed === 'max';
    const modelName = model?.name || selection?.model || t('choose');
    const disabled = Boolean(locked || !available);
    const motion = useRef({ speed: 0, from: 0, target: 0, changedAt: 0, travel: 0, burst: 0 });
    latest.current = { open: present, fast, ultra, pane };

    useEffect(() => {
      if (available) load();
    }, [available, load]);
    useLayoutEffect(() => {
      if (open) {
        setPresent(true);
        return;
      }
      const timer = setTimeout(() => setPresent(false), 180);
      return () => clearTimeout(timer);
    }, [open]);
    useEffect(() => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
        timersRef.current.forEach(clearTimeout);
      };
    }, []);
    function enterUltra() {
      timersRef.current.forEach(clearTimeout);
      setMessage(true);
      timersRef.current = [
        setTimeout(() => { motion.current.burst = performance.now(); }, 220),
        setTimeout(() => { if (mountedRef.current) setMessage(false); }, 1800)
      ];
    }
    function showEffort(id) {
      const before = previewRef.current || savedEffort;
      previewRef.current = id;
      setPreview(id);
      if (id === 'max' && before !== 'max') enterUltra();
      else if (id !== 'max') {
        timersRef.current.forEach(clearTimeout);
        motion.current.burst = 0;
        setMessage(false);
      }
    }
    async function commit(next) {
      if (disabled || busyRef.current || !next) return;
      busyRef.current = true;
      setBusy(true);
      setError('');
      try {
        const result = await select(next);
        if (result && !result.ok) throw new Error(result.error?.message || t('failed'));
        if (result === undefined) throw new Error(t('unavailable'));
      } catch (cause) {
        if (mountedRef.current) setError(cause.message || t('failed'));
      } finally {
        busyRef.current = false;
        if (mountedRef.current) {
          setBusy(false);
          setPreview(null);
          previewRef.current = null;
        }
      }
    }
    function chooseEffort(id) {
      if (!selection || disabled || busyRef.current || !efforts.some(e => e.id === id)) return;
      showEffort(id);
      if (id !== savedEffort) void commit({ ...selection, reasoningEffort: id });
      else { previewRef.current = null; setPreview(null); }
    }
    function close() {
      discardDrag();
      setOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
    }
    useLayoutEffect(() => {
      if (!open) return;
      let layoutFrame = 0;
      function outside(event) {
        if (!rootRef.current?.contains(event.target)) close();
      }
      function escape(event) {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        if (latest.current.pane === 'models') setPane('effort');
        else close();
      }
      function align() {
        const trigger = triggerRef.current?.getBoundingClientRect();
        const popup = popupRef.current;
        if (!trigger || !popup) return;
        const width = Math.min(272, innerWidth - 24);
        const left = Math.max(12, Math.min((trigger.left + trigger.right - width) / 2, innerWidth - width - 12));
        rootRef.current.style.setProperty('--dsh-codex-reasoning-effort-slider-left', `${left}px`);
        rootRef.current.style.setProperty('--dsh-codex-reasoning-effort-slider-bottom', `${Math.max(12, innerHeight - trigger.top + 8)}px`);
      }
      function resized() {
        cancelAnimationFrame(layoutFrame);
        const until = performance.now() + 500;
        function settle() {
          align();
          if (performance.now() < until) layoutFrame = requestAnimationFrame(settle);
        }
        layoutFrame = requestAnimationFrame(settle);
      }
      document.addEventListener('pointerdown', outside);
      document.addEventListener('keydown', escape, true);
      window.addEventListener('resize', resized);
      document.addEventListener('scroll', align, true);
      align();
      return () => {
        document.removeEventListener('pointerdown', outside);
        document.removeEventListener('keydown', escape, true);
        window.removeEventListener('resize', resized);
        document.removeEventListener('scroll', align, true);
        cancelAnimationFrame(layoutFrame);
      };
    }, [open]);
    useEffect(() => {
      if (!present || pane !== 'effort') return;
      let frame = 0, last = 0, width = 248;
      const rail = railRef.current, canvas = canvasRef.current, burst = burstRef.current;
      if (!rail || !canvas || !burst) return;
      const ctx = canvas.getContext('2d'), bctx = burst.getContext('2d');
      const observer = new ResizeObserver(entries => {
        width = entries[0].contentRect.width || 248;
        canvas.width = Math.round(width * 2);
        rail.style.setProperty('--dsh-codex-reasoning-effort-slider-rail-width', `${width}px`);
      });
      observer.observe(rail);
      function draw(time) {
        const delta = last ? Math.min(time - last, 50) / 1000 : 0;
        last = time;
        const current = latest.current;
        const m = motion.current;
        const target = current.ultra && current.fast ? 1 : 0;
        if (target !== m.target) {
          m.from = m.speed; m.target = target; m.changedAt = time;
        }
        const p = Math.min(1, Math.max(0, (time - m.changedAt) / (m.target ? 600 : 750)));
        m.speed = m.from + (m.target - m.from) * p * p * (3 - 2 * p);
        if (current.ultra) m.travel += delta * m.speed;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        bctx.clearRect(0, 0, 144, 144);
        if (current.open) {
          const t = time / 1000, speed = current.ultra ? m.speed : 0;
          particleSeeds.forEach(([px, py], i) => {
            const phase = i * 2.39;
            const offset = current.ultra ? m.travel * (145 + i % 6 * 17) : 0;
            const x = ((px / 346 * width - offset + Math.sin(t * 9 + phase) * .7 * (1 - speed)) % width + width) % width;
            const y = (py + Math.cos(t * 10 + phase) * .55 * (1 - speed) + Math.sin(t * 1.3 + phase) * .8 * speed) * 26 / 36;
            const idle = .55 + .3 * (.5 + .5 * Math.sin(t * 1.1 + phase));
            const moving = .3 + .45 * (.5 + .5 * Math.sin(t * 2.4 + phase));
            const radius = (i % 7 === 0 ? 2.1 : i % 4 === 0 ? 1.55 : 1.1) * 26 / 36;
            ctx.beginPath(); ctx.arc(x * 2, y * 2, radius * 2, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255,255,255,${idle + (moving - idle) * speed})`; ctx.fill();
          });
          if (m.burst && time - m.burst < 520) {
            const age = (time - m.burst) / 1000;
            for (let i = 0; i < 22; i++) {
              const angle = i * 2.399 + .18;
              const x = 72 + Math.cos(angle) * (43 + (48 + i % 5 * 12) * age * 2);
              const y = 72 + Math.sin(angle) * (43 + (48 + i % 4 * 10) * age * 2);
              bctx.beginPath(); bctx.arc(x, y, (i % 6 === 0 ? 2.3 : 1.35) * 2 * (1 - age), 0, Math.PI * 2);
              bctx.fillStyle = `rgba(165,107,233,${.7 * (1 - age / .52)})`; bctx.fill();
            }
          }
        }
        frame = requestAnimationFrame(draw);
      }
      frame = requestAnimationFrame(draw);
      return () => { cancelAnimationFrame(frame); observer.disconnect(); };
    }, [efforts.length, pane, present]);
    function nearest(event) {
      const box = railRef.current.getBoundingClientRect();
      return Math.round(Math.max(0, Math.min(1, (event.clientX - box.left - 15) / (box.width - 30))) * (efforts.length - 1));
    }
    function pointerDown(event) {
      if (busyRef.current || disabled || efforts.length < 2) return;
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = true;
      dragPointerRef.current = event.pointerId;
      setDragging(true); setHovered(-1);
      showEffort(efforts[nearest(event)].id);
    }
    function pointerMove(event) {
      if (dragRef.current && event.pointerId === dragPointerRef.current) {
        showEffort(efforts[nearest(event)].id);
      } else {
        const i = nearest(event), box = railRef.current.getBoundingClientRect();
        const tickX = box.left + 15 + i / Math.max(1, efforts.length - 1) * (box.width - 30);
        setHovered(Math.abs(event.clientX - tickX) < 10 && i !== index ? i : -1);
      }
    }
    function finish(event) {
      if (!dragRef.current || event.pointerId !== dragPointerRef.current) return;
      const next = previewRef.current;
      dragRef.current = false;
      dragPointerRef.current = null;
      setDragging(false);
      chooseEffort(next);
    }
    function discardDrag() {
      if (!dragRef.current) return;
      dragRef.current = false;
      dragPointerRef.current = null;
      setDragging(false);
      previewRef.current = null;
      setPreview(null);
      timersRef.current.forEach(clearTimeout);
      motion.current.burst = 0;
      setMessage(false);
    }
    function keyDown(event) {
      let next = index;
      if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next++;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next--;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = efforts.length - 1;
      else return;
      event.preventDefault();
      chooseEffort(efforts[Math.max(0, Math.min(efforts.length - 1, next))]?.id);
    }
    function chooseModel(provider, nextModel) {
      if (disabled || busyRef.current) return;
      const same = selection?.provider === provider && selection?.model === nextModel.id;
      const id = same ? savedEffort : nextModel.reasoning?.defaultEffort;
      setPane('effort');
      timersRef.current.forEach(clearTimeout);
      motion.current.burst = 0;
      setMessage(false);
      void commit({ provider, model: nextModel.id, ...(id ? { reasoningEffort: id } : {}) });
    }
    function modelKeyDown(event) {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const options = [...popupRef.current.querySelectorAll('.dsh-codex-reasoning-effort-slider-models button:not(:disabled)')];
      if (!options.length) return;
      event.preventDefault();
      const active = options.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
        : (active + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      options[next].focus({ preventScroll: true });
      options[next].scrollIntoView({ block: 'nearest' });
    }
    const classes = `dsh-codex-reasoning-effort-slider-popup${!open ? ' closed' : ''}${ultra ? ' ultra' : ''}${fast ? ' fast-mode' : ''}${message ? ' message' : ''}`;
    const status = error || state.error || '';
    const currentLabel = labels[displayed] || state.retainedEffort || '';
    const triggerLabel = labels[savedEffort] || state.retainedEffort || '';
    const modelCount = state.groups.reduce((count, provider) => count + provider.models.length, 0);
    const menuHeight = 34 + Math.max(1, modelCount) * 30 + (state.groups.length > 1 ? state.groups.length * 22 : 0);
    const modelsView = h('div', { className: `dsh-codex-reasoning-effort-slider-pane dsh-codex-reasoning-effort-slider-models${pane !== 'models' ? ' hidden' : ''}`,
      role: 'menu', 'aria-label': t('model'), inert: pane !== 'models' ? '' : undefined, onKeyDown: modelKeyDown },
      h('div', { className: 'dsh-codex-reasoning-effort-slider-menu-title' }, t('choose'),
        h('button', { className: 'dsh-codex-reasoning-effort-slider-menu-back', role: 'menuitem', 'aria-label': t('back'), title: t('back'), onClick: () => setPane('effort') }, icon('back', true))),
      ...state.groups.map(provider => h('div', { key: provider.id },
        state.groups.length > 1 ? h('div', { className: 'dsh-codex-reasoning-effort-slider-group' }, provider.name) : null,
        ...provider.models.map(option => h('button', {
          key: option.id, className: 'dsh-codex-reasoning-effort-slider-option', role: 'menuitemradio',
          'aria-checked': selection?.provider === provider.id && selection?.model === option.id,
          disabled: busy, onClick: () => chooseModel(provider.id, option)
        }, h('span', { className: 'dsh-codex-reasoning-effort-slider-option-name', title: option.name }, option.name),
        selection?.provider === provider.id && selection?.model === option.id ? icon('check', true) : null)))),
      !state.groups.length ? h('div', { className: 'dsh-codex-reasoning-effort-slider-status' }, state.status === 'loading' ? t('loading') : t('empty')) : null);
    return h('div', { className: 'dsh-codex-reasoning-effort-slider-root', ref: rootRef, 'data-dsh-codex-reasoning-effort-slider-session': true },
      h('button', { className: `dsh-codex-reasoning-effort-slider-trigger${savedEffort === 'max' ? ' ultra' : ''}`, ref: triggerRef, disabled,
        'aria-label': `${modelName} ${triggerLabel}`, 'aria-expanded': open, 'aria-haspopup': 'dialog', 'aria-busy': busy,
        onClick: () => {
          if (open) close();
          else { setPane(model ? 'effort' : 'models'); setOpen(true); load(); }
        }
      }, fast ? h('svg', { className: 'dsh-codex-reasoning-effort-slider-trigger-bolt', viewBox: '0 0 24 24', 'aria-hidden': true },
        h('path', { d: 'M14.4 2Q16 .2 15.8 2.5L15.1 8.5H20.5Q22 8.5 21 9.8L10.7 21.7Q9 23.4 9.2 21.2L10 14.2H4.2Q2.6 14.2 3.6 12.9L14.4 2Z' })) : null,
      h('span', { className: 'dsh-codex-reasoning-effort-slider-compact' }, icon('model')),
      h('span', { className: 'dsh-codex-reasoning-effort-slider-caption' }, modelName,
        triggerLabel ? h('span', { className: 'dsh-codex-reasoning-effort-slider-trigger-effort' }, ` ${triggerLabel}`) : null), icon('down', true)),
      h('section', { className: classes, ref: popupRef, role: 'dialog', 'aria-label': pane === 'models' ? t('model') : t('effort'),
        'aria-hidden': !open, inert: !open ? '' : undefined, style: { '--dsh-codex-reasoning-effort-slider-height': `${pane === 'models' ? menuHeight : 104}px` } },
        modelsView,
        h('div', { className: `dsh-codex-reasoning-effort-slider-pane dsh-codex-reasoning-effort-slider-main${pane !== 'effort' ? ' hidden' : ''}`, inert: pane !== 'effort' ? '' : undefined },
          h('button', { className: `dsh-codex-reasoning-effort-slider-tool dsh-codex-reasoning-effort-slider-fast${fast ? ' active' : ''}`, 'aria-label': t('fast'), 'aria-pressed': fast, onClick: () => setFast(!fast) },
            h('svg', { className: 'dsh-codex-reasoning-effort-slider-bolt', viewBox: '0 0 24 24', 'aria-hidden': true },
              h('path', { d: 'M14.4 2Q16 .2 15.8 2.5L15.1 8.5H20.5Q22 8.5 21 9.8L10.7 21.7Q9 23.4 9.2 21.2L10 14.2H4.2Q2.6 14.2 3.6 12.9L14.4 2Z' })),
            h('span', { className: 'dsh-codex-reasoning-effort-slider-tooltip', role: 'tooltip' },
              h('span', null, t('fast')), h('span', null, t('usage')), h('span', null, t('visual')))),
          h('button', { className: 'dsh-codex-reasoning-effort-slider-model-link', onClick: () => setPane('models'), 'aria-label': t('model'), title: modelName },
            h('span', { className: 'dsh-codex-reasoning-effort-slider-heading' }, currentLabel || t('choose'), icon('chevron', true)),
            h('span', { className: 'dsh-codex-reasoning-effort-slider-model' }, modelName)),
          h('div', { className: 'dsh-codex-reasoning-effort-slider-warning' }, h('span', null, t('warning'))),
          h('button', { className: 'dsh-codex-reasoning-effort-slider-tool dsh-codex-reasoning-effort-slider-reset', disabled: busy || !model?.reasoning, 'aria-label': t('reset'),
            onClick: () => { setFast(false); chooseEffort(model?.reasoning?.defaultEffort); }
          }, icon('reset'), h('span', { className: 'dsh-codex-reasoning-effort-slider-tooltip', role: 'tooltip' }, t('reset'))),
          efforts.length ? h('div', { className: `dsh-codex-reasoning-effort-slider-rail${dragging ? ' dragging' : ''}`, ref: railRef,
            style: { '--dsh-codex-reasoning-effort-slider-pos': fraction }, role: 'slider', tabIndex: 0,
            'aria-label': t('effort'), 'aria-valuemin': 0, 'aria-valuemax': efforts.length - 1,
            'aria-valuenow': index, 'aria-valuetext': currentLabel, 'aria-disabled': busy || disabled,
            onPointerDown: pointerDown, onPointerMove: pointerMove, onPointerUp: finish,
            onPointerCancel: finish, onLostPointerCapture: finish,
            onPointerLeave: () => setHovered(-1), onKeyDown: keyDown
          }, h('div', { className: 'dsh-codex-reasoning-effort-slider-fill' }),
          ...efforts.map((effort, i) => h('i', { key: effort.id,
            className: `dsh-codex-reasoning-effort-slider-dot${i <= index ? ' passed' : ''}${i < index ? ' covered' : ''}${hovered === i ? ' hovered' : ''}`,
            style: { '--dsh-codex-reasoning-effort-slider-tick': efforts.length > 1 ? i / (efforts.length - 1) : 0 } })),
          h('div', { className: 'dsh-codex-reasoning-effort-slider-sparks' }, h('canvas', { ref: canvasRef, className: 'dsh-codex-reasoning-effort-slider-particles', width: 496, height: 52 })),
          h('div', { className: 'dsh-codex-reasoning-effort-slider-knob' }), h('canvas', { ref: burstRef, className: 'dsh-codex-reasoning-effort-slider-burst', width: 144, height: 144 }))
            : h('div', { className: 'dsh-codex-reasoning-effort-slider-noeffort' }, t('unsupported'))),
        busy ? h('div', { className: 'dsh-codex-reasoning-effort-slider-sr', role: 'status' }, t('busy')) : null,
        status ? h('div', { className: 'dsh-codex-reasoning-effort-slider-status dsh-codex-reasoning-effort-slider-error', role: 'alert' },
          h('span', { className: 'dsh-codex-reasoning-effort-slider-error-text', title: status }, status),
          h('button', { className: 'dsh-codex-reasoning-effort-slider-menu-back', 'aria-label': t('retry'), title: t('retry'),
            onClick: () => { setError(''); load(); } }, icon('reset', true))) : null));
  }
  /**
   * Take over the model picker's trigger.
   *
   * `conversation.input.model` is the single-occupant seat the shipped picker
   * fills; registering here replaces that control with the Codex trigger, which is
   * the whole point of the component. Everything it needs is awaited, so a
   * profile without the model-directory or locale services keeps the shipped
   * picker untouched instead of losing it — the failure mode that would strand a
   * user with no way to switch models.
   *
   * @param ctx - client root context.
   */
  function install(ctx) {
    // The sheet is mounted before the seat is taken: the trigger must never
    // paint once in the shipped styles and then reflow into the Codex one.
    rt.style('effort-slider', styles)
    if (typeof ctx.inject !== 'function') {
      rt.warn('this context has no inject seam; the shipped model trigger is kept')
      return
    }
    ctx.inject(['slots', 'modelDirectories', 'sessions', 'locale', 'remote', 'remote.session'], (scope) => {
      if (typeof scope.slots?.register !== 'function' || typeof scope.slots?.inject !== 'function'
        || typeof scope.locale?.register !== 'function') {
        // Half the seam is worse than none: without the locale binding the
        // trigger would render its raw namespace keys, and without the slot
        // registry there is nothing to mount. Leave the shipped control alone.
        rt.warn('slots/locale are incomplete; the shipped model trigger is kept')
        return
      }
      scope.effect(() => scope.locale.register(NS, { zh, en }), 'ui-copy/effort-slider: dictionaries')
      scope.slots.inject('conversation.input.model', () => scope.slots.register({
        name: 'conversation.input.model',
        // Single-occupant seat: the shipped picker registers at priority 0, and
        // the lowest priority is the one that renders, so the Codex trigger takes
        // the seat by outranking it instead of colliding with it.
        priority: -1,
        id: 'effort-slider',
        locale: NS,
        inject(sessionId) {
          const directory = scope.modelDirectories.directoryFor(sessionId);
          const available = scope.sessions.subagentAddress(sessionId) === undefined;
          return {
            available, directory: directory.store,
            load: () => { if (available) directory.load().catch(() => {}); },
            select: selection => available ? directory.select(selection) : Promise.resolve(undefined)
          };
        }
      }, Selector))
    })
  }

  install(rt.ctx)
}
