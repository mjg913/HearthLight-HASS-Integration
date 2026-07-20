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
