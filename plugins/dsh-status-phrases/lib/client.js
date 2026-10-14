/**
 * dsh-status-phrases — browser half.
 *
 * Replaces the turn status line the harness shows while a turn runs
 * (en "Deep diving for 12s", zh "深度求索中，用时12秒") with a rotating phrase,
 * typed out one character at a time under a rainbow gradient.
 *
 * Where the line lives on dsh 0.2.0:
 *
 *   div[data-chat-running]                    the running row in the conversation
 *     ├─ span(class*=_visuallyHidden)         screen-reader announcement; never touched
 *     ├─ span(class*=_runningDivider)
 *     └─ span(class*=_runningContent)
 *          ├─ span(class*=_runningIcon)      the whale tail; left alone
 *          └─ span(class*=_runningText)      the host line ("深度求索中，用时12秒")
 *
 * The host owns that last span and rewrites its text every second, so this
 * plugin never writes into it: it reads the host text (that is where the
 * elapsed time comes from), hides the span, and appends its own line — a text
 * span plus a clock span — right after it. Hiding the host span is what removes
 * the host's own shimmer sweep, which would otherwise fight the gradient here.
 *
 * Phrase selection mirrors the upstream plugin this was extracted from
 * (dsh-status-rotator, MIT, by 01Virex): a shuffle bag per list, so a phrase is
 * not repeated until the bag is exhausted, with the last few picks filtered out
 * when the bag refills. One difference on purpose: the phrase list is one
 * multi-line string from a single settings box, one phrase per line, instead of
 * a phase-aware phrase bank with presets and schedules.
 *
 * Nothing is bundled twice: the line style, the gradient, the typewriter and
 * the settings row are all that remains of the upstream surface.
 */

