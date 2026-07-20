# HearthLight for Home Assistant

The HearthLight design system as a Home Assistant integration: a warm, ember-and-slate theme plus theme-adaptive brand marks for your dashboards — installed, updated, and kept as your default automatically.

- **Theme** — Ember Orange `#fc7114` + Slate `#253540` with warm Sand light surfaces, automatic light/dark via `modes`, device-native system fonts.
- **Default-theme management** — HearthLight is re-applied as the backend default (light + dark) on every Home Assistant start. No startup automation needed.
- **Dashboard** — a ready-made HearthLight dashboard (Home, Spaces, System, Support) is created automatically and rebuilds itself from your areas and devices on every load.
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

## Dashboard

The integration creates a ready-made **HearthLight** dashboard in the sidebar on setup (toggleable in options). Its entire stored config is one line — a pointer at the bundled `custom:hearthlight` strategy — so the layout is rebuilt from your areas, devices, and entities every time it loads, and improves with each release:

- **Home** — brand header, weather, at-a-glance summaries (what's on, what's open or unlocked), and your busiest spaces.
- **Spaces** — a section per area with tile cards grouped by kind: lights, switches, covers, climate, media, locks, temperature/humidity, openings and motion.
- **System** — pending updates, low batteries, and system-health entities.
- **Support** — HearthLight branding, the remote-access card(s), self-service actions (**Quick Fix** reloads all YAML configuration, **Reboot System** restarts Home Assistant — both are admin-only services), and call/email contact options (on devices that can't place calls, they copy the value to the clipboard).

Navigation is a fixed bottom navbar (`custom:hearthlight-navbar`, injected into every view). While a remote-access window is active, a floating pill at the top center of every page shows a live countdown; tapping it opens the Support view.

### Hiding things from the dashboard

Create a label named exactly `hearthlight-exclude` (Settings → Areas, labels & zones → Labels) and apply it to any **area, device, or entity** to leave it out. Entities hidden in the registry are excluded automatically. Matching is by the label's id — the slug of its name at creation — so create it with that exact name rather than renaming another label.

### Customizing or opting out

The dashboard is only created when `/hearthlight-home` doesn't already exist, and its config is **never overwritten**. To customize the layout, take control in the dashboard's raw configuration editor (replace the strategy with concrete views) — HearthLight then leaves it alone forever, including on integration removal. A pristine, still-strategy dashboard is deleted when the integration is removed.

If automatic creation fails, a Repair issue appears; create the dashboard manually via Settings → Dashboards → **Add dashboard**, then set its raw configuration to:

```yaml
strategy:
  type: custom:hearthlight
```

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

### Support user

Turn on **Provision the HearthLight Support user** in the integration options and the integration creates and owns a `HearthLight Support` admin account end to end — no manual user setup, no stored passwords:

- The account is created **locked**: local-only login and a random password nobody knows.
- Turning its remote-access switch on generates a fresh one-session password (`####-####-####`) and displays it on the card — the customer reads it to the support technician. Nothing is stored anywhere, on the box or off it.
- When the window closes (toggle off, timer, or external revoke), the password is rotated to a random throwaway and all of the account's sessions end. Every session starts from a new password.
- If someone deletes the account, the integration recreates it immediately — locked. Deleting it accomplishes nothing except rotating its credentials. It is only removed for real by turning the provisioning option off or deleting the integration.

Caveats:

- The session password is a live state attribute while access is on. It is excluded from the recorder (no history), but anything that consumes **live** states off-box (`mqtt_statestream`, InfluxDB exporters, remote-instance links) will see it during an active window.
- Restarting Home Assistant mid-window generates a **new** password; a previously relayed one stops working.
- The card's Copy button requires HTTPS; on plain-HTTP installs the password is display-only.
- Requires the default `homeassistant` (username/password) auth provider; installs that customize `auth_providers:` without it get a Repair issue and provisioning is skipped.
- Not healed automatically: demoting the account from admin or deactivating it (only deletion is).

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
| Register the card dashboard resource | on | Auto-register `hearthlight-brand-card.js` (all cards + the dashboard strategy) |
| Create the HearthLight dashboard | on | Create the `/hearthlight-home` strategy dashboard if it doesn't exist |
| Remote access: managed users | none | Create remote-access entities for the selected users |
| Provision the HearthLight Support user | off | Create and lifecycle-manage the vendor support account |

### YAML dashboards

With YAML-mode dashboards the resource can't be registered automatically; the card is loaded globally instead and a Repair issue suggests adding it to your Lovelace config:

```yaml
lovelace:
  resources:
    - url: /hearthlight/hearthlight-brand-card.js
      type: module
```

## Removal

Deleting the integration removes the HearthLight dashboard (only if it was never customized), removes the dashboard resource, deletes `themes/hearthlight/`, resets the backend default theme to Home Assistant's default, deletes the provisioned support user (if any), and restores *local only* login (ending active sessions) for every managed user — remote access never outlives the thing that time-boxes it.

## License

[MIT](LICENSE)
