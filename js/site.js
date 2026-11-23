/* Classic Calc: 3D Calculator, the site. No libraries.
 *
 * What is here, in order: the theme (the whole page wears one of the app's twelve), sound and
 * haptics, the calculator in the hero (a small version of the app's: the whole sum on screen,
 * a live answer, tap a number to fix it), the number you can turn, and the things that move on
 * scroll. Every part looks for its own elements and does nothing without them, so the policy
 * pages load the same file.
 */
(() => {
  "use strict";

  const root = document.documentElement;
  const $ = (selector, el = document) => el.querySelector(selector);
  const $$ = (selector, el = document) => [...el.querySelectorAll(selector)];
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wait = (ms) => new Promise((done) => setTimeout(done, ms));

  /** What is remembered between visits. A browser may refuse; then nothing is remembered. */
  const store = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* private window */ } },
  };

  /** Plays [el]'s animation for [name] again from the start. */
  function replay(el, name) {
    el.classList.remove(name);
    void el.offsetWidth;
    el.classList.add(name);
  }

  // ---------------------------------------------------------------- Theme

  /** The app's themes, in the order it shows them (assets-out/themes/themes.json). */
  const THEMES = ["graphite", "midnight", "cloud", "neon", "royal", "dragonfruit", "lagoon", "mocha", "mango", "santorini", "lemon", "lilac"];

  if (!THEMES.includes(root.dataset.theme)) root.dataset.theme = THEMES[0];

  /** The colour of [theme]'s plate, read from the stylesheet. */
  function plateOf(theme) {
    const probe = document.createElement("i");
    probe.dataset.theme = theme;
    probe.hidden = true;
    document.body.append(probe);
    const colour = getComputedStyle(probe).getPropertyValue("--plate").trim();
    probe.remove();
    return colour;
  }

  /** Everything that says which theme is on: the swatches, the browser's bar, the app icon. */
  function showTheme(theme, animate) {
    root.dataset.theme = theme;
    for (const swatch of $$("[data-set-theme]")) swatch.setAttribute("aria-pressed", String(swatch.dataset.setTheme === theme));
    $('meta[name="theme-color"]')?.setAttribute("content", plateOf(theme));
    for (const icon of $$("[data-app-icon]")) {
      icon.src = `assets/icons/${theme}.webp`;
      if (animate) replay(icon, "swap");
    }
  }

  /**
   * Puts [theme] on. Where the browser can, the new theme opens as a circle from the point that
   * was tapped; elsewhere the colours fade (the transition on <html> in base.css).
   */
  function setTheme(theme, event) {
    if (theme === root.dataset.theme) return;
    store.set("theme", theme);
    if (!document.startViewTransition || reduceMotion) return showTheme(theme, true);

    let x = innerWidth / 2;
    let y = innerHeight / 2;
    if (event) {
      // A click from the keyboard has no place of its own: its button's middle is used.
      const box = event.currentTarget.getBoundingClientRect();
      x = event.detail ? event.clientX : box.left + box.width / 2;
      y = event.detail ? event.clientY : box.top + box.height / 2;
    }
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));

    root.classList.add("vt");
    const transition = document.startViewTransition(() => showTheme(theme, true));
    transition.ready.then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 700, easing: "cubic-bezier(0.3, 0, 0.2, 1)", pseudoElement: "::view-transition-new(root)" },
      );
    }).catch(() => {});
    transition.finished.finally(() => root.classList.remove("vt"));
  }

  showTheme(root.dataset.theme, false);
  for (const swatch of $$("[data-set-theme]")) {
    swatch.addEventListener("click", (event) => {
      setTheme(swatch.dataset.setTheme, event);
      Sound.play("select");
    });
  }
  $("[data-next-theme]")?.addEventListener("click", (event) => {
    const next = THEMES[(THEMES.indexOf(root.dataset.theme) + 1) % THEMES.length];
    setTheme(next, event);
    Sound.play("select");
  });

  // "Number in theme colour", the app's setting.
  const numSwitch = $("[data-num-switch]");
  if (numSwitch) {
    const show = () => numSwitch.setAttribute("aria-checked", String(root.dataset.num !== "plain"));
    show();
    numSwitch.addEventListener("click", () => {
      if (root.dataset.num === "plain") delete root.dataset.num; else root.dataset.num = "plain";
      store.set("num", root.dataset.num || "theme");
      show();
      Sound.play("select");
    });
  }

  // ---------------------------------------------------------------- Sound and haptics

  /**
   * The sounds, made here instead of loaded: a click for a key, touch-tone for digits when that
   * is chosen (the two tones a phone key really makes), and a few for what happened.
   * The browser only lets a page make sound after the visitor has pressed something.
   */
  const Sound = (() => {
    const DTMF = { 1: [697, 1209], 2: [697, 1336], 3: [697, 1477], 4: [770, 1209], 5: [770, 1336], 6: [770, 1477], 7: [852, 1209], 8: [852, 1336], 9: [852, 1477], 0: [941, 1336] };
    let context = null;
    let out = null;
    let mode = ["click", "tone", "off"].includes(store.get("sound")) ? store.get("sound") : "click";
    let lastOn = mode === "off" ? "click" : mode;
    const listeners = [];

    function ready() {
      if (!context) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return false;
        context = new AudioContext();
        out = context.createGain();
        out.gain.value = 0.5;
        out.connect(context.destination);
      }
      if (context.state === "suspended") context.resume();
      return true;
    }

    /** One note: [from] Hz, sliding to [to] when given, loud at once and gone after [seconds]. */
    function note(at, seconds, from, to, gain, type = "sine") {
      const oscillator = context.createOscillator();
      const volume = context.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(from, at);
      if (to) oscillator.frequency.exponentialRampToValueAtTime(to, at + seconds);
      volume.gain.setValueAtTime(0.0001, at);
      volume.gain.exponentialRampToValueAtTime(gain, at + 0.005);
      volume.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
      oscillator.connect(volume).connect(out);
      oscillator.start(at);
      oscillator.stop(at + seconds + 0.03);
    }

    /** A short hiss around [pitch] Hz: the part of a click that sounds like plastic. */
    function hiss(at, seconds, pitch, gain, slideTo) {
      const length = Math.ceil(context.sampleRate * seconds);
      const buffer = context.createBuffer(1, length, context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      const source = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const volume = context.createGain();
      source.buffer = buffer;
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(pitch, at);
      if (slideTo) filter.frequency.exponentialRampToValueAtTime(slideTo, at + seconds);
      volume.gain.setValueAtTime(gain, at);
      volume.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
      source.connect(filter).connect(volume).connect(out);
      source.start(at);
    }

    function play(feel, key) {
      if (mode === "off" || !ready()) return;
      const now = context.currentTime;
      if (mode === "tone" && feel === "digit" && DTMF[key]) {
        for (const pitch of DTMF[key]) note(now, 0.14, pitch, null, 0.12);
        return;
      }
      switch (feel) {
        case "digit": hiss(now, 0.03, 2600, 0.3); note(now, 0.07, 190, 95, 0.4); break;
        case "operator": hiss(now, 0.03, 3400, 0.26); note(now, 0.07, 290, 150, 0.3, "triangle"); break;
        case "delete": hiss(now, 0.025, 1800, 0.2); note(now, 0.05, 150, 80, 0.3); break;
        case "select": note(now, 0.06, 520, 760, 0.16); break;
        case "deselect": note(now, 0.05, 620, 420, 0.12); break;
        case "equals": hiss(now, 0.03, 3000, 0.22); note(now, 0.08, 240, 130, 0.32, "triangle"); break;
        case "answer": hiss(now, 0.03, 3000, 0.22); note(now, 0.09, 523, null, 0.24, "triangle"); note(now + 0.075, 0.16, 784, null, 0.24, "triangle"); break;
        case "clear": hiss(now, 0.24, 2400, 0.26, 300); note(now, 0.2, 300, 60, 0.18); break;
        case "clear-empty": hiss(now, 0.03, 1600, 0.14); break;
        default: note(now, 0.13, 115, 80, 0.09, "square"); // error, reject
      }
    }

    function set(next) {
      mode = next;
      if (next !== "off") lastOn = next;
      store.set("sound", next);
      for (const listener of listeners) listener(mode);
    }

    return {
      play,
      set,
      toggle() { set(mode === "off" ? lastOn : "off"); },
      get mode() { return mode; },
      /** Calls [listener] with the mode now, and again whenever it changes. */
      watch(listener) { listeners.push(listener); listener(mode); },
    };
  })();

  /** A phone's vibration, where the browser has it (Android): short, and shaped by what happened. */
  function buzz(feel) {
    if (!navigator.vibrate) return;
    const pattern = { digit: 8, operator: 12, delete: 6, select: 6, equals: 14, answer: [10, 40, 18], clear: 16, "clear-empty": 6, error: [22, 40, 22], reject: [22, 40, 22] }[feel];
    try { if (pattern) navigator.vibrate(pattern); } catch { /* not allowed here */ }
  }

  const soundToggle = $("[data-sound-toggle]");
  if (soundToggle) {
    const label = $("[data-sound-label]", soundToggle);
    Sound.watch((mode) => {
      soundToggle.setAttribute("aria-pressed", String(mode !== "off"));
      label.textContent = mode === "off" ? "Sound off" : mode === "tone" ? "Touch-tone on" : "Sound on";
    });
    soundToggle.addEventListener("click", () => { Sound.toggle(); Sound.play("select"); });
  }
  const soundModes = $$("[data-sound-mode]");
  if (soundModes.length) {
    Sound.watch((mode) => { for (const button of soundModes) button.setAttribute("aria-pressed", String(button.dataset.soundMode === mode)); });
    for (const button of soundModes) {
      button.addEventListener("click", () => { Sound.set(button.dataset.soundMode); Sound.play("digit", "5"); });
    }
  }
  for (const key of $$("[data-tone-key]")) {
    key.addEventListener("click", () => { Sound.play("digit", key.dataset.toneKey); buzz("digit"); });
  }
  if (navigator.vibrate && matchMedia("(pointer: coarse)").matches) $("[data-vibrate-note]")?.removeAttribute("hidden");

  // A key under a finger is down, wherever it is on the page; it springs back when let go.
  document.addEventListener("pointerdown", (event) => {
    const key = event.target.closest?.(".key");
    if (!key) return;
    key.classList.add("is-down");
    const up = () => setTimeout(() => key.classList.remove("is-down"), 70);
    addEventListener("pointerup", up, { once: true });
    addEventListener("pointercancel", up, { once: true });
  });
  /** A key pressed without a pointer (the keyboard, the demo): down and up again. */
  function flash(key) {
    if (!key) return;
    key.classList.add("is-down");
    setTimeout(() => key.classList.remove("is-down"), 120);
  }

  // ---------------------------------------------------------------- Numbers as the app writes them

  // Grouped the way the visitor's country writes them: lakh and crore in India, as the app does.
  const numberFormat = new Intl.NumberFormat(/-IN$/i.test(navigator.language || "") ? "en-IN" : "en-US", { maximumFractionDigits: 10 });
  const MINUS = "−";
  const SYMBOL = { "+": "+", "-": MINUS, "*": "×", "/": "÷" };

  function formatNumber(value) {
    if (Math.abs(value) >= 1e15) return value.toExponential(6).replace("e+", "E").replace("-", MINUS);
    return numberFormat.format(value).replace("-", MINUS);
  }

  /** A number as it was typed: grouped, with the point and the zeros after it left as they are. */
  function formatTyped(token) {
    const negative = token.n.startsWith("-");
    const body = negative ? token.n.slice(1) : token.n;
    const [whole, fraction] = body.split(".");
    return (negative ? MINUS : "") + numberFormat.format(Number(whole || "0")) + (body.includes(".") ? "." + fraction : "") + (token.pct ? "%" : "");
  }

  /**
   * Writes [text] into a big number, one element a character so each can move on its own.
   * @param mode "type": only the characters that changed pop in; "all": every one, one after
   *   the other (an answer); "none": nothing moves.
   */
  function setDigits(el, text, mode = "none") {
    const old = el.dataset.text ?? el.textContent;
    let same = 0;
    if (mode === "type") while (same < old.length && same < text.length && old[same] === text[same]) same++;
    const digits = [...text].map((character, index) => {
      const digit = document.createElement("span");
      digit.className = "d";
      digit.textContent = character;
      if (mode === "all") { digit.classList.add("pop"); digit.style.setProperty("--i", index); }
      if (mode === "type" && index >= same) digit.classList.add("pop");
      return digit;
    });
    el.replaceChildren(...digits);
    el.dataset.text = text;
  }

  // ---------------------------------------------------------------- The number you can turn

  /**
   * Lets a finger turn [target] (a .bignum) by dragging across [area]: the front follows the
   * finger up to a soft limit, and let go it swings back with a wobble, keeping the speed it
   * had. The sides of the number are drawn the way the turn shows them (--ex, --ey).
   * As in the app's NumberTilt.
   */
  function makeTurnable(area, target) {
    const LIMIT = 0.62; // radians
    const STIFFNESS = 95;
    const DAMPING = 6.5;
    let yaw = 0, pitch = 0, yawSpeed = 0, pitchSpeed = 0;
    let rawYaw = 0, rawPitch = 0;
    let pointer = null, lastX = 0, lastY = 0, lastTime = 0, travelled = 0, frame = 0;

    function draw() {
      target.style.setProperty("--yaw", (yaw * 57.3).toFixed(2) + "deg");
      target.style.setProperty("--pitch", (-pitch * 57.3).toFixed(2) + "deg");
      target.style.setProperty("--ex", (0.5 - yaw * 2.6).toFixed(3));
      target.style.setProperty("--ey", (0.85 - pitch * 2.4).toFixed(3));
    }

    function swing(time) {
      const dt = Math.min((time - lastTime) / 1000, 0.032);
      lastTime = time;
      yawSpeed += (-STIFFNESS * yaw - DAMPING * yawSpeed) * dt;
      pitchSpeed += (-STIFFNESS * pitch - DAMPING * pitchSpeed) * dt;
      yaw += yawSpeed * dt;
      pitch += pitchSpeed * dt;
      const still = Math.abs(yaw) + Math.abs(pitch) < 0.002 && Math.abs(yawSpeed) + Math.abs(pitchSpeed) < 0.02;
      if (still) yaw = pitch = yawSpeed = pitchSpeed = 0;
      draw();
      frame = still ? 0 : requestAnimationFrame(swing);
    }

    area.addEventListener("pointerdown", (event) => {
      if (event.button) return;
      pointer = event.pointerId;
      cancelAnimationFrame(frame);
      rawYaw = Math.atanh(Math.max(-0.99, Math.min(0.99, yaw / LIMIT))) * LIMIT;
      rawPitch = Math.atanh(Math.max(-0.99, Math.min(0.99, pitch / LIMIT))) * LIMIT;
      lastX = event.clientX; lastY = event.clientY; lastTime = event.timeStamp; travelled = 0;
    });
    addEventListener("pointermove", (event) => {
      if (event.pointerId !== pointer) return;
      const dx = event.clientX - lastX, dy = event.clientY - lastY;
      const dt = Math.max((event.timeStamp - lastTime) / 1000, 0.001);
      travelled += Math.abs(dx) + Math.abs(dy);
      rawYaw += dx * 0.009;
      rawPitch += dy * 0.009;
      const nextYaw = LIMIT * Math.tanh(rawYaw / LIMIT), nextPitch = LIMIT * Math.tanh(rawPitch / LIMIT);
      yawSpeed = (nextYaw - yaw) / dt;
      pitchSpeed = (nextPitch - pitch) / dt;
      yaw = nextYaw; pitch = nextPitch;
      lastX = event.clientX; lastY = event.clientY; lastTime = event.timeStamp;
      draw();
    });
    const release = (event) => {
      if (event.pointerId !== pointer) return;
      pointer = null;
      yawSpeed = Math.max(-9, Math.min(9, yawSpeed));
      pitchSpeed = Math.max(-9, Math.min(9, pitchSpeed));
      if (reduceMotion) { yaw = pitch = yawSpeed = pitchSpeed = 0; draw(); return; }
      lastTime = performance.now();
      frame = requestAnimationFrame(swing);
    };
    addEventListener("pointerup", release);
    addEventListener("pointercancel", release);

    return {
      /** True when the pointer that just went up had dragged, so it was not a tap. */
      get dragged() { return travelled > 8; },
      /** A push from nowhere, to show that the number can move. */
      nudge(speed) {
        if (pointer !== null || reduceMotion) return;
        yawSpeed += speed;
        cancelAnimationFrame(frame);
        lastTime = performance.now();
        frame = requestAnimationFrame(swing);
      },
    };
  }

  const grab = $("[data-grab]");
  if (grab) {
    const turn = makeTurnable(grab, $("[data-grab-num]", grab));
    // The first time it comes into view it swings once by itself.
    new IntersectionObserver((entries, observer) => {
      if (!entries[0].isIntersecting) return;
      observer.disconnect();
      setTimeout(() => turn.nudge(5.5), 700);
    }, { threshold: 0.6 }).observe(grab);
  }

  // ---------------------------------------------------------------- The calculator

  /**
   * The app's calculator, small: an equation of numbers and operators that stays on screen,
   * worked out as it is typed with times and divide first, and a percent that means what a
   * phone's does (100 + 10% is 110). Any number in the equation can be tapped and typed over.
   *
   * @param onAnswer called with the equation and its answer, as text, when equals worked one out.
   */
  function makeCalculator(host, onAnswer) {
    const equationEl = $("[data-equation]", host);
    const numberEl = $("[data-bignum]", host);
    const burstEl = $("[data-burst]", host);
    const displayEl = $("[data-display]", host);
    const spokenEl = $("[data-spoken]", host);
    const turn = makeTurnable(displayEl, numberEl);

    const fresh = () => ({ tokens: [], done: false, result: 0, error: null, selected: -1, selectedFresh: false });
    let state = fresh();
    let lastGood = 0;
    let clearing = 0;

    const isNumber = (token) => token !== undefined && "n" in token;
    const digitCount = (text) => text.replace(/\D/g, "").length;
    /** A typed number left half done ("6.", "-") made whole. */
    function tidy(token) {
      if (token.n.endsWith(".")) token.n = token.n.slice(0, -1);
      if (token.n === "" || token.n === "-") token.n = "0";
    }

    /** What the equation comes to. Throws the word the display shows when it comes to nothing. */
    function evaluate(tokens) {
      const list = isNumber(tokens.at(-1)) ? tokens : tokens.slice(0, -1);
      if (!list.length) return 0;
      // Terms between + and −; inside a term, × and ÷ from left to right.
      const terms = [[]];
      const signs = ["+"];
      for (const token of list) {
        if (token.op === "+" || token.op === "-") { terms.push([]); signs.push(token.op); } else terms.at(-1).push(token);
      }
      const plain = (token) => parseFloat(token.n) || 0;
      const value = (token) => plain(token) * (token.pct ? 0.01 : 1);
      let total = 0;
      terms.forEach((term, index) => {
        let amount;
        if (index > 0 && term.length === 1 && term[0].pct) {
          // "+ 10%" is ten percent of what there is so far.
          amount = total * plain(term[0]) / 100;
        } else {
          amount = value(term[0]);
          for (let i = 1; i < term.length; i += 2) {
            const next = value(term[i + 1]);
            if (term[i].op === "*") amount *= next;
            else if (next === 0) throw "UNDEFINED";
            else amount /= next;
          }
        }
        total = signs[index] === "+" ? total + amount : total - amount;
      });
      if (!Number.isFinite(total)) throw "INFINITY";
      // Twelve figures: enough for money, and 0.1 + 0.2 comes out as 0.3.
      return Number(total.toPrecision(12));
    }

    /** The number a key would change: the selected one, or the one being typed at the end. */
    function typed(create) {
      if (state.selected >= 0) {
        const token = state.tokens[state.selected];
        if (state.selectedFresh) { token.n = ""; token.pct = false; state.selectedFresh = false; }
        return token;
      }
      let token = state.tokens.at(-1);
      if (!isNumber(token) && create) { token = { n: "" }; state.tokens.push(token); }
      return token;
    }

    /** What the answer on the display starts a new equation with. */
    const carried = (value) => (Math.abs(value) < 1e15 ? { n: String(value) } : null);

    const keys = {
      digit(digit) {
        if (state.error || state.done) state = fresh();
        const token = typed(true);
        if (token.pct || digitCount(token.n) >= 15) return "reject";
        token.n = token.n === "0" ? digit : token.n === "-0" ? "-" + digit : token.n + digit;
        return "digit";
      },
      point() {
        if (state.error || state.done) state = fresh();
        const token = typed(true);
        if (token.pct || token.n.includes(".")) return "reject";
        token.n += token.n === "" || token.n === "-" ? "0." : ".";
        return "digit";
      },
      operator(op) {
        if (state.error) return "reject";
        if (state.done) {
          const start = carried(state.result);
          if (!start) return "reject";
          state = { ...fresh(), tokens: [start] };
        }
        state.selected = -1;
        if (!state.tokens.length) state.tokens.push({ n: "0" });
        const last = state.tokens.at(-1);
        if (isNumber(last)) { tidy(last); state.tokens.push({ op }); } else if (last.op === op) return "reject"; else last.op = op;
        return "operator";
      },
      percent() {
        if (state.error) return "reject";
        if (state.done) {
          const start = carried(state.result);
          if (!start) return "reject";
          state = { ...fresh(), tokens: [{ ...start, pct: true }] };
          return "operator";
        }
        const token = state.selected >= 0 ? state.tokens[state.selected] : state.tokens.at(-1);
        if (!isNumber(token) || token.pct) return "reject";
        tidy(token);
        token.pct = true;
        state.selectedFresh = false;
        return "operator";
      },
      negate() {
        if (state.error) return "reject";
        if (state.done) {
          const start = carried(-state.result);
          if (!start) return "reject";
          state = { ...fresh(), tokens: [start] };
          return "operator";
        }
        const token = state.selected >= 0 ? state.tokens[state.selected] : state.tokens.at(-1);
        if (!isNumber(token)) return "reject";
        token.n = token.n.startsWith("-") ? token.n.slice(1) : "-" + token.n;
        return "operator";
      },
      back() {
        if (state.error) { state = fresh(); return "delete"; }
        // On an answer: back to the equation it came from.
        if (state.done) { state.done = false; return "delete"; }
        if (!state.tokens.length) return "reject";
        const selected = state.selected >= 0;
        const token = selected ? state.tokens[state.selected] : state.tokens.at(-1);
        if (!isNumber(token)) { state.tokens.pop(); return "delete"; }
        if (token.pct) token.pct = false; else token.n = token.n.slice(0, -1);
        const empty = token.n === "" || token.n === "-";
        if (selected) { state.selectedFresh = empty; if (empty) token.n = "0"; } else if (empty) state.tokens.pop();
        return "delete";
      },
      clear() {
        if (!state.tokens.length && !state.error) return "clear-empty";
        state = fresh();
        lastGood = 0;
        return "clear";
      },
      equals() {
        if (state.error) return "reject";
        if (state.done) return "equals";
        state.selected = -1;
        if (!state.tokens.length) return "reject";
        if (!isNumber(state.tokens.at(-1))) state.tokens.pop();
        for (const token of state.tokens) if (isNumber(token)) tidy(token);
        const worksSomethingOut = state.tokens.length > 1 || state.tokens[0].pct;
        try {
          state.result = evaluate(state.tokens);
        } catch (word) {
          state.error = word;
          state.done = true;
          return "error";
        }
        state.done = true;
        return worksSomethingOut ? "answer" : "equals";
      },
    };

    const equationText = () => state.tokens.map((token) => (isNumber(token) ? formatTyped(token) : SYMBOL[token.op])).join(" ");

    /** What the big number shows: an error's word, the answer, the number being typed, or the answer so far. */
    function bigText() {
      if (state.error) return state.error;
      if (!state.tokens.length) return "0";
      if (state.done) return formatNumber(state.result);
      if (state.tokens.length === 1 && !state.tokens[0].pct) return formatTyped(state.tokens[0]);
      try { lastGood = evaluate(state.tokens); } catch { /* keeps the last answer that could be shown */ }
      return formatNumber(lastGood);
    }

    /** Makes the big number as large as fits its line. */
    function fit() {
      numberEl.style.setProperty("--fit", 1);
      const room = numberEl.parentElement.clientWidth * 0.95;
      let width = 0;
      for (const digit of numberEl.children) width += digit.offsetWidth;
      if (width > room) numberEl.style.setProperty("--fit", Math.max(0.16, room / width).toFixed(3));
    }

    /** The lines that fly out around a new answer, from the edge of the number as it is now. */
    function burst() {
      if (reduceMotion) return;
      const number = numberEl.getBoundingClientRect();
      const box = burstEl.getBoundingClientRect();
      const halfWidth = number.width / 2 + 10, halfHeight = number.height / 2 + 2;
      const count = 14;
      if (burstEl.children.length !== count) burstEl.replaceChildren(...Array.from({ length: count }, () => document.createElement("i")));
      [...burstEl.children].forEach((ray, index) => {
        const angle = (index + 0.5) / count * Math.PI * 2;
        const edge = halfWidth * halfHeight / Math.hypot(halfHeight * Math.cos(angle), halfWidth * Math.sin(angle));
        ray.style.left = number.left + number.width / 2 - box.left + "px";
        ray.style.top = number.top + number.height / 2 - box.top + "px";
        ray.style.setProperty("--a", angle + "rad");
        ray.style.setProperty("--r", edge.toFixed(1) + "px");
      });
      replay(burstEl, "go");
    }

    function drawEquation() {
      const shown = state.tokens.length > 1 || state.tokens[0]?.pct;
      equationEl.replaceChildren(...(shown ? state.tokens : []).map((token, index) => {
        if (!isNumber(token)) {
          const operator = document.createElement("span");
          operator.className = "op";
          operator.textContent = SYMBOL[token.op];
          return operator;
        }
        const number = document.createElement("button");
        number.type = "button";
        number.className = "tok" + (index === state.selected ? " is-sel" : "");
        number.dataset.index = index;
        number.textContent = formatTyped(token);
        number.setAttribute("aria-label", `Change ${formatTyped(token)}`);
        if (index === state.selected) number.setAttribute("aria-pressed", "true");
        return number;
      }));
    }

    function draw(feel, quiet) {
      clearTimeout(clearing);
      drawEquation();
      const text = bigText();
      numberEl.classList.toggle("is-word", Boolean(state.error));

      if (feel === "clear" && !quiet && !reduceMotion) {
        // What was there falls away, then the 0 arrives.
        [...numberEl.children].forEach((digit, index) => {
          digit.style.setProperty("--i", index);
          digit.style.setProperty("--r", (index % 2 ? -1 : 1) * (8 + index * 5) + "deg");
          digit.classList.add("fall");
        });
        clearing = setTimeout(() => { setDigits(numberEl, text, "all"); fit(); }, 240);
      } else {
        setDigits(numberEl, text, quiet ? "none" : feel === "answer" || feel === "error" ? "all" : "type");
        fit();
      }

      if (quiet) return;
      if (feel === "answer") burst();
      if (feel === "reject" || feel === "error") replay(displayEl, "shake");
      if (feel === "answer" || feel === "equals") spokenEl.textContent = `Equals ${text}`;
      if (feel === "error") spokenEl.textContent = text;
    }

    /**
     * A key: "0" to "9", ".", "+", "-", "*", "/", "%", "neg", "back", "C" or "=".
     * @param silent no sound and no vibration (the demo that plays by itself).
     */
    function press(key, silent = false) {
      const feel =
        /^\d$/.test(key) ? keys.digit(key) :
        key === "." ? keys.point() :
        "+-*/".includes(key) ? keys.operator(key) :
        key === "%" ? keys.percent() :
        key === "neg" ? keys.negate() :
        key === "back" ? keys.back() :
        key === "C" ? keys.clear() :
        keys.equals();
      draw(feel);
      if (!silent) { Sound.play(feel, key); buzz(feel); }
      if (feel === "answer") onAnswer?.(equationText(), bigText(), silent);
      return feel;
    }

    // A number in the equation, tapped: the next keys type over it. Tapped again: let go.
    equationEl.addEventListener("click", (event) => {
      const number = event.target.closest(".tok");
      if (!number || state.error || turn.dragged) return;
      const index = Number(number.dataset.index);
      const feel = state.selected === index ? "deselect" : "select";
      state.selected = feel === "select" ? index : -1;
      state.selectedFresh = feel === "select";
      state.done = false;
      draw(feel);
      Sound.play(feel);
      buzz(feel);
      $(`.tok[data-index="${index}"]`, equationEl)?.focus({ preventScroll: true });
    });

    document.fonts?.ready.then(fit);
    addEventListener("resize", fit);

    return {
      press,
      /** Empties the calculator without a sound or a move. */
      reset() { state = fresh(); lastGood = 0; draw("clear", true); },
      get typing() { return state.tokens.length > 0 && !state.done; },
    };
  }

  const calcHost = $("[data-calc]");
  if (calcHost) {
    const historyList = $("[data-history]");
    const calculator = makeCalculator(calcHost, (equation, answer, fromDemo) => {
      // The visitor's own sums go to the top of the history further down the page.
      if (fromDemo || !historyList) return;
      if (historyList.firstElementChild?.dataset.sum === equation) return;
      const line = document.createElement("li");
      line.className = "new";
      line.dataset.sum = equation;
      const sum = document.createElement("span");
      const result = document.createElement("b");
      sum.textContent = equation;
      result.textContent = answer;
      result.className = "num";
      line.append(sum, result);
      historyList.prepend(line);
      while (historyList.children.length > 3) historyList.lastElementChild.remove();
    });
    const keyOf = (key) => $(`[data-key="${CSS.escape(key)}"]`, calcHost);

    // Until the visitor touches it, the calculator plays a few sums by itself.
    let demoRunning = !reduceMotion;
    let calcInView = true;
    new IntersectionObserver((entries) => { calcInView = entries[0].isIntersecting; }, { threshold: 0.35 }).observe(calcHost);

    function takeOver() {
      if (!demoRunning) return;
      demoRunning = false;
      // Half a sum of the demo's would only be in the way.
      if (calculator.typing) calculator.reset();
    }
    async function demo() {
      const sums = ["1280*4+6.5=", "100+10%=", "2+3*4=", "0.1+0.2="];
      await wait(1500);
      for (let round = 0; demoRunning; round++) {
        for (const key of sums[round % sums.length]) {
          while (demoRunning && (!calcInView || document.hidden)) await wait(400);
          if (!demoRunning) return;
          flash(keyOf(key));
          calculator.press(key, true);
          await wait(key === "=" ? 3200 : 250);
        }
        if (!demoRunning) return;
        flash(keyOf("C"));
        calculator.press("C", true);
        await wait(900);
      }
    }
    if (demoRunning) demo(); else { for (const key of "1280*4+6.5=") calculator.press(key, true); }

    calcHost.addEventListener("pointerdown", takeOver, { capture: true });
    calcHost.addEventListener("focusin", (event) => { if (event.target.matches(":focus-visible")) takeOver(); });

    $(".keys", calcHost).addEventListener("click", (event) => {
      const key = event.target.closest("[data-key]");
      if (!key) return;
      takeOver();
      if (!event.detail) flash(key); // pressed from the keyboard
      calculator.press(key.dataset.key);
    });

    // The computer's own keys, while the calculator is in view and nothing else has the focus.
    const KEYBOARD = { Enter: "=", "=": "=", Backspace: "back", Delete: "C", Escape: "C", c: "C", C: "C", x: "*", X: "*", "×": "*", "÷": "/", ",": "." };
    addEventListener("keydown", (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey || !calcInView) return;
      const focused = document.activeElement;
      const free = !focused || focused === document.body || calcHost.contains(focused);
      if (!free) return;
      // Enter on a focused button of the calculator presses that button, as everywhere.
      if (event.key === "Enter" && focused && focused !== document.body) return;
      const key = /^[\d.+\-*/%]$/.test(event.key) ? event.key : KEYBOARD[event.key];
      if (!key) return;
      event.preventDefault();
      takeOver();
      flash(keyOf(key));
      calculator.press(key);
    });
  }

  // ---------------------------------------------------------------- 02: a number fixed by itself

  const fix = $("[data-fix]");
  if (fix && !reduceMotion) {
    const number = $("[data-fix-num]", fix);
    const answer = $("[data-fix-answer]", fix);
    const finger = $(".finger", fix);
    const STEPS = [["1", "1", "10.5"], ["2", "12", "54.5"], ["8", "128", "518.5"], ["0", "1,280", "5,126.5"]];
    let inView = false;
    new IntersectionObserver((entries) => { inView = entries[0].isIntersecting; }, { threshold: 0.4 }).observe(fix);

    /** Moves the finger over [el] and taps it. */
    async function tap(el) {
      const box = fix.getBoundingClientRect();
      const target = el.getBoundingClientRect();
      finger.style.setProperty("--fx", target.left + target.width / 2 - box.left + "px");
      finger.style.setProperty("--fy", target.top + target.height / 2 - box.top + "px");
      await wait(640);
      finger.classList.add("tap");
      await wait(130);
      finger.classList.remove("tap");
    }

    (async () => {
      for (;;) {
        number.textContent = "128";
        number.classList.remove("is-sel");
        setDigits(answer, "518.5");
        while (!inView || document.hidden) await wait(400);
        await wait(1100);
        finger.classList.add("on");
        await tap(number);
        number.classList.add("is-sel");
        await wait(500);
        for (const [key, typed, result] of STEPS) {
          const keyEl = $(`[data-fix-key="${key}"]`, fix);
          await tap(keyEl);
          flash(keyEl);
          number.textContent = typed;
          setDigits(answer, result, "type");
        }
        await wait(350);
        finger.classList.remove("on");
        await wait(700);
        number.classList.remove("is-sel");
        await wait(3000);
      }
    })();
  }

  // ---------------------------------------------------------------- 04: discount and GST

  const quick = $("[data-quick]");
  if (quick) {
    const RATES = { discount: ["5", "10", "20", "25", "50"], add: ["3", "5", "18", "40"], remove: ["3", "5", "18", "40"] };
    const NOTES = {
      discount: "Rates of 5, 10, 20, 25 and 50% are free. The bill and a rate of your own come with Premium.",
      add: "On phones in India. The 3, 5, 18 and 40% buttons are free; the CGST and SGST split comes with Premium.",
      remove: "For a price that already has the tax in it. The split into CGST and SGST comes with Premium.",
    };
    const AMOUNT = 100000; // 1,000.00, in paise
    const ratesEl = $("[data-quick-rates]", quick);
    const billEl = $("[data-quick-bill]", quick);
    const totalEl = $("[data-quick-total]", quick);
    const equationEl = $("[data-quick-equation]", quick);
    const noteEl = $("[data-quick-note]", quick);
    const chosen = { kind: "discount", rate: { discount: "20", add: "18", remove: "18" } };

    function show(animate) {
      const kind = chosen.kind;
      const rate = Number(chosen.rate[kind]);
      // As the app's bill: the total and the amount before are rounded to the paisa, the tax or
      // discount is what lies between them, and SGST is what CGST leaves of the tax.
      let base = AMOUNT, total = AMOUNT, lines;
      if (kind === "discount") total = Math.round(AMOUNT * (1 - rate / 100));
      if (kind === "add") total = Math.round(AMOUNT * (1 + rate / 100));
      if (kind === "remove") base = Math.round(AMOUNT / (1 + rate / 100));
      const change = Math.abs(total - base);
      const cgst = Math.round(change / 2);
      if (kind === "discount") lines = [["Price", base], [`Discount ${rate}%`, -change], ["You pay", total]];
      else lines = [["Taxable value", base], [`CGST ${rate / 2}%`, cgst], [`SGST ${rate / 2}%`, change - cgst], ["Total", total]];

      const paise = lines.some(([, value]) => value % 100 !== 0);
      const money = (value) => (value < 0 ? MINUS : "") + (Math.abs(value) / 100).toLocaleString("en-US", { minimumFractionDigits: paise ? 2 : 0, maximumFractionDigits: 2 });

      equationEl.textContent = kind === "discount" ? `1,000 ${MINUS} ${rate}%` : kind === "add" ? `1,000 + ${rate}%` : `1,000 ÷ ${1 + rate / 100}`;
      totalEl.textContent = money(kind === "remove" ? base : total);
      noteEl.textContent = NOTES[kind];
      billEl.replaceChildren(...lines.map(([label, value], index) => {
        const row = document.createElement("div");
        const term = document.createElement("dt");
        const amount = document.createElement("dd");
        if (index === lines.length - 1) row.className = "bill-total";
        row.style.setProperty("--i", index);
        if (!animate) row.style.animation = "none";
        term.textContent = label;
        amount.textContent = money(value);
        amount.className = "num";
        row.append(term, amount);
        return row;
      }));
      ratesEl.replaceChildren(...RATES[kind].map((value) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "rate";
        button.textContent = value + "%";
        button.setAttribute("aria-pressed", String(value === chosen.rate[kind]));
        button.addEventListener("click", () => { chosen.rate[kind] = value; show(true); Sound.play("answer"); buzz("answer"); });
        return button;
      }));
      for (const button of $$("[data-quick-kind]", quick)) button.setAttribute("aria-pressed", String(button.dataset.quickKind === kind));
      if (animate) replay(totalEl, "pop");
    }

    for (const button of $$("[data-quick-kind]", quick)) {
      button.addEventListener("click", () => { chosen.kind = button.dataset.quickKind; show(true); Sound.play("operator"); buzz("operator"); });
    }
    show(false);
  }

  // ---------------------------------------------------------------- Type that arrives

  // The headline: every letter its own element, let down one after the other.
  for (const heading of $$("[data-letters]")) {
    const label = heading.textContent.trim().replace(/\s+/g, " ");
    let count = 0;
    const letters = (text) => text.split(/(\s+)/).map((part) => {
      if (!part.trim()) return document.createTextNode(part ? " " : "");
      const word = document.createElement("span");
      word.className = "w";
      for (const character of part) {
        const letter = document.createElement("span");
        letter.className = "ch";
        letter.style.setProperty("--i", count++);
        letter.textContent = character;
        word.append(letter);
      }
      return word;
    });
    const inner = document.createElement("span");
    inner.setAttribute("aria-hidden", "true");
    for (const node of [...heading.childNodes]) {
      if (node.nodeType === Node.TEXT_NODE) inner.append(...letters(node.textContent));
      else { const copy = node.cloneNode(false); copy.append(...letters(node.textContent)); inner.append(copy); }
    }
    heading.replaceChildren(inner);
    heading.setAttribute("aria-label", label);
  }

  // Section headings: word by word.
  for (const heading of $$("[data-words]")) {
    const words = heading.textContent.trim().split(/\s+/);
    heading.replaceChildren(...words.flatMap((text, index) => {
      const word = document.createElement("span");
      const inner = document.createElement("i");
      word.className = "w";
      inner.style.setProperty("--i", index);
      inner.textContent = text;
      word.append(inner);
      return index ? [" ", word] : [word];
    }));
  }

  // Whatever is marked to arrive, arrives when it scrolls into view. Once.
  const arriving = $$("[data-reveal], [data-words]");
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("in");
        observer.unobserve(entry.target);
      }
    }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    for (const el of arriving) observer.observe(el);
  } else {
    for (const el of arriving) el.classList.add("in");
  }

  // The ticker: its sums twice over, so the loop has no seam.
  const ticker = $("[data-ticker]");
  if (ticker) ticker.append(...[...ticker.children].map((sum) => sum.cloneNode(true)));

  $$(".closing-keys span").forEach((key, index) => key.style.setProperty("--i", index));

  // ---------------------------------------------------------------- Scroll and pointer

  const nav = $("[data-nav]");
  const progress = $("[data-progress]");
  const hero = $("[data-hero]");
  let lastScroll = scrollY;
  let ticking = false;

  function onScroll() {
    ticking = false;
    const y = scrollY;
    const height = document.documentElement.scrollHeight - innerHeight;
    progress?.style.setProperty("--p", height > 0 ? (y / height).toFixed(4) : 0);
    // The bar steps aside on the way down and comes back on the way up.
    if (nav) {
      if (y > 480 && y > lastScroll + 4) nav.setAttribute("data-hidden", "");
      else if (y < lastScroll - 4 || y <= 480) nav.removeAttribute("data-hidden");
    }
    if (hero && y < innerHeight * 1.5) hero.style.setProperty("--sy", (y / innerHeight).toFixed(3));
    lastScroll = y;
  }
  addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  onScroll();
  // A link in the bar was followed with the keyboard: the bar must be in sight.
  nav?.addEventListener("focusin", () => nav.removeAttribute("data-hidden"));

  // With a mouse, the phone leans towards the pointer and the operators behind it drift away.
  if (hero && !reduceMotion && matchMedia("(hover: hover) and (pointer: fine)").matches) {
    const phone = $(".phone", hero);
    let targetX = 0, targetY = 0, x = 0, y = 0, frame = 0;
    const lean = () => {
      x += (targetX - x) * 0.09;
      y += (targetY - y) * 0.09;
      hero.style.setProperty("--px", x.toFixed(3));
      hero.style.setProperty("--py", y.toFixed(3));
      phone?.style.setProperty("--ry", (x * 7).toFixed(2) + "deg");
      phone?.style.setProperty("--rx", (y * -5).toFixed(2) + "deg");
      frame = Math.abs(targetX - x) + Math.abs(targetY - y) > 0.002 ? requestAnimationFrame(lean) : 0;
    };
    hero.addEventListener("pointermove", (event) => {
      targetX = event.clientX / innerWidth * 2 - 1;
      targetY = event.clientY / innerHeight * 2 - 1;
      if (!frame) frame = requestAnimationFrame(lean);
    });
    hero.addEventListener("pointerleave", () => { targetX = targetY = 0; if (!frame) frame = requestAnimationFrame(lean); });
  }
})();
