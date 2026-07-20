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
