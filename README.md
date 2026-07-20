# HearthLight for Home Assistant

The HearthLight design system as a Home Assistant integration: a warm, ember-and-slate theme plus theme-adaptive brand marks for your dashboards — installed, updated, and kept as your default automatically.

- **Theme** — Ember Orange `#fc7114` + Slate `#253540` with warm Sand light surfaces, automatic light/dark via `modes`, device-native system fonts.
- **Default-theme management** — HearthLight is re-applied as the backend default (light + dark) on every Home Assistant start. No startup automation needed.
- **Brand card** — `custom:hearthlight-brand` inlines the HearthLight SVG marks and maps their colors to theme variables, so they adapt to light/dark exactly like text.
- **Remote access control** — `custom:hearthlight-remote-access` plus per-user switch/number entities let the household grant a chosen user (e.g. a support account) remote login for a limited, self-expiring window.
- **Served assets** — all brand SVGs are available under `/hearthlight/brand/` for picture cards, markdown, or anything else.

## Installation (HACS)

1. HACS → three-dots menu → **Custom repositories** → add `mjg913/HearthLight-HASS-Integration` as an **Integration**.
2. Download **HearthLight**, restart Home Assistant.
3. Settings → Devices & Services → **Add integration** → HearthLight.

That's it — the theme is installed to `themes/hearthlight/hearthlight.yaml` and set as the backend default.

### Themes include

Theme loading requires a themes include in `configuration.yaml` (the integration raises a Repair issue if it's missing):

```yaml
frontend:
  themes: !include_dir_merge_named themes
```

> [!IMPORTANT]
> The integration owns `themes/hearthlight/hearthlight.yaml`. Local edits to that file are overwritten on every update — the theme's source of truth is this repository. To hand-manage the theme, turn off **Manage the theme file** in the integration options.

## Brand card

Fully configurable in the visual card editor (search for "HearthLight Brand" in the card picker), or via YAML:

```yaml
type: custom:hearthlight-brand
asset: combination-mark      # combination-mark | combination-mark-2 | wordmark | wordmark-2
color_mode: theme            # theme | brand | mono | custom
height: 96px                 # any CSS length
alignment: center            # start | center | end
plain: false                 # true = bare logo, no card background/padding
```

Set `plain: true` to render just the mark with no card chrome — like the markdown card's `text_only` — for placing the logo inline on a dashboard without a visible card.

| `color_mode` | Wordmark (slate role) | Flame (ember role) |
|---|---|---|
| `theme` (default) | `--primary-text-color` | `--primary-color` |
| `brand` | `--primary-text-color` | always `#fc7114` |
| `mono` | `--primary-text-color` | `--primary-text-color` |
| `custom` | `colors.slate` | `colors.flame` |

`custom` example:

```yaml
type: custom:hearthlight-brand
asset: wordmark-2
color_mode: custom
colors:
  slate: var(--accent-color)
  flame: "#f5a623"
```

## Remote access

Grant a Home Assistant user remote login for a limited time — designed for a vendor "support" account the household controls: they deliberately toggle access on, and it revokes itself.

**Setup:** Settings → Devices & Services → HearthLight → **Configure** → pick users under **Remote access: managed users**. Each managed user gets a device with two entities:

- `switch.<user>_remote_access` — ON clears the user's *local only* login restriction; OFF restores it. Turning off — manually or by the timer — also **ends the user's active sessions immediately** by revoking their refresh tokens (this includes local sessions and long-lived access tokens for that user, so manage dedicated accounts, not daily-driver ones).
- `number.<user>_remote_access_duration` — how long access stays on (5–1440 minutes, default 60). Changes apply the next time access is turned on.

The window survives restarts: if it expires while Home Assistant is down, access is revoked at the next boot. If the *local only* flag is unchecked by hand in the users UI, the integration adopts it immediately and time-boxes it — remote access managed here is never open-ended. Any dashboard user (admin or not) can flip the switch; that's the point — the household authorizes access.

Add the card (search "HearthLight Remote Access" in the card picker), or via YAML:

```yaml
type: custom:hearthlight-remote-access
entity: switch.support_remote_access
name: Support remote access   # optional header override
show_duration: true           # false hides the duration stepper
```

The card shows the toggle, a live countdown while access is on, and a stepper for the duration.

> [!NOTE]
> If you previously wired this up with a pyscript service, `input_boolean`, timer helper, and automation, delete them — the integration replaces the whole stack.

## Static brand assets

Every mark ships in COLOR (light backgrounds), and where available DARK (all-slate) and WHITE (dark backgrounds) variants:

```
/hearthlight/brand/combination-mark-{color,dark,white}.svg
/hearthlight/brand/combination-mark-2-{color,dark}.svg
/hearthlight/brand/wordmark-{color,dark}.svg
/hearthlight/brand/wordmark-2-{color,dark,white}.svg
```

These render with their baked-in colors (no theme adaptation) — use the card for adaptive rendering.

## Options

Settings → Devices & Services → HearthLight → **Configure**:

| Option | Default | Effect |
|---|---|---|
| Manage the theme file | on | Install/overwrite the theme on setup and updates |
| Set HearthLight as the backend default theme | on | Re-apply on every HA start |
| Register the card dashboard resource | on | Auto-register `hearthlight-brand-card.js` (both cards) |
| Remote access: managed users | none | Create remote-access entities for the selected users |

### YAML dashboards

With YAML-mode dashboards the resource can't be registered automatically; the card is loaded globally instead and a Repair issue suggests adding it to your Lovelace config:

```yaml
lovelace:
  resources:
    - url: /hearthlight/hearthlight-brand-card.js
      type: module
```

## Removal

Deleting the integration removes the dashboard resource, deletes `themes/hearthlight/`, resets the backend default theme to Home Assistant's default, and restores *local only* login (ending active sessions) for every managed user — remote access never outlives the thing that time-boxes it.

## License

[MIT](LICENSE)