window.__ModuleLoader__.load({
	id: "dsh-status-phrases",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const react = require("react");

		// ══ 常量 ══

		/** 样式归属:客户端模块系统会认领没有 data-plugin 的 <style> 并随其变更删掉 */
		const STYLE_OWNER_ID = "dsh-status-phrases";

		/** 设置命名空间(configForms 条目的 id 与包名一致) */
		const ENTRY_ID = "dsh-status-phrases";
		const SETTINGS_NS = "status-phrases";

		/** 每隔多少毫秒换一句(照抄上游默认值) */
		const ROTATE_MS = 10000;
		/** 打字机每字符间隔(毫秒);0 = 立即整句出现 */
		const TYPE_SPEED_MS = 30;
		/** 洗牌袋重开时,剔掉最近几条,保证跨袋也不撞上一句 */
		const RECENT_LIMIT = 3;
		/** 彩虹渐变色板与流动速度(上游默认值,深色与浅色主题共用一套) */
		const GRADIENT_COLORS = ["#ff5f6d", "#ffc371", "#ffdd55", "#7dff7d", "#5fd4ff", "#a78bfa", "#ff8adb"];
		const GRADIENT_SPEED_S = 4;
		/** 轮换兜底:每 2 秒重扫一次,防止 MutationObserver 漏掉早期节点 */
		const RESCAN_MS = 2000;
		/** 配置上限:防止体量过大的粘贴内容把轮换与设置写入拖死 */
		const MAX_PHRASES = 500;
		const MAX_PHRASE_LENGTH = 160;

		const RUNNING_ROW_SELECTOR = "[data-chat-running]";
		const RUNNING_TEXT_SELECTOR = '[class*="runningText"]';

		/** 本插件自己的节点类名 */
		const LINE_CLASS = "dsp-line";
		const TEXT_CLASS = "dsp-text";
		const CLOCK_CLASS = "dsp-clock";
		const RAINBOW_CLASS = "dsp-rainbow";

		/**
		 * 宿主回合初始文案与「运行中 + 时长」文案。两者都从 dsh 的 chat 字典
		 * 实时解析(见 resolveDiveLabel / resolveDiveDurationPrefix),这里的已知
		 * 取值只作字典不可用时的回退。
		 */
		const DIVE_LABEL_KEY = "chat.deepDiving";
		const KNOWN_DIVE_LABELS = ["Deep diving...", "深度求索中..."];
		const DIVE_DURATION_LABEL_KEY = "message.turnProcess.deepDivingFor";
		const KNOWN_DIVE_DURATION_PREFIXES = ["Deep diving for ", "深度求索中，用时", "深度求索中,用时"];

		/** 配置框留空时用的内置短语(中性、与「正在求索」同调;随时在设置里覆盖) */
		const DEFAULT_PHRASES = [
			"正在深度求索…",
			"正在整理思路…",
			"正在推演下一步…",
			"正在翻找线索…",
			"正在核对上下文…",
			"正在权衡几种方案…",
			"正在构建推理链…",
			"正在打捞被埋掉的细节…",
			"正在把答案拼起来…",
			"正在落笔写回复…",
		];

		// ══ 纯函数 ══

		/**
		 * 把配置框里的一整段文本切成短语列表:一行一句,空行与 `#` 开头的行忽略。
		 * 逐行去空白,并按上限截断,避免一次粘贴把轮换与设置写入拖死。
		 *
		 * @param text - 配置框的原始内容。
		 * @returns 短语数组(可能为空)。
		 */
		function parsePhrases(text) {
			if (typeof text !== "string" || text.length === 0) return [];
			const out = [];
			for (const raw of text.split(/\r?\n/)) {
				const line = raw.trim();
				if (line.length === 0 || line.startsWith("#")) continue;
				out.push(line.length > MAX_PHRASE_LENGTH ? line.slice(0, MAX_PHRASE_LENGTH) : line);
				if (out.length >= MAX_PHRASES) break;
			}
			return out;
		}

		/**
		 * 解析当前生效的宿主回合初始文案。tChat 为 dsh "chat" 命名空间的翻译
		 * 函数(可空);字典兜底会原样返回 key 或带 {…} 的模板,这两种都视为不可用,
		 * 再按语言回退到已知文案。
		 *
		 * @param tChat - 翻译函数,或 null。
		 * @param locale - 当前界面语言("zh" / "en" / …)。
		 * @returns 宿主的回合初始文案。
		 */
		function resolveDiveLabel(tChat, locale) {
			let value = "";
			try {
				value = typeof tChat === "function" ? String(tChat(DIVE_LABEL_KEY)) : "";
			} catch (error) { /* ignore */ }
			if (value.length > 0 && value !== DIVE_LABEL_KEY && !/\{/.test(value)) return value;
			return locale === "zh" ? KNOWN_DIVE_LABELS[1] : KNOWN_DIVE_LABELS[0];
		}

		/**
		 * 解析「运行中 + 时长」文案的前缀(把 {duration} 传空串)。字典未注册时
		 * 会返回 key 本身、模板未解析时仍带 {…},这两种都视为不可用。
		 *
		 * @param tChat - 翻译函数,或 null。
		 * @param locale - 当前界面语言。
		 * @returns 时长前缀,例如 "深度求索中，用时"。
		 */
		function resolveDiveDurationPrefix(tChat, locale) {
			let value = "";
			try {
				value = typeof tChat === "function" ? String(tChat(DIVE_DURATION_LABEL_KEY, { duration: "" })) : "";
			} catch (error) { /* ignore */ }
			if (value.length > 0 && value !== DIVE_DURATION_LABEL_KEY && !/\{/.test(value)) return value;
			return locale === "zh" ? KNOWN_DIVE_DURATION_PREFIXES[1] : KNOWN_DIVE_DURATION_PREFIXES[0];
		}

		/**
		 * 把宿主状态文本归类成「回合运行中」并取出其中的时长文本:
		 *   命中 → 时长字符串(初始文案无时长时为空串)
		 *   未命中(Worked / Took 12s / Failed / 其他文案)→ null
		 * 时长前缀优先用当前语言解析出的模板前缀,再按已知前缀兜底(语言切换的
		 * 那一瞬间字典与 DOM 可能不同步)。
		 *
		 * @param text - 宿主状态元素的文本。
		 * @param label - 当前语言的回合初始文案。
		 * @param durationPrefix - 当前语言的时长前缀。
		 * @returns 时长文本,或 null。
		 */
		function matchDiveText(text, label, durationPrefix) {
			const t = String(text || "");
			const prefixes = [durationPrefix].concat(KNOWN_DIVE_DURATION_PREFIXES)
				.filter((p) => typeof p === "string" && p.length > 0);
			for (const prefix of prefixes) {
				if (t.startsWith(prefix)) return t.slice(prefix.length).trim();
			}
			if (t.startsWith(label) || KNOWN_DIVE_LABELS.some((l) => t.startsWith(l))) return "";
			return null;
		}

		/** 洗牌(Fisher-Yates,不改动入参) */
		function shuffle(list) {
			const out = list.slice();
			for (let i = out.length - 1; i > 0; i--) {
				const j = Math.floor(Math.random() * (i + 1));
				const tmp = out[i];
				out[i] = out[j];
				out[j] = tmp;
			}
			return out;
		}

		/**
		 * 洗牌袋:同一份短语列表抽完之前不重复;袋子抽空重开时先剔掉最近
		 * recentLimit 条,保证跨袋也不撞上一句。列表变化时整袋重开。
		 *
		 * @returns `{ next(list) }`,列表为空时返回 null。
		 */
		function createShuffleBag() {
			let bag = [];
			let recent = [];
			let signature = null;
			return {
				next(list) {
					if (!Array.isArray(list) || list.length === 0) return null;
					const current = list.join("\u0000");
					if (current !== signature) {
						signature = current;
						bag = [];
					}
					if (bag.length === 0) {
						const fresh = list.filter((t) => recent.indexOf(t) < 0);
						bag = shuffle(fresh.length > 0 ? fresh : list);
					}
					const picked = bag.shift();
					recent = [picked].concat(recent).slice(0, RECENT_LIMIT);
					return picked;
				},
			};
		}

		/**
		 * 用 canvas 量一句文本的像素宽度。宿主那一行是 flex 且本插件的时钟紧跟
		 * 其后,打字机逐字输出会让宽度每 30ms 变一次、时钟随之左右跳 —— 开打前
		 * 把整句宽度锁住,打完再释放。
		 *
		 * @param text - 要量的文本。
		 * @param el - 取字体度量的元素。
		 * @returns 像素宽度;量不出来时为 0。
		 */
		function measureText(text, el) {
			try {
				if (typeof getComputedStyle !== "function") return 0;
				const cs = getComputedStyle(el);
				if (!measureText.canvas) measureText.canvas = document.createElement("canvas");
				const context = measureText.canvas.getContext && measureText.canvas.getContext("2d");
				if (!context) return 0;
				context.font = [cs.fontStyle, cs.fontVariant, cs.fontWeight, cs.fontSize, cs.fontFamily].join(" ");
				return context.measureText(text).width;
			} catch (error) {
				return 0;
			}
		}

		// ══ 样式 ══

		/**
		 * `.dsp-line` 逐条照抄 dsh ≤0.1.6 的 `.turnStatus`(26px 高 / nowrap /
		 * inline-flex / 自带 shimmer 渐变);这里只保留布局那部分,流动的渐变交给
		 * 文本 span 上的彩虹类。时钟照抄 `.turnStatusClock`(13px + 8px 间距 +
		 * caption 色 + tabular-nums)。
		 */
		const STYLESHEET =
			"." + LINE_CLASS + "{" +
			"display:inline-flex;align-items:center;flex:none;" +
			"max-width:100%;min-width:0;overflow:hidden;white-space:nowrap;" +
			"height:calc(26px + var(--dsh-content-font-delta,0px));" +
			"font:var(--dsw-font-s-strong-14,500 14px/22px inherit);" +
			"font-size:var(--dsh-content-font-size,14px);" +
			"line-height:calc(22px + var(--dsh-content-font-delta,0px));" +
			"}" +
			"." + LINE_CLASS + " > ." + CLOCK_CLASS + "{" +
			"flex:none;margin-left:8px;font-weight:400;" +
			"font-size:var(--dsh-content-font-size-secondary,13px);" +
			"font-variant-numeric:tabular-nums;" +
			"color:var(--dsw-alias-label-caption,currentColor);" +
			"-webkit-text-fill-color:var(--dsw-alias-label-caption,currentColor);" +
			"}" +
			"." + TEXT_CLASS + "{" +
			"display:inline-block;min-width:0;max-width:100%;overflow:hidden;white-space:nowrap;" +
			"}" +
			"." + TEXT_CLASS + "." + RAINBOW_CLASS + "{" +
			"background-image:linear-gradient(90deg," + GRADIENT_COLORS.join(", ") + ", " + GRADIENT_COLORS[0] + ");" +
			"background-size:200% 100%;background-repeat:repeat-x;" +
			"-webkit-background-clip:text;background-clip:text;" +
			"color:transparent;-webkit-text-fill-color:transparent;" +
			"animation:dsp-flow " + GRADIENT_SPEED_S + "s linear infinite;" +
			"}" +
			"@keyframes dsp-flow{to{background-position:200% 0}}" +
			"@media (prefers-reduced-motion:reduce){" +
			"." + TEXT_CLASS + "." + RAINBOW_CLASS + "{animation:none;background-position:0 0}" +
			"}" +
			// 设置 → 通用设置里那一行(与相邻插件行同一套排版与主题变量)
			".dsp-row{display:flex;align-items:flex-start;gap:8px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}" +
			".dsp-rowText{display:flex;flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:24px}" +
			".dsp-title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}" +
			".dsp-desc{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px}" +
			".dsp-note{color:var(--dsw-alias-state-error-primary,var(--dsw-alias-label-tertiary));font-size:12px;font-weight:400;line-height:18px}" +
			".dsp-control{display:flex;flex-direction:column;align-items:flex-end;gap:8px;flex:none}" +
			".dsp-input{" +
			"box-sizing:border-box;width:340px;min-height:132px;resize:vertical;" +
			"border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;" +
			"background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);" +
			"padding:8px 12px;font:inherit;font-size:13px;line-height:1.6;" +
			"}" +
			".dsp-input:focus{border-color:var(--dsw-alias-brand-primary);outline:none}" +
			".dsp-input::placeholder{color:var(--dsw-alias-label-dimmed)}" +
			".dsp-input:disabled{opacity:.6;cursor:default}";

		/** 建一个已声明归属的 `<style>`(建完立刻打标记,避免被客户端模块系统认领) */
		function createOwnedStyle(id) {
			const el = document.createElement("style");
			el.setAttribute("data-plugin", STYLE_OWNER_ID);
			if (id) el.setAttribute("data-plugin-style", id);
			return el;
		}

		// ══ 运行状态 ══

		/** 当前生效的短语列表(设置框 → 解析结果);为空时不接管,宿主原文照旧 */
		let phrases = DEFAULT_PHRASES.slice();
		/** 洗牌袋(所有状态行共用一个袋) */
		const phraseBag = createShuffleBag();
		/** 状态行 → 它的行元素 */
		const lines = new Map();
		/** 行元素 → 打字机状态 */
		const typists = new Map();
		/** dsh "chat" 字典的绑定(可能为 null;语言切换时重新绑定) */
		let chatT = null;
		/** 当前界面语言 */
		let lastLocale = "zh";
		/** 诊断开关(URL 带 ?dsp-debug=1 时打开) */
		let debug = false;

		const log = (...args) => {
			if (debug) console.log("[status-phrases]", ...args);
		};

		// ══ DOM ══

		/** 行里承载文案的文本节点(span 内唯一文本节点) */
		const textNodeOf = (line) => {
			const span = line.querySelector(":scope > ." + TEXT_CLASS);
			if (!span) return null;
			for (const node of span.childNodes) if (node.nodeType === 3) return node;
			return null;
		};

		/** 时钟元素 */
		const clockOf = (line) => line.querySelector(":scope > ." + CLOCK_CLASS);

		/** 本插件自己的节点(打字机写入不该被当成宿主变化重新同步) */
		const isOwnNode = (el) => {
			try {
				return !!(el && el.closest && el.closest("." + LINE_CLASS));
			} catch (error) {
				return false;
			}
		};

		/** 建一条状态行:文案 span + 时钟 span */
		function buildLine() {
			const line = document.createElement("div");
			line.className = LINE_CLASS;
			const text = document.createElement("span");
			text.className = TEXT_CLASS + " " + RAINBOW_CLASS;
			text.appendChild(document.createTextNode(""));
			line.appendChild(text);
			const clock = document.createElement("span");
			clock.className = CLOCK_CLASS;
			clock.setAttribute("aria-hidden", "true");
			clock.style.display = "none";
			line.appendChild(clock);
			return line;
		}

		/** 释放锁宽 */
		function unlockWidth(line, state) {
			if (!state || state.locked !== true) return;
			try {
				line.style.removeProperty("min-width");
			} catch (error) { /* ignore */ }
			state.locked = false;
		}

		/** 打字机:把行里的文本逐字输出成 text;打断进行中的打字 */
		function typeText(line, text) {
			const node = textNodeOf(line);
			if (!node) return;
			const state = typists.get(line) || { timer: null, locked: false };
			if (state.timer !== null) clearInterval(state.timer);
			unlockWidth(line, state);
			if (TYPE_SPEED_MS <= 0) {
				node.nodeValue = text;
				typists.delete(line);
				return;
			}
			// 先锁宽:整句宽度固定后,时钟在整段打字过程中不会左右跳
			const width = measureText(text, line);
			if (width > 0) {
				line.style.minWidth = Math.ceil(width) + "px";
				state.locked = true;
			}
			let index = 0;
			node.nodeValue = "";
			state.timer = setInterval(() => {
				// React 可能替换了文本节点:每 tick 重新找;找不到就放弃
				const current = textNodeOf(line);
				if (!current) {
					clearInterval(state.timer);
					state.timer = null;
					unlockWidth(line, state);
					typists.delete(line);
					return;
				}
				index++;
				current.nodeValue = text.slice(0, index);
				if (index >= text.length) {
					clearInterval(state.timer);
					state.timer = null;
					unlockWidth(line, state);
					typists.delete(line);
				}
			}, TYPE_SPEED_MS);
			typists.set(line, state);
		}

		/** 时钟:显示宿主文案里的时长原文;没有时长就不占位 */
		function setClock(line, duration) {
			const clock = clockOf(line);
			if (!clock) return;
			const show = typeof duration === "string" && duration.length > 0;
			if (show && clock.textContent !== duration) clock.textContent = duration;
			clock.style.display = show ? "" : "none";
		}

		/** 给一行选下一句并打字;短语列表为空时返回 false(调用方据此释放) */
		function refreshLine(line) {
			if (phrases.length === 0) return false;
			const next = phraseBag.next(phrases);
			if (next === null) return false;
			typeText(line, next);
			return true;
		}

		/** 取运行行里宿主那个文案元素(读取时长的来源,视觉上被本插件接管) */
		const runningLabelOf = (row) => {
			try {
				return row.querySelector(RUNNING_TEXT_SELECTOR);
			} catch (error) {
				return null;
			}
		};

		/** 接管一条运行行:藏掉宿主文案,把自己的状态行插在它后面 */
		function adoptRow(row, labelEl) {
			const existing = lines.get(row);
			if (existing && existing.line.isConnected) {
				syncRow(row);
				return;
			}
			const line = buildLine();
			try {
				const parent = labelEl.parentElement && labelEl.parentElement.isConnected ? labelEl.parentElement : row;
				parent.insertBefore(line, parent === row ? null : labelEl.nextSibling);
			} catch (error) {
				releaseRow(row);
				return;
			}
			lines.set(row, { line, label: labelEl });
			try {
				labelEl.style.display = "none";
			} catch (error) { /* ignore */ }
			log("adopted, 宿主文本:", JSON.stringify((labelEl.textContent || "").slice(0, 40)));
			if (!refreshLine(line)) releaseRow(row);
		}

		/** 同步一条运行行:刷新时钟;宿主文案不再匹配(回合结束)→ 释放 */
		function syncRow(row) {
			const entry = lines.get(row);
			if (!entry) return;
			if (!row.isConnected || !entry.line.isConnected) {
				releaseRow(row);
				return;
			}
			// 宿主重渲染可能换掉文案元素:按选择器重新认领
			if (!entry.label.isConnected) {
				const next = runningLabelOf(row);
				if (!next) {
					releaseRow(row);
					return;
				}
				entry.label = next;
				try {
					next.style.display = "none";
				} catch (error) { /* ignore */ }
			}
			const duration = matchDiveText(
				entry.label.textContent || "",
				resolveDiveLabel(chatT, lastLocale),
				resolveDiveDurationPrefix(chatT, lastLocale)
			);
			if (duration === null) {
				releaseRow(row);
				return;
			}
			setClock(entry.line, duration);
		}

		/** 释放一条运行行:撤掉状态行,把宿主文案放回来 */
		function releaseRow(row) {
			const entry = lines.get(row);
			if (!entry) return;
			lines.delete(row);
			const state = typists.get(entry.line);
			if (state && state.timer !== null) clearInterval(state.timer);
			typists.delete(entry.line);
			try {
				if (entry.line.isConnected) entry.line.remove();
			} catch (error) { /* ignore */ }
			try {
				if (entry.label) entry.label.style.removeProperty("display");
			} catch (error) { /* ignore */ }
			log("released");
		}

		/** 扫描范围内的运行行(root 自身可能就是它,也可能是祖先) */
		function scanRows(root) {
			if (!(root instanceof Element)) return;
			const rows = [];
			try {
				if (typeof root.matches === "function" && root.matches(RUNNING_ROW_SELECTOR)) rows.push(root);
				for (const row of root.querySelectorAll(RUNNING_ROW_SELECTOR)) rows.push(row);
			} catch (error) {
				return;
			}
			const label = resolveDiveLabel(chatT, lastLocale);
			const prefix = resolveDiveDurationPrefix(chatT, lastLocale);
			for (const row of rows) {
				const labelEl = runningLabelOf(row);
				if (!labelEl) continue;
				if (matchDiveText(labelEl.textContent || "", label, prefix) === null) continue;
				adoptRow(row, labelEl);
			}
			for (const row of Array.from(lines.keys())) {
				if (!row.isConnected) releaseRow(row);
			}
		}

		/** 轮换:每 ROTATE_MS 给每条已接管的状态行换一句 */
		function rotate() {
			for (const row of Array.from(lines.keys())) {
				const entry = lines.get(row);
				if (!entry) continue;
				if (!refreshLine(entry.line)) releaseRow(row);
			}
		}

		/** 短语列表变化后立刻重扫:列表清空即全面释放,重新填上即立刻接管 */
		function refreshAll() {
			const label = resolveDiveLabel(chatT, lastLocale);
			const prefix = resolveDiveDurationPrefix(chatT, lastLocale);
			for (const row of Array.from(lines.keys())) {
				const entry = lines.get(row);
				if (!entry) continue;
				if (!row.isConnected || !entry.line.isConnected || phrases.length === 0) {
					releaseRow(row);
					continue;
				}
				if (matchDiveText(entry.label.textContent || "", label, prefix) === null) {
					releaseRow(row);
					continue;
				}
				refreshLine(entry.line);
			}
			if (phrases.length > 0) scanRows(document.body);
		}

		/**
		 * 装上观察器与定时器。
		 *
		 * 观察器只关心结构变化:宿主每秒重写 runningText、我们把状态行插进去,都是
		 * childList。本插件自己那条线内部的写入会被 isOwnNode 排除,否则打字机会
		 * 自己触发自己。
		 *
		 * @returns 卸载函数。
		 */
		function install() {
			const style = createOwnedStyle("dsh-status-phrases-style");
			style.textContent = STYLESHEET;
			(document.head || document.documentElement).appendChild(style);

			const observer = new MutationObserver((records) => {
				const rows = new Set();
				for (const record of records) {
					const target = record.target instanceof Element ? record.target : record.target.parentElement;
					if (target && !isOwnNode(target)) {
						const row = typeof target.closest === "function" ? target.closest(RUNNING_ROW_SELECTOR) : null;
						if (row) rows.add(row);
					}
					for (const node of record.addedNodes) {
						if (!(node instanceof Element) || isOwnNode(node)) continue;
						scanRows(node);
					}
				}
				for (const row of rows) {
					if (lines.has(row)) syncRow(row);
					else scanRows(row);
				}
				for (const row of Array.from(lines.keys())) {
					if (!row.isConnected) releaseRow(row);
				}
			});

			const start = () => {
				observer.observe(document.body, { childList: true, subtree: true, characterData: true });
				scanRows(document.body);
				log("plugin active, locale =", lastLocale, ", phrases =", phrases.length);
			};

			if (document.body !== null) start();
			else document.addEventListener("DOMContentLoaded", start, { once: true });

			const rotator = setInterval(rotate, ROTATE_MS);
			const rescanner = setInterval(() => {
				scanRows(document.body);
				// 宿主遮罩 / 会话切换等只走样式的变化不触发 mutation:这里兜底同步时钟
				for (const row of Array.from(lines.keys())) syncRow(row);
			}, RESCAN_MS);

			return () => {
				observer.disconnect();
				clearInterval(rotator);
				clearInterval(rescanner);
				for (const row of Array.from(lines.keys())) releaseRow(row);
				for (const state of typists.values()) {
					if (state.timer !== null) clearInterval(state.timer);
				}
				typists.clear();
				if (style.isConnected) style.remove();
			};
		}

		// ══ 配置框:设置 → 通用设置里的一行 ══

		/**
		 * 取本插件的配置表单句柄。宿主半区把 `phrases` 声明成 volatile 之后,设置
		 * 接缝才会为这个条目投影一份表单;拿不到句柄(没有设置文档 / 接缝变了)就
		 * 退回到内置短语继续工作,而不是让整条链路抛错。
		 *
		 * @param scope - 注入后的作用域。
		 * @returns 表单句柄,或 null。
		 */
		function configFormOf(scope) {
			try {
				const forms = scope.configForms;
				if (!forms || typeof forms.get !== "function") return null;
				const form = forms.get(ENTRY_ID);
				return form && typeof form.getSnapshot === "function" ? form : null;
			} catch (error) {
				return null;
			}
		}

		/** 一份 locale 字典(行文案) */
		const zh = {
			title: "状态行短语",
			description: "每行一句,轮到哪句就替换掉宿主那句「深度求索中」。轮换间隔 10 秒,打字机逐字输出,文字跑彩虹流光。以 # 开头的行与空行忽略;整框留空则使用内置短语。",
			placeholder: "正在深度求索…\n正在整理思路…",
			active: "当前生效",
			sentences: "句",
			saveFailed: "保存失败,请重试",
			unavailable: "这台机器上没有可写的设置文档,短语只能在回环地址的页面上编辑。",
		};
		const en = {
			title: "Status line phrases",
			description: "One phrase per line; the active phrase replaces the host's “Deep diving…”. Rotation every 10s, typed out character by character under a rainbow sweep. Blank lines and lines starting with # are ignored; an empty box means the built-in list.",
			placeholder: "正在深度求索…\n正在整理思路…",
			active: "Active",
			sentences: "phrases",
			saveFailed: "Could not save; try again",
			unavailable: "No writable settings document on this machine; edit the phrases from a loopback page.",
		};

		/**
		 * 订阅配置表单的快照。
		 *
		 * @param form - `ctx.configForms.get(id)` 的句柄。
		 * @returns 当前快照,随每次变更刷新。
		 */
		function useFormSnapshot(form) {
			const [snapshot, setSnapshot] = react.useState(() => form.getSnapshot());
			react.useEffect(() => form.subscribe(() => setSnapshot(form.getSnapshot())), [form]);
			return snapshot;
		}

		/**
		 * 设置 → 通用设置里那一行:一个多行文本框,失焦或按 Ctrl/Cmd+Enter 提交。
		 * 空框写回 `unset`,于是短语回到内置默认而不是变成空状态行。
		 */
		function StatusPhrasesRow({ t, form }) {
			const snapshot = useFormSnapshot(form);
			const stored = snapshot.value !== null && typeof snapshot.value === "object" ? snapshot.value : {};
			const storedText = typeof stored.phrases === "string" ? stored.phrases : "";
			const [draft, setDraft] = react.useState(storedText);
			const [busy, setBusy] = react.useState(false);
			const [failed, setFailed] = react.useState(false);

			// 存储值在草稿下面变了(别的窗口写入 / 保存被接受)就把草稿换成它;
			// 保存被拒绝时草稿留在原地,方便直接再提交一次。
			react.useEffect(() => { setDraft(storedText); }, [storedText]);

			const commit = () => {
				const value = draft.trim();
				if (value === storedText.trim()) return;
				setBusy(true);
				setFailed(false);
				const write = value === "" ? form.unset("phrases") : form.set("phrases", value);
				Promise.resolve(write)
					.then((accepted) => { if (!accepted) setFailed(true); })
					.catch(() => setFailed(true))
					.finally(() => setBusy(false));
			};

			const count = parsePhrases(draft).length;
			const notes = [];
			if (failed) notes.push(react.createElement("div", { className: "dsp-note", key: "save" }, t("saveFailed")));

			const field = snapshot.status === "unavailable"
				? react.createElement("div", { className: "dsp-note", key: "unavailable" }, t("unavailable"))
				: react.createElement("textarea", {
					key: "box",
					className: "dsp-input",
					value: draft,
					readOnly: busy,
					spellCheck: false,
					rows: 8,
					placeholder: t("placeholder"),
					"aria-label": t("title"),
					onChange: (event) => setDraft(event.target.value),
					onBlur: commit,
					onKeyDown: (event) => {
						if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) event.currentTarget.blur();
					},
				});

			return react.createElement("div", { className: "dsp-row" }, [
				react.createElement("div", { className: "dsp-rowText", key: "text" }, [
					react.createElement("div", { className: "dsp-title", key: "title" }, t("title")),
					react.createElement("div", { className: "dsp-desc", key: "desc" }, t("description")),
					...notes,
				]),
				react.createElement("div", { className: "dsp-control", key: "control" }, [
					react.createElement("div", { className: "dsp-desc", key: "count" }, t("active") + " " + count + " " + t("sentences")),
					field,
				]),
			]);
		}

		// ══ 入口 ══

		/** 客户端不需要任何服务就能激活状态行;配置行会等它的三个服务 */
		const inject = [];

		/**
		 * 装上状态行替换与设置行。
		 *
		 * 状态行不依赖任何服务,所以先在 DOM 上装好;短语与语言随后由各自的接缝补上,
		 * 拿不到配置接缝时用内置短语继续工作。
		 *
		 * @param ctx - 客户端根上下文。
		 */
		function apply(ctx) {
			try {
				debug = new URLSearchParams(location.search).get("dsp-debug") === "1";
			} catch (error) { /* ignore */ }

			if (document.body !== null) ctx.effect(install, "status-phrases: status line");
			else document.addEventListener("DOMContentLoaded", () => ctx.effect(install, "status-phrases: status line"), { once: true });

			ctx.inject(["locale"], (scope) => {
				scope.effect(() => scope.locale.register(SETTINGS_NS, { zh, en }), "status-phrases: dictionaries");
				// bind 的结果不跟随语言切换,所以每次读之前重新绑一次
				const bindChat = () => {
					try {
						return typeof scope.locale.bind === "function" ? scope.locale.bind("chat") : null;
					} catch (error) {
						return null;
					}
				};
				chatT = bindChat();
				try {
					lastLocale = scope.locale.getLocale().active;
				} catch (error) { /* ignore */ }
				scope.effect(() => scope.locale.subscribe(() => {
					try {
						chatT = bindChat();
						const active = scope.locale.getLocale().active;
						if (active === lastLocale) return;
						lastLocale = active;
						log("locale →", active);
						refreshAll();
					} catch (error) { /* ignore */ }
				}), "status-phrases: locale changes");
			});

			ctx.inject(["configForms"], (scope) => {
				const form = configFormOf(scope);
				if (form === null) return;
				const read = () => {
					let text = "";
					try {
						const snapshot = form.getSnapshot();
						const value = snapshot && snapshot.value !== null && typeof snapshot.value === "object" ? snapshot.value : {};
						text = typeof value.phrases === "string" ? value.phrases : "";
					} catch (error) {
						text = "";
					}
					const parsed = parsePhrases(text);
					phrases = parsed.length > 0 ? parsed : DEFAULT_PHRASES.slice();
					log("phrases →", phrases.length, parsed.length > 0 ? "(configured)" : "(built-in)");
				};
				read();
				scope.effect(() => form.subscribe(() => {
					read();
					refreshAll();
				}), "status-phrases: phrase changes");
			});

			ctx.inject(["slots", "locale", "configForms"], (scope) => {
				const form = configFormOf(scope);
				if (form === null) return;
				scope.slots.inject("settings.general.item", () => scope.slots.register({
					name: "settings.general.item",
					id: SETTINGS_NS,
					order: 13,
					locale: SETTINGS_NS,
					inject: () => ({ form }),
				}, StatusPhrasesRow));
			});
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
