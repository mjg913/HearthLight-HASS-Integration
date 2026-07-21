/**
 * hearthlight-brand — theme-adaptive HearthLight brand marks.
 *
 * Inlines a bundled SVG and maps its two color roles (slate wordmark,
 * ember flame) to CSS custom properties, so the mark follows the active
 * theme's light/dark mode exactly like text does.
 *
 * Every *-color.svg asset uses .cls-1 = slate (#253540), .cls-2 = ember
 * (#fc7114); the embedded <style> is stripped and replaced with fills
 * resolved per color_mode.
 */

const ASSETS = [
  "combination-mark",
  "combination-mark-2",
  "wordmark",
  "wordmark-2",
];
const COLOR_MODES = ["theme", "brand", "mono", "custom"];
const ALIGNMENTS = ["start", "center", "end"];
const BRAND_EMBER = "#fc7114";
const BRAND_SLATE = "#253540";

// ?v= from the registered resource URL, so SVG fetches cache-bust with releases.
const VERSION = new URL(import.meta.url).searchParams.get("v") ?? "0";
const svgCache = new Map();

async function fetchSvg(asset) {
  if (!svgCache.has(asset)) {
    svgCache.set(
      asset,
      fetch(`/hearthlight/brand/${asset}-color.svg?v=${VERSION}`).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      }),
    );
  }
  return svgCache.get(asset);
}

function roleColors(config) {
  switch (config.color_mode ?? "theme") {
    case "brand":
      return { slate: `var(--primary-text-color, ${BRAND_SLATE})`, ember: BRAND_EMBER };
    case "mono":
      return {
        slate: "var(--primary-text-color)",
        ember: "var(--primary-text-color)",
      };
    case "custom":
      return {
        slate: config.colors?.slate ?? BRAND_SLATE,
        ember: config.colors?.flame ?? config.colors?.ember ?? BRAND_EMBER,
      };
    case "theme":
    default:
      return {
        slate: `var(--primary-text-color, ${BRAND_SLATE})`,
        ember: `var(--primary-color, ${BRAND_EMBER})`,
      };
  }
}

class HearthLightBrandCard extends HTMLElement {
  setConfig(config) {
    const asset = config.asset ?? "combination-mark";
    if (!ASSETS.includes(asset)) {
      throw new Error(`asset must be one of: ${ASSETS.join(", ")}`);
    }
    const mode = config.color_mode ?? "theme";
    if (!COLOR_MODES.includes(mode)) {
      throw new Error(`color_mode must be one of: ${COLOR_MODES.join(", ")}`);
    }
    this._config = { ...config, asset, color_mode: mode };
    this._render();
  }

  set hass(hass) {
    this._hass = hass; // colors track CSS variables live; no re-render needed
  }

  getCardSize() {
    return this._config?.plain ? 1 : 2;
  }

  static getConfigElement() {
    return document.createElement("hearthlight-brand-editor");
  }

  static getStubConfig() {
    return { asset: "combination-mark", color_mode: "theme" };
  }

  async _render() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const config = this._config;
    let svgText;
    try {
      svgText = await fetchSvg(config.asset);
    } catch (err) {
      this.shadowRoot.innerHTML = `<ha-card><div style="padding:16px;color:var(--error-color)">hearthlight-brand: could not load ${config.asset} (${err.message})</div></ha-card>`;
      return;
    }
    if (this._config !== config) return; // stale render after config change

    const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
    const svg = doc.documentElement;
    if (svg.nodeName !== "svg") return;
    svg.querySelector("defs > style")?.remove();
    svg.removeAttribute("width");
    svg.removeAttribute("height");

    const { slate, ember } = roleColors(config);
    const height = config.height ?? "96px";
    const alignment = ALIGNMENTS.includes(config.alignment)
      ? config.alignment
      : "center";
    const justify = alignment === "center" ? "center" : `flex-${alignment}`;
    // plain: bare logo with no card chrome, like the markdown card's text_only
    const wrapperTag = config.plain ? "div" : "ha-card";

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        .wrap {
          display: flex;
          justify-content: ${justify};
          align-items: center;
          padding: ${config.plain ? "0" : "16px"};
        }
        svg { height: ${height}; width: auto; max-width: 100%; display: block; }
        .cls-1 { fill: ${slate}; }
        .cls-2 { fill: ${ember}; }
      </style>
      <${wrapperTag} class="wrap"></${wrapperTag}>`;
    this.shadowRoot.querySelector(".wrap").append(svg);
  }
}

/** Visual editor: standard ha-form driven config UI. */
class HearthLightBrandEditor extends HTMLElement {
  setConfig(config) {
    this._config = config ?? {};
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
  }

  _labels = {
    asset: "Brand mark",
    color_mode: "Color mode",
    height: "Height (CSS length, e.g. 96px)",
    alignment: "Alignment",
    plain: "Logo only (no card background)",
    color_slate: "Slate role color (CSS color or var())",
    color_flame: "Flame role color (CSS color or var())",
  };

  _schema(colorMode) {
    const opt = (v, label) => ({ value: v, label });
    const schema = [
      {
        name: "asset",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              opt("combination-mark", "Combination mark"),
              opt("combination-mark-2", "Combination mark 2"),
              opt("wordmark", "Wordmark"),
              opt("wordmark-2", "Wordmark 2"),
            ],
          },
        },
      },
      {
        name: "color_mode",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              opt("theme", "Theme (follows theme colors)"),
              opt("brand", "Brand (flame always ember)"),
              opt("mono", "Mono (single text color)"),
              opt("custom", "Custom colors"),
            ],
          },
        },
      },
      { name: "height", selector: { text: {} } },
      {
        name: "alignment",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              opt("start", "Start"),
              opt("center", "Center"),
              opt("end", "End"),
            ],
          },
        },
      },
      { name: "plain", selector: { boolean: {} } },
    ];
    if (colorMode === "custom") {
      schema.push(
        { name: "color_slate", selector: { text: {} } },
        { name: "color_flame", selector: { text: {} } },
      );
    }
    return schema;
  }

  _render() {
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) => this._labels[s.name] ?? s.name;
      this._form.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        this._onValueChanged(ev.detail.value);
      });
      this.append(this._form);
    }
    const c = this._config;
    this._form.hass = this._hass;
    this._form.data = {
      asset: c.asset ?? "combination-mark",
      color_mode: c.color_mode ?? "theme",
      height: c.height ?? "96px",
      alignment: c.alignment ?? "center",
      plain: c.plain ?? false,
      color_slate: c.colors?.slate ?? "",
      color_flame: c.colors?.flame ?? "",
    };
    this._form.schema = this._schema(c.color_mode ?? "theme");
  }

  _onValueChanged(value) {
    const { color_slate: slate, color_flame: flame, ...rest } = value;
    const config = { ...this._config, ...rest };
    if (config.color_mode === "custom") {
      config.colors = {};
      if (slate) config.colors.slate = slate;
      if (flame) config.colors.flame = flame;
    } else {
      delete config.colors;
    }
    if (!config.plain) delete config.plain;
    if (config.height === "96px") delete config.height;
    if (config.alignment === "center") delete config.alignment;
    this._config = config;
    this._render(); // schema may change when color_mode toggles custom
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

if (!customElements.get("hearthlight-brand")) {
  customElements.define("hearthlight-brand", HearthLightBrandCard);
}
if (!customElements.get("hearthlight-brand-editor")) {
  customElements.define("hearthlight-brand-editor", HearthLightBrandEditor);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "hearthlight-brand",
  name: "HearthLight Brand",
  description: "Theme-adaptive HearthLight brand mark",
  preview: true,
  documentationURL: "https://github.com/mjg913/HearthLight-HASS-Integration",
});

/**
 * hearthlight-remote-access — time-boxed remote access toggle.
 *
 * Fronts the integration's per-user remote-access switch: toggle, live
 * countdown from the switch's expires_at attribute, and a stepper for the
 * sibling duration number (found via the shared per-user device).
 */

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function formatRemaining(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} h ${m} min`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatDurationMinutes(minutes) {
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  return `${Math.round(minutes)} min`;
}

class HearthLightRemoteAccessCard extends HTMLElement {
  setConfig(config) {
    if (!config.entity) {
      throw new Error("entity is required (a HearthLight remote-access switch)");
    }
    this._config = config;
    this._built = false; // config changes rebuild the skeleton
    this._render();
  }

