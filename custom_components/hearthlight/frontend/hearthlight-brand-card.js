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
    return 2;
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
    const alignment = config.alignment ?? "center";

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card {
          display: flex;
          justify-content: ${alignment === "start" || alignment === "end" ? `flex-${alignment}` : "center"};
          align-items: center;
          padding: 16px;
        }
        svg { height: ${height}; width: auto; max-width: 100%; display: block; }
        .cls-1 { fill: ${slate}; }
        .cls-2 { fill: ${ember}; }
      </style>
      <ha-card></ha-card>`;
    this.shadowRoot.querySelector("ha-card").append(svg);
  }
}

if (!customElements.get("hearthlight-brand")) {
  customElements.define("hearthlight-brand", HearthLightBrandCard);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "hearthlight-brand",
  name: "HearthLight Brand",
  description: "Theme-adaptive HearthLight brand mark",
  preview: true,
  documentationURL: "https://github.com/mjg913/HearthLight-HASS-Integration",
});