  set hass(hass) {
    const old = this._hass;
    this._hass = hass;
    if (!this._config) return;
    const sw = this._config.entity;
    const num = this._numberEntityId(hass);
    if (
      !old ||
      old.states[sw] !== hass.states[sw] ||
      (num && old.states[num] !== hass.states[num])
    ) {
      this._render();
    }
  }

  connectedCallback() {
    if (this._config && this._hass) this._render();
  }

  disconnectedCallback() {
    this._stopCountdown();
    clearTimeout(this._pwStageTimer);
  }

  getCardSize() {
    return 3;
  }

  static getConfigElement() {
    return document.createElement("hearthlight-remote-access-editor");
  }

  static getStubConfig(hass) {
    const entity = Object.keys(hass?.entities ?? {}).find(
      (id) =>
        id.startsWith("switch.") && hass.entities[id].platform === "hearthlight",
    );
    return { entity: entity ?? "" };
  }

  _numberEntityId(hass) {
    const deviceId = hass?.entities?.[this._config.entity]?.device_id;
    if (!deviceId) return null;
    return (
      Object.keys(hass.entities).find(
        (id) => id.startsWith("number.") && hass.entities[id].device_id === deviceId,
      ) ?? null
    );
  }

  _stopCountdown() {
    if (this._countdownTimer) {
      clearInterval(this._countdownTimer);
      this._countdownTimer = null;
    }
  }

  _render() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const hass = this._hass;
    const config = this._config;
    if (!hass || !config) return;

    const state = hass.states[config.entity];
    if (!state) {
      this._stopCountdown();
      this._built = false;
      this.shadowRoot.innerHTML = `<ha-card><div style="padding:16px;color:var(--error-color)">hearthlight-remote-access: entity ${escapeHtml(config.entity)} not found</div></ha-card>`;
      return;
    }
    if (!this._built) this._build();
    this._update(state);
  }

  _build() {
    const canCopy = !!(navigator.clipboard && window.isSecureContext);
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card {
          padding: 16px;
          --ha-card-border-width: 1.5px;
        }
        ha-card.private { --ha-card-border-color: var(--success-color, #1f9d63); }
        ha-card.active {
          --ha-card-border-color: ${BRAND_EMBER};
          --ha-card-box-shadow: 0 0 0 1px rgba(252, 113, 20, 0.18),
            0 2px 14px rgba(252, 113, 20, 0.16);
        }
        .head { display: flex; align-items: center; gap: 12px; }
        .chip {
          width: 40px; height: 40px; border-radius: 50%; flex: none;
          display: flex; align-items: center; justify-content: center;
        }
        .chip ha-icon { --mdc-icon-size: 22px; }
        .private .chip {
          background: rgba(var(--rgb-success-color, 31, 157, 99), 0.12);
          color: var(--success-color, #1f9d63);
        }
        .active .chip { background: rgba(252, 113, 20, 0.12); color: ${BRAND_EMBER}; }
        .unavail .chip {
          background: var(--secondary-background-color);
          color: var(--disabled-text-color);
        }
        .titles { flex: 1; min-width: 0; }
        .name {
          font-size: 1.05em; font-weight: 600;
          color: var(--primary-text-color);
        }
        .state-label { margin-top: 2px; font-size: 0.8em; font-weight: 500; }
        .private .state-label { color: var(--success-color, #1f9d63); }
        .active .state-label { color: ${BRAND_EMBER}; }
        .unavail .state-label { color: var(--disabled-text-color); }
        .helper {
          margin: 12px 0 0; font-size: 0.9em; line-height: 1.45;
          color: var(--secondary-text-color);
        }
        /* Collapsible regions: grid-rows trick animates height to auto. */
        .collapse { display: grid; grid-template-rows: 0fr; }
        .collapse.open { grid-template-rows: 1fr; }
        .clip { overflow: hidden; min-height: 0; }
        /* Password content fades in only after the box finishes expanding. */
        .pwcontent { opacity: 0; }
        .pwcontent.notrans { transition: none !important; }
        .pwwrap.shown .pwcontent { opacity: 1; }
        /* Transitions are enabled only after first paint (.ready), so a card
           that loads already-active settles instantly with no entrance. */
        ha-card.ready { transition: border-color 0.3s ease, box-shadow 0.3s ease; }
        .ready .chip, .ready .state-label {
          transition: background-color 0.3s ease, color 0.3s ease;
        }
        .ready .collapse { transition: grid-template-rows 0.35s ease; }
        .ready .pwcontent { transition: opacity 0.25s ease; }
        .countdown { margin-top: 8px; font-size: 0.85em; color: var(--secondary-text-color); }
        .pwpanel {
          margin-top: 12px; padding: 12px 12px 10px; text-align: center;
          border-radius: var(--mdc-shape-medium, 12px);
          background: var(--secondary-background-color);
        }
        .pwlabel {
          font-size: 0.7em; font-weight: 600; letter-spacing: 0.09em;
          text-transform: uppercase; color: var(--secondary-text-color);
        }
        .pwrow {
          display: flex; align-items: center; justify-content: center;
          gap: 12px; margin-top: 6px;
        }
        .pw {
          font-family: var(--ha-font-family-code, monospace);
          font-size: 1.35em; letter-spacing: 2px;
          color: var(--primary-text-color);
        }
        .copy {
          border: 1px solid var(--divider-color); border-radius: 12px;
          background: none; cursor: pointer; padding: 2px 10px;
          font-size: 0.8em; color: var(--primary-text-color);
        }
        .copy:hover { border-color: ${BRAND_EMBER}; }
        .pwhint, .hint { margin-top: 6px; font-size: 0.75em; color: var(--secondary-text-color); }
        .duration {
          display: flex; align-items: center; gap: 8px; margin-top: 12px;
          color: var(--primary-text-color);
        }
        .duration .label { flex: 1; font-size: 0.9em; color: var(--secondary-text-color); }
        .duration .value { min-width: 64px; text-align: center; }
        .step {
          width: 32px; height: 32px; border-radius: 50%;
          border: 1px solid var(--divider-color); background: none;
          color: var(--primary-text-color); font-size: 1.1em; cursor: pointer;
        }
        .step:hover { border-color: ${BRAND_EMBER}; }
        .fallback-toggle {
          width: 44px; height: 24px; border-radius: 12px; border: none;
          cursor: pointer; position: relative;
          background: var(--switch-unchecked-track-color, var(--divider-color));
        }
        .fallback-toggle[aria-checked="true"] { background: ${BRAND_EMBER}; }
        .fallback-toggle::after {
          content: ""; position: absolute; top: 2px; left: 2px;
          width: 20px; height: 20px; border-radius: 50%; background: #fff;
          transition: transform 0.15s;
        }
        .fallback-toggle[aria-checked="true"]::after { transform: translateX(20px); }
      </style>
      <ha-card>
        <div class="head">
          <div class="chip"><ha-icon></ha-icon></div>
          <div class="titles">
            <div class="name"></div>
            <div class="state-label"></div>
          </div>
          <div class="toggle"></div>
        </div>
        <p class="helper"></p>
        <div class="collapse pwwrap">
          <div class="clip">
            <div class="pwpanel">
              <div class="pwcontent">
                <div class="pwlabel">Session password</div>
                <div class="pwrow">
                  <span class="pw"></span>
                  ${canCopy ? `<button class="copy">Copy</button>` : ""}
                </div>
                <div class="pwhint">Read this to the support technician — it changes every session</div>
              </div>
            </div>
          </div>
        </div>
        <div class="collapse cdwrap">
          <div class="clip"><div class="countdown"></div></div>
        </div>
        <div class="durwrap">
          <div class="duration">
            <span class="label">Duration</span>
            <button class="step" data-dir="-1" aria-label="Decrease duration">−</button>
            <span class="value"></span>
            <button class="step" data-dir="1" aria-label="Increase duration">＋</button>
          </div>
          <div class="hint">Applies the next time access is turned on</div>
        </div>
      </ha-card>`;

    const root = this.shadowRoot;
    this._card = root.querySelector("ha-card");
    this._chipIcon = root.querySelector(".chip ha-icon");
    this._nameEl = root.querySelector(".name");
    this._stateLabelEl = root.querySelector(".state-label");
    this._helperEl = root.querySelector(".helper");
    this._pwWrap = root.querySelector(".pwwrap");
    this._pwContent = root.querySelector(".pwcontent");
    this._pwEl = root.querySelector(".pw");
    this._cdWrap = root.querySelector(".cdwrap");
    this._countdownEl = root.querySelector(".countdown");
    this._durWrap = root.querySelector(".durwrap");
    this._durValueEl = root.querySelector(".duration .value");
    this._passwordValue = null;

    this._switch = this._makeToggle();
    root.querySelector(".toggle").append(this._switch);

    const copyBtn = root.querySelector(".copy");
    if (copyBtn) {
      copyBtn.addEventListener("click", async () => {
        if (!this._passwordValue) return;
        try {
          await navigator.clipboard.writeText(this._passwordValue);
          copyBtn.textContent = "Copied";
          setTimeout(() => {
            copyBtn.textContent = "Copy";
          }, 1500);
        } catch {
          /* denied: display-only fallback */
        }
      });
    }
    for (const btn of root.querySelectorAll(".duration .step")) {
      btn.addEventListener("click", () => {
        const ctx = this._durationCtx;
        if (!ctx) return;
        const next = Math.min(
          ctx.max,
          Math.max(ctx.min, ctx.value + Number(btn.dataset.dir) * ctx.step),
        );
        if (next !== ctx.value) {
          this._hass.callService("number", "set_value", {
            entity_id: ctx.numId,
            value: next,
          });
        }
      });
    }

    requestAnimationFrame(() =>
      requestAnimationFrame(() => this._card.classList.add("ready")),
    );
    this._built = true;
  }

  _update(state) {
    const config = this._config;
    const isOn = state.state === "on";
    const unavailable = state.state === "unavailable";
    this._isOn = isOn;

    let stateClass = "private";
    let icon = "mdi:shield-check";
    let stateLabel = "Private";
    let helper =
      "Your system is private. Our team cannot remotely access your home.";
    if (unavailable) {
      stateClass = "unavail";
      icon = "mdi:shield-off-outline";
      stateLabel = "Unavailable";
      helper = "This control is unavailable — the managed user may no longer exist.";
    } else if (isOn) {
      stateClass = "active";
      icon = "mdi:headset";
      stateLabel = "Support access active";
      helper = "Our team can currently connect to your home to assist you.";
    }

    this._card.classList.remove("private", "active", "unavail");
    this._card.classList.add(stateClass);
    this._chipIcon.setAttribute("icon", icon);
    this._nameEl.textContent =
      config.name ?? state.attributes.friendly_name ?? "Remote access";
    this._stateLabelEl.textContent = stateLabel;
    this._helperEl.textContent = helper;

    // Programmatic sync fires no change event, so no service-call loop.
    if (this._switch.tagName === "HA-SWITCH") {
      this._switch.checked = isOn;
    } else {
      this._switch.setAttribute("aria-checked", String(isOn));
    }
    this._switch.disabled = unavailable;

    this._expiresAt =
      isOn && state.attributes.expires_at
        ? new Date(state.attributes.expires_at)
        : null;
    if (this._expiresAt && !Number.isNaN(this._expiresAt.getTime())) {
      this._cdWrap.classList.add("open");
      this._updateCountdown();
      if (!this._countdownTimer) {
        this._countdownTimer = setInterval(() => this._updateCountdown(), 1000);
      }
    } else {
      this._cdWrap.classList.remove("open");
      this._stopCountdown();
    }

    const password = isOn ? state.attributes.session_password : undefined;
    this._setPassword(
      config.show_password !== false && password ? password : null,
    );

    const numId = this._numberEntityId(this._hass);
    const numState = numId ? this._hass.states[numId] : null;
    const showDuration = config.show_duration !== false && numState !== null;
    this._durWrap.style.display = showDuration ? "" : "none";
    if (showDuration) {
      const value = Number(numState.state);
      this._durationCtx = {
        numId,
        value,
        min: Number(numState.attributes.min ?? 5),
        max: Number(numState.attributes.max ?? 1440),
        step: Number(numState.attributes.step ?? 5),
      };
      this._durValueEl.textContent = Number.isFinite(value)
        ? formatDurationMinutes(value)
        : numState.state;
    }
  }

  _setPassword(password) {
    if (password === this._passwordValue) return;
    // textContent only — the password must never be interpolated into HTML.
    this._passwordValue = password;
    const wrap = this._pwWrap;
    clearTimeout(this._pwStageTimer);
    if (!password) {
      // Collapse; the content fades away while the box shrinks, then the
      // digits are cleared so a closed panel can never re-open with residue.
      wrap.classList.remove("open", "shown");
      this._pwStageTimer = setTimeout(() => {
        this._pwEl.textContent = "";
      }, 400);
      return;
    }
    if (!this._card.classList.contains("ready")) {
      // First paint of an already-active card: settle instantly.
      this._pwEl.textContent = password;
      wrap.classList.add("open", "shown");
      return;
    }
    if (!wrap.classList.contains("open")) {
      // Grow the box first; fade the content in once fully expanded.
      this._pwEl.textContent = password;
      wrap.classList.add("open");
      this._afterExpand(() => wrap.classList.add("shown"));
    } else {
      // New session while open: never animate the superseded value — snap
      // it invisible instantly, swap the text, then fade the new one in.
      this._pwContent.classList.add("notrans");
      wrap.classList.remove("shown");
      void this._pwContent.offsetWidth; // commit the snap
      this._pwContent.classList.remove("notrans");
      this._pwEl.textContent = password;
      requestAnimationFrame(() => wrap.classList.add("shown"));
    }
  }

  _afterExpand(callback) {
    let fired = false;
    const fire = () => {
      if (fired) return;
      fired = true;
      // Skip if the panel was collapsed again before the expansion finished
      // (the collapse fires its own grid-template-rows transitionend).
      if (this._pwWrap.classList.contains("open")) callback();
    };
    this._pwWrap.addEventListener(
      "transitionend",
      (ev) => {
        if (ev.propertyName === "grid-template-rows") fire();
      },
      { once: true },
    );
    // Fallback in case the transitionend event is lost (tab switch, etc.).
    this._pwStageTimer = setTimeout(fire, 420);
  }

  _updateCountdown() {
    const el = this._countdownEl;
    if (!el || !this._expiresAt) return;
    const remaining = this._expiresAt - Date.now();
    el.textContent =
      remaining > 0
        ? `Access ends automatically in ${formatRemaining(remaining)}`
        : "Access is ending…";
  }

  _makeToggle() {
    let el;
    if (customElements.get("ha-switch")) {
      el = document.createElement("ha-switch");
      // The active accent is the brand ember regardless of theme. Both token
      // generations: webawesome ha-switch (HA 2026.x) + legacy mwc (≤2025.x).
      el.style.setProperty("--ha-switch-checked-background-color", BRAND_EMBER);
      el.style.setProperty("--ha-switch-checked-border-color", BRAND_EMBER);
      el.style.setProperty("--ha-switch-checked-thumb-background-color", "#ffffff");
      el.style.setProperty("--ha-switch-checked-thumb-border-color", "#ffffff");
      el.style.setProperty("--switch-checked-button-color", BRAND_EMBER);
      el.style.setProperty("--switch-checked-track-color", "rgba(252, 113, 20, 0.5)");
      el.addEventListener("change", () => {
        // Only act on user intent: ignore change events that merely echo
        // the state we already have (e.g. from programmatic checked sync).
        if (el.checked === this._isOn) return;
        this._toggle(el.checked);
      });
    } else {
      // ha-switch not defined (unusual load order): degrade to a CSS toggle.
      el = document.createElement("button");
      el.className = "fallback-toggle";
      el.setAttribute("role", "switch");
      el.setAttribute("aria-checked", "false");
      el.addEventListener("click", () => this._toggle(!this._isOn));
    }
    return el;
  }

  _toggle(turnOn) {
    this._hass.callService("switch", turnOn ? "turn_on" : "turn_off", {
      entity_id: this._config.entity,
    });
  }
}

/** Visual editor for hearthlight-remote-access. */
class HearthLightRemoteAccessEditor extends HTMLElement {
  setConfig(config) {
    this._config = config ?? {};
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
  }

  _labels = {
    entity: "Remote access switch",
    name: "Name",
    show_duration: "Show the duration setting",
    show_password: "Show the session password",
  };

  _schema = [
    {
      name: "entity",
      required: true,
      selector: { entity: { filter: { integration: "hearthlight", domain: "switch" } } },
    },
    { name: "name", selector: { text: {} } },
    { name: "show_duration", selector: { boolean: {} } },
    { name: "show_password", selector: { boolean: {} } },
  ];

  _render() {
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) => this._labels[s.name] ?? s.name;
      this._form.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        this._onValueChanged(ev.detail.value);
      });
      this.append(this._form);
    }
    const c = this._config;
    this._form.hass = this._hass;
    this._form.data = {
      entity: c.entity ?? "",
      name: c.name ?? "",
      show_duration: c.show_duration ?? true,
      show_password: c.show_password ?? true,
    };
    this._form.schema = this._schema;
  }

  _onValueChanged(value) {
    const config = { ...this._config, ...value };
    if (!config.name) delete config.name;
    if (config.show_duration !== false) delete config.show_duration;
    if (config.show_password !== false) delete config.show_password;
    this._config = config;
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

if (!customElements.get("hearthlight-remote-access")) {
  customElements.define("hearthlight-remote-access", HearthLightRemoteAccessCard);
}
if (!customElements.get("hearthlight-remote-access-editor")) {
  customElements.define(
    "hearthlight-remote-access-editor",
    HearthLightRemoteAccessEditor,
  );
}

window.customCards.push({
  type: "hearthlight-remote-access",
  name: "HearthLight Remote Access",
  description: "Time-boxed remote access toggle for a managed user",
  preview: false,
  documentationURL: "https://github.com/mjg913/HearthLight-HASS-Integration",
});

/**
 * The HearthLight dashboard — navbar, contact card, and dashboard strategy.
 *
 * The integration auto-creates a storage dashboard whose entire config is
 * `strategy: {type: custom:hearthlight}`; the strategy below builds the
 * actual Home / Spaces / System / Support layout client-side on every load,
 * so new areas and devices appear without any stored config. Anything
 * labeled `hearthlight-exclude` (area, device, or entity — matched by
 * label id, i.e. the slugified name) is left out, as are registry-hidden
 * entities.
 */

const HL_DASHBOARD_PATH = "hearthlight-home";
const HL_VIEWS = [
  { path: "home", label: "Home", icon: "mdi:home" },
  { path: "spaces", label: "Spaces", icon: "mdi:sofa" },
  { path: "system", label: "System", icon: "mdi:cog-outline" },
  { path: "support", label: "Support", icon: "mdi:lifebuoy" },
];
const EXCLUDE_LABEL = "hearthlight-exclude";
const CONTACT_PHONE_DISPLAY = "(720) 386-1311";
const CONTACT_PHONE_TEL = "+17203861311";
const CONTACT_EMAIL = "support@hearthlightintegration.com";
// Diagnostic sensor published by the integration (options → "Home address");
// the email card puts its state in the support-request subject line.
const HOME_ADDRESS_ENTITY = "sensor.hearthlight_home_address";

function navigatePath(path) {
  history.pushState(null, "", path);
  window.dispatchEvent(new CustomEvent("location-changed"));
}

function hearthlightSwitchIds(hass) {
  return Object.keys(hass?.entities ?? {}).filter(
    (id) =>
      id.startsWith("switch.") && hass.entities[id].platform === "hearthlight",
  );
}

const isMobileDevice = () =>
  navigator.userAgentData?.mobile ??
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

/**
 * hearthlight-navbar — fixed bottom navigation for the HearthLight
 * dashboard, injected into every view by the strategy. Also owns the
 * floating "support access active" pill: a fixed top-center chip shown on
 * every page while any HearthLight remote-access switch is on (the full
 * card lives only on the Support view). Tapping the pill opens Support.
 */
class HearthLightNavbar extends HTMLElement {
  setConfig(config) {
    this._config = config ?? {};
    this._dashboard = this._config.dashboard ?? HL_DASHBOARD_PATH;
    this._built = false;
    this._render();
  }

  set hass(hass) {
    const old = this._hass;
    this._hass = hass;
    if (!this._built) return;
    const ids = hearthlightSwitchIds(hass);
    if (!old || ids.some((id) => old.states[id] !== hass.states[id])) {
      this._updatePill();
    }
  }

  connectedCallback() {
    this._onLocationChanged = this._onLocationChanged ?? (() => this._updateActive());
    window.addEventListener("location-changed", this._onLocationChanged);
    window.addEventListener("popstate", this._onLocationChanged);
    if (this._config) this._render();
  }

  disconnectedCallback() {
    window.removeEventListener("location-changed", this._onLocationChanged);
    window.removeEventListener("popstate", this._onLocationChanged);
    this._stopPillTimer();
  }

  getCardSize() {
    return 2;
  }

  static getStubConfig() {
    return {};
  }

  _render() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    if (!this._built) this._build();
    this._updateActive();
    if (this._hass) this._updatePill();
  }

  _build() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        .spacer { height: calc(72px + env(safe-area-inset-bottom)); }
        nav {
          position: fixed; left: 0; right: 0; bottom: 0; z-index: 4;
          display: flex; justify-content: space-around; align-items: stretch;
          padding-bottom: env(safe-area-inset-bottom);
          background: var(--card-background-color, #fff);
          border-top: 1px solid var(--divider-color);
          box-shadow: 0 -2px 12px rgba(0, 0, 0, 0.08);
        }
        nav button {
          flex: 1; max-width: 168px; padding: 10px 0 12px;
          display: flex; flex-direction: column; align-items: center; gap: 2px;
          background: none; border: none; cursor: pointer;
          color: var(--secondary-text-color); font: inherit;
          font-size: 0.72em; font-weight: 500; letter-spacing: 0.02em;
        }
        nav button ha-icon { --mdc-icon-size: 24px; }
        nav button.active { color: var(--primary-color, ${BRAND_EMBER}); }
        /* Floating support-access pill: top center, above content but below
           dialogs; only the pill itself accepts pointer events. */
        .pill {
          position: fixed; top: calc(var(--header-height, 56px) + 12px);
          left: 50%; transform: translateX(-50%); z-index: 6;
          display: none; align-items: center; gap: 8px;
          padding: 8px 16px; border: none; border-radius: 999px;
          background: ${BRAND_EMBER}; color: #fff; cursor: pointer;
          font: inherit; font-size: 0.85em; font-weight: 600;
          white-space: nowrap; max-width: calc(100vw - 32px); overflow: hidden;
          box-shadow: 0 4px 16px rgba(252, 113, 20, 0.45);
        }
        .pill.shown { display: flex; }
        .pill ha-icon { --mdc-icon-size: 18px; }
        .dot {
          width: 8px; height: 8px; border-radius: 50%; background: #fff;
          flex: none; animation: hl-pulse 1.6s ease-in-out infinite;
        }
        @keyframes hl-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.35; transform: scale(0.8); }
        }
        @media (prefers-reduced-motion: reduce) { .dot { animation: none; } }
      </style>
      <button class="pill" aria-label="Support access is active — open the Support page">
        <span class="dot"></span>
        <ha-icon icon="mdi:headset"></ha-icon>
        <span class="pill-text"></span>
      </button>
      <div class="spacer"></div>
      <nav></nav>`;
    const nav = this.shadowRoot.querySelector("nav");
    for (const item of HL_VIEWS) {
      const btn = document.createElement("button");
      btn.dataset.path = item.path;
      const icon = document.createElement("ha-icon");
      icon.setAttribute("icon", item.icon);
      const label = document.createElement("span");
      label.textContent = item.label;
      btn.append(icon, label);
      btn.addEventListener("click", () =>
        navigatePath(`/${this._dashboard}/${item.path}`),
      );
      nav.append(btn);
    }
    this._pill = this.shadowRoot.querySelector(".pill");
    this._pillText = this.shadowRoot.querySelector(".pill-text");
    this._pill.addEventListener("click", () =>
      navigatePath(`/${this._dashboard}/support`),
    );
    this._built = true;
  }

  _updateActive() {
    if (!this._built) return;
    const [, dash, view] = window.location.pathname.split("/");
    const active = dash === this._dashboard ? view || HL_VIEWS[0].path : null;
    for (const btn of this.shadowRoot.querySelectorAll("nav button")) {
      btn.classList.toggle("active", btn.dataset.path === active);
    }
  }

  _updatePill() {
    const hass = this._hass;
    const active = hearthlightSwitchIds(hass).filter(
      (id) => hass.states[id]?.state === "on",
    );
    this._activeCount = active.length;
    if (!active.length) {
      this._pill.classList.remove("shown");
      this._pillExpires = null;
      this._stopPillTimer();
      return;
    }
    const expiries = active
      .map((id) => new Date(hass.states[id].attributes.expires_at ?? NaN).getTime())
      .filter((t) => !Number.isNaN(t));
    this._pillExpires = expiries.length ? Math.max(...expiries) : null;
    this._pill.classList.add("shown");
    this._tickPill();
    if (this._pillExpires && !this._pillTimer) {
      this._pillTimer = setInterval(() => this._tickPill(), 1000);
    } else if (!this._pillExpires) {
      this._stopPillTimer();
    }
  }

  _tickPill() {
    let text = "Support access active";
    if (this._pillExpires) {
      const remaining = this._pillExpires - Date.now();
      text =
        remaining > 0
          ? `Support access · ${formatRemaining(remaining)}`
          : "Support access is ending…";
    }
    if (this._activeCount > 1) text += ` · ${this._activeCount} users`;
    this._pillText.textContent = text;
  }

  _stopPillTimer() {
    if (this._pillTimer) {
      clearInterval(this._pillTimer);
      this._pillTimer = null;
    }
  }
}

/**
 * hearthlight-contact — one support contact method per card, chosen with
 * `mode: phone | email`. Mobile devices open tel:/mailto: (the email
 * subject carries the install's home address); elsewhere a tap copies the
 * value and the value text fades to a brief green "Copied!". Never toasts.
 */
const CONTACT_MODES = {
  phone: {
    icon: "mdi:phone",
    name: "Call Support",
    detail: CONTACT_PHONE_DISPLAY,
    accent: "#0d9488",
    accentRgb: "13, 148, 136",
  },
  email: {
    icon: "mdi:email",
    name: "Email Support",
    detail: CONTACT_EMAIL,
    accent: "#5c6bc0",
    accentRgb: "92, 107, 192",
  },
};

class HearthLightContactCard extends HTMLElement {
  setConfig(config) {
    if (!CONTACT_MODES[config?.mode]) {
      throw new Error('hearthlight-contact: set mode to "phone" or "email"');
    }
    this._config = config;
    this._built = false;
    this._render();
  }

  set hass(hass) {
    this._hass = hass; // only read at tap time (email subject)
  }

  connectedCallback() {
    if (this._config) this._render();
  }

  disconnectedCallback() {
    clearTimeout(this._revertTimer);
    clearTimeout(this._fadeTimer);
  }

  getCardSize() {
    return 1;
  }

  static getConfigElement() {
    return document.createElement("hearthlight-contact-editor");
  }

  static getStubConfig() {
    return { mode: "phone" };
  }

  _render() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    if (this._built) return;
    const spec = CONTACT_MODES[this._config.mode];
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; height: 100%; }
        ha-card {
          position: relative; height: 100%; box-sizing: border-box;
          padding: 12px; -webkit-tap-highlight-color: transparent;
          --ha-ripple-color: ${spec.accent};
          --ha-ripple-hover-opacity: 0.04;
          --ha-ripple-pressed-opacity: 0.12;
        }
        /* Interactive layer copied from ha-tile-container: the ripple must
           live in an absolutely-positioned box clipped to the card radius,
           or its hover overlay paints past the rounded corners. */
        .background {
          position: absolute; top: 0; left: 0; bottom: 0; right: 0;
          border-radius: var(--ha-card-border-radius, var(--ha-border-radius-lg));
          overflow: hidden; cursor: pointer;
        }
        .background:focus-visible {
          outline: 2px solid ${spec.accent}; outline-offset: -2px;
        }
        .row {
          position: relative; pointer-events: none;
          display: flex; align-items: center; gap: 12px;
        }
        .chip {
          width: 42px; height: 42px; border-radius: 50%; flex: none;
          display: flex; align-items: center; justify-content: center;
          background: rgba(${spec.accentRgb}, 0.2); color: ${spec.accent};
          transition: background 180ms ease, color 180ms ease;
        }
        .chip ha-icon {
          --mdc-icon-size: 21px;
          transition: opacity 180ms ease;
        }
        .titles { flex: 1; min-width: 0; }
        .name {
          display: block; font-size: 14px; font-weight: 700;
          color: var(--primary-text-color);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .detail {
          display: block; margin-top: 2px; font-size: 12px; font-weight: 400;
          color: var(--secondary-text-color);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          transition: opacity 180ms ease, color 180ms ease;
        }
        .copied .chip {
          background: rgba(var(--rgb-success-color, 31, 157, 99), 0.2);
          color: var(--success-color, #1f9d63);
        }
        .copied .detail { color: var(--success-color, #1f9d63); }
        .failed .detail { color: var(--error-color, #b3261e); }
      </style>
      <ha-card>
        <div class="background" role="button" tabindex="0" aria-labelledby="info">
          <ha-ripple></ha-ripple>
        </div>
        <div class="row">
          <span class="chip"><ha-icon></ha-icon></span>
          <span class="titles" id="info">
            <span class="name"></span>
            <span class="detail"></span>
          </span>
        </div>
      </ha-card>`;
    this._row = this.shadowRoot.querySelector(".row");
    this._icon = this.shadowRoot.querySelector("ha-icon");
    this._detail = this.shadowRoot.querySelector(".detail");
    this._icon.setAttribute("icon", spec.icon);
    this.shadowRoot.querySelector(".name").textContent = spec.name;
    this._detail.textContent = spec.detail;
    const background = this.shadowRoot.querySelector(".background");
    background.addEventListener("click", () => this._activate(spec));
    background.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        this._activate(spec);
      }
    });
    this._built = true;
  }

  _activate(spec) {
    if (isMobileDevice()) {
      const url =
        this._config.mode === "phone"
          ? `tel:${CONTACT_PHONE_TEL}`
          : `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(this._emailSubject())}`;
      this._openLink(url);
      return;
    }
    this._copy(spec.detail)
      .then(() => this._flash(spec, "copied", "Copied!"))
      .catch(() => this._flash(spec, "failed", "Couldn't copy"));
  }

  _emailSubject() {
    const state = this._hass?.states?.[HOME_ADDRESS_ENTITY]?.state;
    const address =
      state && state !== "unknown" && state !== "unavailable" ? state : "";
    return address ? `Support Request – ${address}` : "Support Request";
  }

  /**
   * Open tel:/mailto: the way HA's own url action does (window.open).
   * Mobile webviews intercept window.open and hand these schemes to the
   * OS, but ignore location.href writes and synthetic anchor clicks.
   */
  _openLink(url) {
    const win = window.open(url);
    if (!win) window.location.assign(url);
  }

  async _copy(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch {
        /* denied: fall through to execCommand */
      }
    }
    // The async Clipboard API does not exist in insecure contexts
    // (plain-http LAN access); the deprecated execCommand path still does.
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    this.shadowRoot.append(area);
    area.focus();
    area.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } finally {
      area.remove();
    }
    if (!copied) throw new Error("copy rejected");
  }

  _flash(spec, cls, message) {
    clearTimeout(this._revertTimer);
    clearTimeout(this._fadeTimer);
    this._swapDetail(() => {
      this._row.classList.add(cls);
      this._detail.textContent = message;
      if (cls === "copied") this._icon.setAttribute("icon", "mdi:check");
    });
    this._revertTimer = setTimeout(() => {
      this._swapDetail(() => {
        this._row.classList.remove("copied", "failed");
        this._detail.textContent = spec.detail;
        this._icon.setAttribute("icon", spec.icon);
      });
    }, 1600);
  }

  /** Fade the detail line and icon out, apply the change, fade back in. */
  _swapDetail(apply) {
    this._detail.style.opacity = "0";
    this._icon.style.opacity = "0";
    this._fadeTimer = setTimeout(() => {
      apply();
      this._detail.style.opacity = "1";
      this._icon.style.opacity = "1";
    }, 180);
  }
}

/** Visual editor for hearthlight-contact. */
class HearthLightContactEditor extends HTMLElement {
  setConfig(config) {
    this._config = config ?? {};
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
  }

  _labels = {
    mode: "Contact method",
  };

  _schema = [
    {
      name: "mode",
      required: true,
      selector: {
        select: {
          mode: "dropdown",
          options: [
            { value: "phone", label: "Phone" },
            { value: "email", label: "Email" },
          ],
        },
      },
    },
  ];

  _render() {
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) => this._labels[s.name] ?? s.name;
      this._form.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        this._onValueChanged(ev.detail.value);
      });
      this.append(this._form);
    }
    this._form.hass = this._hass;
    this._form.data = { mode: this._config.mode ?? "phone" };
    this._form.schema = this._schema;
  }

  _onValueChanged(value) {
    this._config = { ...this._config, mode: value.mode ?? "phone" };
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: this._config },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

if (!customElements.get("hearthlight-navbar")) {
  customElements.define("hearthlight-navbar", HearthLightNavbar);
}
if (!customElements.get("hearthlight-contact")) {
  customElements.define("hearthlight-contact", HearthLightContactCard);
}
if (!customElements.get("hearthlight-contact-editor")) {
  customElements.define("hearthlight-contact-editor", HearthLightContactEditor);
}

window.customCards.push(
  {
    type: "hearthlight-navbar",
    name: "HearthLight Navbar",
    description: "Bottom navigation bar used by the HearthLight dashboard",
    preview: false,
    documentationURL: "https://github.com/mjg913/HearthLight-HASS-Integration",
  },
  {
    type: "hearthlight-contact",
    name: "HearthLight Contact",
    description: "Call or email HearthLight support",
    preview: true,
    documentationURL: "https://github.com/mjg913/HearthLight-HASS-Integration",
  },
);

/**
 * The dashboard strategy. Builds the four views from the registry each
 * time the dashboard loads; on HA 2026+ registryDependencies triggers a
 * live rebuild when areas/devices/entities change (older frontends
 * rebuild on the next load).
 */

const SPACES_DOMAIN_ORDER = [
  "light",
  "switch",
  "cover",
  "climate",
  "fan",
  "humidifier",
  "media_player",
  "lock",
  "alarm_control_panel",
];
const SPACES_TILE_FEATURES = {
  light: [{ type: "light-brightness" }],
  cover: [{ type: "cover-open-close" }],
  climate: [{ type: "target-temperature" }],
};
const SPACES_SENSOR_CLASSES = ["temperature", "humidity"];
const SPACES_BINARY_CLASSES = [
  "door",
  "window",
  "garage_door",
  "opening",
  "motion",
  "occupancy",
];
const OPENING_CLASSES = ["door", "window", "garage_door", "opening", "lock"];

function buildDashboardModel(hass) {
  const excludedAreas = new Set(
    Object.values(hass.areas ?? {})
      .filter((area) => area.labels?.includes(EXCLUDE_LABEL))
      .map((area) => area.area_id),
  );
  const excludedDevices = new Set(
    Object.values(hass.devices ?? {})
      .filter((device) => device.labels?.includes(EXCLUDE_LABEL))
      .map((device) => device.id),
  );
  const flat = [];
  const byArea = new Map();
  for (const [id, entry] of Object.entries(hass.entities ?? {})) {
    if (!hass.states[id]) continue; // disabled or not yet provided
    if (entry.hidden) continue;
    if (entry.platform === "hearthlight") continue; // Support view only
    if (entry.labels?.includes(EXCLUDE_LABEL)) continue;
    if (entry.device_id && excludedDevices.has(entry.device_id)) continue;
    const areaId =
      entry.area_id ??
      (entry.device_id ? hass.devices[entry.device_id]?.area_id : null) ??
      null;
    if (areaId && excludedAreas.has(areaId)) continue;
    flat.push({ id, areaId, category: entry.entity_category ?? null });
    if (!entry.entity_category) {
      if (!byArea.has(areaId)) byArea.set(areaId, []);
      byArea.get(areaId).push(id);
    }
  }
  return { flat, byArea };
}

function hlView(title, path, icon, sections) {
  return { title, path, icon, type: "sections", max_columns: 4, sections };
}

function navbarSection() {
  return {
    type: "grid",
    column_span: 4,
    cards: [{ type: "custom:hearthlight-navbar" }],
  };
}

function sortByFriendlyName(ids, hass) {
  const name = (id) => hass.states[id]?.attributes?.friendly_name ?? id;
  return [...ids].sort((a, b) => name(a).localeCompare(name(b)));
}

function buildAreaCards(ids, hass) {
  const cards = [];
  const domainOf = (id) => id.split(".")[0];
  const deviceClass = (id) => hass.states[id]?.attributes?.device_class;
  for (const domain of SPACES_DOMAIN_ORDER) {
    for (const id of sortByFriendlyName(
      ids.filter((id) => domainOf(id) === domain),
      hass,
    )) {
      const card = { type: "tile", entity: id };
      if (SPACES_TILE_FEATURES[domain]) {
        card.features = SPACES_TILE_FEATURES[domain];
      }
      cards.push(card);
    }
  }
  for (const id of sortByFriendlyName(
    ids.filter(
      (id) =>
        domainOf(id) === "sensor" &&
        SPACES_SENSOR_CLASSES.includes(deviceClass(id)),
    ),
    hass,
  )) {
    cards.push({ type: "tile", entity: id });
  }
  for (const id of sortByFriendlyName(
    ids.filter(
      (id) =>
        domainOf(id) === "binary_sensor" &&
        SPACES_BINARY_CLASSES.includes(deviceClass(id)),
    ),
    hass,
  )) {
    cards.push({ type: "tile", entity: id });
  }
  return cards;
}

function buildHomeView(model, hass) {
  const sections = [];
  sections.push({
    type: "grid",
    column_span: 4,
    cards: [
      {
        type: "custom:hearthlight-brand",
        asset: "combination-mark-2",
        plain: true,
        height: "56px",
        alignment: "start",
      },
    ],
  });

  const primary = model.flat.filter((e) => !e.category).map((e) => e.id);

  const weatherId = primary.find((id) => id.startsWith("weather."));
  if (weatherId) {
    sections.push({
      type: "grid",
      cards: [
        {
          type: "weather-forecast",
          entity: weatherId,
          forecast_type: "daily",
          grid_options: { columns: "full" },
        },
      ],
    });
  }

  const onNowIds = primary.filter(
    (id) => id.startsWith("light.") || id.startsWith("switch."),
  );
  const openIds = primary.filter(
    (id) =>
      id.startsWith("binary_sensor.") &&
      OPENING_CLASSES.includes(hass.states[id]?.attributes?.device_class),
  );
  const lockIds = primary.filter((id) => id.startsWith("lock."));
  const glanceCards = [];
  if (onNowIds.length) {
    glanceCards.push({
      type: "entity-filter",
      entities: onNowIds,
      state_filter: ["on"],
      card: { type: "glance", title: "On now" },
    });
  }
  if (openIds.length) {
    glanceCards.push({
      type: "entity-filter",
      entities: openIds,
      state_filter: ["on"],
      card: { type: "glance", title: "Open now" },
    });
  }
  if (lockIds.length) {
    glanceCards.push({
      type: "entity-filter",
      entities: lockIds,
      state_filter: ["unlocked", "open", "opening", "jammed"],
      card: { type: "glance", title: "Unlocked" },
    });
  }
  if (glanceCards.length) {
    sections.push({
      type: "grid",
      cards: [
        { type: "heading", heading: "At a glance", icon: "mdi:eye-outline" },
        ...glanceCards.map((card) => ({
          ...card,
          grid_options: { columns: "full" },
        })),
      ],
    });
  }

  const favoriteAreas = [...model.byArea.entries()]
    .filter(([areaId]) => areaId)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 4)
    .map(([areaId]) => areaId);
  if (favoriteAreas.length) {
    sections.push({
      type: "grid",
      column_span: 2,
      cards: [
        { type: "heading", heading: "Spaces", icon: "mdi:sofa" },
        ...favoriteAreas.map((areaId) => ({
          type: "area",
          area: areaId,
          navigation_path: `/${HL_DASHBOARD_PATH}/spaces`,
          grid_options: { columns: 6 },
        })),
      ],
    });
  }

  sections.push(navbarSection());
  return hlView("Home", "home", "mdi:home", sections);
}

function buildSpacesView(model, hass) {
  const sections = [];
  const areaIds = [...model.byArea.keys()]
    .filter((areaId) => areaId)
    .sort((a, b) => {
      const floorA = hass.areas[a]?.floor_id ?? "￿";
      const floorB = hass.areas[b]?.floor_id ?? "￿";
      if (floorA !== floorB) return floorA.localeCompare(floorB);
      const nameA = hass.areas[a]?.name ?? a;
      return nameA.localeCompare(hass.areas[b]?.name ?? b);
    });
  for (const areaId of areaIds) {
    const cards = buildAreaCards(model.byArea.get(areaId), hass);
    if (!cards.length) continue;
    const area = hass.areas[areaId];
    const heading = {
      type: "heading",
      heading: area?.name ?? "Area",
      heading_style: "title",
    };
    if (area?.icon) heading.icon = area.icon;
    sections.push({ type: "grid", cards: [heading, ...cards] });
  }
  const other = buildAreaCards(model.byArea.get(null) ?? [], hass);
  if (other.length) {
    sections.push({
      type: "grid",
      cards: [
        { type: "heading", heading: "Other", heading_style: "title" },
        ...other,
      ],
    });
  }
  sections.push(navbarSection());
  return hlView("Spaces", "spaces", "mdi:sofa", sections);
}

function buildSystemView(model, hass) {
  const sections = [];
  const all = model.flat.map((e) => e.id);

  const updateIds = all.filter((id) => id.startsWith("update."));
  if (updateIds.length) {
    sections.push({
      type: "grid",
      cards: [
        { type: "heading", heading: "Updates", icon: "mdi:update" },
        {
          type: "entity-filter",
          entities: updateIds,
          state_filter: ["on"],
          card: { type: "entities", title: "Updates available" },
          grid_options: { columns: "full" },
        },
      ],
    });
  }

  const batteryIds = all.filter(
    (id) =>
      id.startsWith("sensor.") &&
      hass.states[id]?.attributes?.device_class === "battery",
  );
  if (batteryIds.length) {
    const cards = [
      { type: "heading", heading: "Batteries", icon: "mdi:battery-alert" },
      {
        type: "entity-filter",
        entities: batteryIds,
        conditions: [{ condition: "numeric_state", below: 20 }],
        card: { type: "entities", title: "Low batteries" },
        grid_options: { columns: "full" },
      },
    ];
    if (batteryIds.length <= 12) {
      cards.push({
        type: "glance",
        title: "All batteries",
        entities: sortByFriendlyName(batteryIds, hass),
        grid_options: { columns: "full" },
      });
    }
    sections.push({ type: "grid", cards });
  }

  const healthIds = all.filter((id) => {
    const deviceClass = hass.states[id]?.attributes?.device_class;
    return (
      hass.entities[id]?.platform === "systemmonitor" ||
      deviceClass === "connectivity" ||
      deviceClass === "signal_strength"
    );
  });
  if (healthIds.length) {
    sections.push({
      type: "grid",
      cards: [
        { type: "heading", heading: "System health", icon: "mdi:heart-pulse" },
        ...sortByFriendlyName(healthIds, hass)
          .slice(0, 12)
          .map((id) => ({ type: "tile", entity: id })),
      ],
    });
  }

  sections.push(navbarSection());
  return hlView("System", "system", "mdi:cog-outline", sections);
}

function buildSupportView(model, hass) {
  const sections = [];
  sections.push({
    type: "grid",
    column_span: 4,
    cards: [
      {
        type: "custom:hearthlight-brand",
        asset: "wordmark-2",
        plain: true,
        height: "110px",
      },
    ],
  });

  const switches = hearthlightSwitchIds(hass).sort((a, b) => {
    const rank = (id) => (id.includes("support") ? 0 : 1);
    return rank(a) - rank(b) || a.localeCompare(b);
  });
  if (switches.length) {
    sections.push({
      type: "grid",
      column_span: 2,
      cards: [
        { type: "heading", heading: "Remote access", icon: "mdi:headset" },
        ...switches.map((id) => ({
          type: "custom:hearthlight-remote-access",
          entity: id,
          grid_options: { columns: "full" },
        })),
      ],
    });
  }

  sections.push({
    type: "grid",
    column_span: 2,
    cards: [
      { type: "heading", heading: "Self service", icon: "mdi:tools" },
      {
        type: "button",
        name: "Quick Fix",
        icon: "mdi:auto-fix",
        tap_action: {
          action: "perform-action",
          perform_action: "homeassistant.reload_all",
          confirmation: {
            text: "Apply a quick fix? This reloads the configuration — nothing turns off and nothing is interrupted.",
          },
        },
        grid_options: { columns: 6, rows: 2 },
      },
      {
        type: "button",
        name: "Reboot System",
        icon: "mdi:restart",
        tap_action: {
          action: "perform-action",
          perform_action: "homeassistant.restart",
          confirmation: {
            text: "Reboot the system? The dashboard will be unavailable for a few minutes; your devices keep working.",
          },
        },
        grid_options: { columns: 6, rows: 2 },
      },
      {
        type: "markdown",
        text_only: true,
        content: "Clears most glitches without interrupting your home.",
        grid_options: { columns: 6 },
      },
      {
        type: "markdown",
        text_only: true,
        content: "A full restart — try Quick Fix first.",
        grid_options: { columns: 6 },
      },
    ],
  });

  sections.push({
    type: "grid",
    column_span: 2,
    cards: [
      {
        type: "heading",
        heading: "Contact Us",
        heading_style: "title",
        icon: "mdi:account-box",
      },
      {
        type: "custom:hearthlight-contact",
        mode: "phone",
        grid_options: { columns: "full" },
      },
      {
        type: "custom:hearthlight-contact",
        mode: "email",
        grid_options: { columns: "full" },
      },
    ],
  });

  sections.push(navbarSection());
  return hlView("Support", "support", "mdi:lifebuoy", sections);
}

class HearthLightDashboardStrategy {
  // HA 2026+: rebuild live when the registries change; ignored before that.
  static registryDependencies = ["entities", "devices", "areas"];

  static async generate(config, hass) {
    const model = buildDashboardModel(hass);
    return {
      views: [
        buildHomeView(model, hass),
        buildSpacesView(model, hass),
        buildSystemView(model, hass),
        buildSupportView(model, hass),
      ],
    };
  }
}

if (!customElements.get("ll-strategy-dashboard-hearthlight")) {
  customElements.define(
    "ll-strategy-dashboard-hearthlight",
    HearthLightDashboardStrategy,
  );
}

// HA 2026.5+ lists registered strategies in the new-dashboard dialog;
// on older frontends this array is simply never read.
window.customStrategies = window.customStrategies || [];
window.customStrategies.push({
  type: "hearthlight",
  strategyType: "dashboard",
  name: "HearthLight",
  description:
    "Branded HearthLight dashboard with Home, Spaces, System, and Support views",
  documentationURL: "https://github.com/mjg913/HearthLight-HASS-Integration",
});
