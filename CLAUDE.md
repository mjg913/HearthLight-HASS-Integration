# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A HACS-distributed Home Assistant custom integration (domain `hearthlight`) that packages the HearthLight design system and remote-access control: it installs and owns the HearthLight theme, keeps it set as the backend default theme, serves brand SVGs, ships two Lovelace cards (`custom:hearthlight-brand`, `custom:hearthlight-remote-access`), and creates time-boxed remote-access switch/number entities per managed user. No coordinator, no API client — the entities talk directly to `hass.auth`.

## Commands

```bash
scripts/lint          # ruff check --fix + ruff format (CI runs check + format --check)
scripts/develop       # devcontainer only: launches HA with config/ and this component on PYTHONPATH
node --input-type=module --check < custom_components/hearthlight/frontend/hearthlight-brand-card.js  # syntax-check the card
```

There are no tests. CI is `.github/workflows/lint.yml` (ruff) and `validate.yml` (hassfest + HACS validation; `ignore: brands` stays until a logo is submitted to home-assistant/brands — blocked on a standalone flame-icon SVG that does not exist in this repo yet).

## Release & deploy — the only supported path is HACS

The owner's live HA instance must be updated **via HACS releases, never by copying files** (`scripts/deploy-local` exists but is not to be used against the live instance). The loop:

1. Edit code/theme; bump `version` in `custom_components/hearthlight/manifest.json` (kept in lockstep with the git tag).
2. Lint, commit, push; `gh release create vX.Y.Z` — HACS installs the latest **release tag**, not the branch.
3. In HA: HACS update → restart. The integration then re-installs the theme (byte-compare against the installed copy) and rewrites the Lovelace resource URL to `?v=<new version>`, which is the browser cache-buster for the card and its SVG fetches.

Minimum HA is `2025.8.0` (`hacs.json`) — do not introduce APIs newer than that. The options flow uses `OptionsFlowWithReload` (2025.8), so there is no manual update listener in `__init__.py`. Note there is **no `UserSelector`** in any HA version — the managed-users picker is a dynamically built `SelectSelector` over `hass.auth.async_get_users()`.

## Architecture

Everything HA serves at runtime lives **inside `custom_components/hearthlight/`** — HACS copies only that directory. Assets outside it will silently not ship.

Setup flow (`__init__.py`, `async_setup_entry`):
1. Registers the `EVENT_HOMEASSISTANT_STARTED` listener **before any awaits** — `frontend.set_theme` is runtime-only, so the default theme must be re-applied on every boot (this replaced the owner's old startup automation; don't recreate one). If HA is already running (entry added/reloaded live), applies immediately instead.
2. `resources.async_register_static_paths` — serves `brand/` at `/hearthlight/brand` and the card at `/hearthlight/hearthlight-brand-card.js`. Static paths can never be unregistered, so registration is guarded by a `hass.data[DOMAIN]` flag against entry reloads.
3. `theme.async_install_theme` — writes the bundled `themes/hearthlight.yaml` to `<config>/themes/hearthlight/hearthlight.yaml` only when bytes differ, then `frontend.reload_themes`. **This repo is the theme's source of truth**; the installed copy is overwritten by design. It best-effort-verifies the theme actually loaded via the internal `frontend_themes` hass.data key and raises a Repair issue pointing at the missing `frontend: themes:` include.
4. `resources.async_register_card_resource` — registers the card as a Lovelace resource the way HACS does: through the storage collection (`hass.data["lovelace"].resources`), which is **internal API** — the code feature-detects the shape, must `async_load()` the lazily-loaded collection before reading, dedupes by URL-prefix (ignoring `?v=`), and updates the `?v=` on version change. YAML-mode dashboards fall back to `frontend.add_extra_js_url` + a Repair issue.

5. Remote access: `_async_cleanup_stale_users` (fail-closed device removal for de-selected users), builds `entry.runtime_data` (`dict[user_id, RemoteAccessData]`, see `data.py`), then forwards to the `switch` + `number` platforms. Always-on — the default `managed_users: []` just yields zero entities.

The theme/resource behaviors are gated by options-flow toggles (`config_flow.py`), read with `entry.options.get(key, True)`. Single-instance is enforced solely by `single_config_entry` in the manifest — no unique_id logic. `async_remove_entry` does clean removal: deletes the resource entry, deletes the installed theme dir, resets the default theme, and restores `local_only` (revoking sessions) for all managed users.

### Remote access entities (`switch.py`, `number.py`, `data.py`)

Per managed user (picked in the options flow): one device `(DOMAIN, user_id)` holding a `switch` (remote access) and a `number` (window duration, minutes). **The card finds the number by walking the shared device — both entities must keep identical device identifiers** (`data.remote_access_device_info` is the single source).

- Switch ON = `hass.auth.async_update_user(user, local_only=False)` + auto-off via `async_call_later`; the deadline is exposed/persisted as the `expires_at` state attribute (the card's countdown source).
- Switch OFF (manual, timer, de-select, or entry removal) = `local_only=True` **and refresh-token revocation** — `local_only` is only enforced at login/token-grant time, so revoking tokens is what actually ends an in-flight session. This also kills the user's local sessions/long-lived tokens by design.
- Restore/reconcile on add: the real auth flag wins over restored state; an expiry that passed while HA was down revokes at boot (fail closed); an externally-flipped `local_only=False` is adopted and given a fresh timer (never open-ended). Mid-runtime external flips are reconciled live via the `user_updated` bus event; the `EVENT_USER_*` event-type strings are defined in this repo's `const.py` — do NOT import them from core (they live in `homeassistant.auth.__init__`, not `homeassistant.const` or `homeassistant.auth.const`, and that location is not a stable import surface — importing them there broke v0.3.0 at setup). Our own auth writes re-fire `user_updated`, so the handler is deliberately idempotent.
- Reload/unload must NOT revoke: `async_will_remove_from_hass` only cancels the timer; the restored `expires_at` resumes the remainder.
- Duration changes apply to the next activation only (never reschedule a live window).

### The cards (`frontend/hearthlight-brand-card.js`)

Single vanilla-JS file, no build step, one Lovelace resource URL — **new cards go in this same file** (a second file would need new static-path + resource plumbing). Four custom elements: `hearthlight-brand` + editor, and `hearthlight-remote-access` + editor (all `ha-form`-based editors). The remote-access card re-renders in `set hass` (diffed on its watched switch/number state objects), runs a 1 s countdown interval only while a window is active (cleared in `disconnectedCallback`), and derives the duration number from the switch via `hass.entities[...].device_id`. How the brand card's theme adaptation works — and the contract that makes it safe:

- The card always fetches the `-color.svg` variant of an asset and **inlines** it into shadow DOM (an `<img>` would not inherit CSS variables).
- Every `*-color.svg` in `brand/` uses class `.cls-1` = slate `#253540` and `.cls-2` = ember `#fc7114`. The card strips the SVG's embedded `<style>` and injects fills per `color_mode` (`theme`/`brand`/`mono`/`custom`) as `var(...)` values, so light/dark flips are instant with zero JS. **Any new brand SVG must preserve that class-to-role mapping** (the `-dark`/`-white` variants don't follow it; they are served for static use only, never fetched by the card).
- `VERSION` is parsed from the resource URL's `?v=` (`import.meta.url`) and appended to SVG fetches, keeping asset caching in lockstep with releases.
- `plain: true` renders the bare mark without `<ha-card>` chrome (markdown-card `text_only` analogue). The editor intentionally prunes default-valued keys from the emitted config.

### Gotchas

- Ruff config is the strict blueprint one (rule set ALL): D213-style docstrings (summary on second line), no boolean positional args, `Path` over `os` functions, unused HA-signature args need a `_` prefix.
- The owner's HA config is Samba-mounted at `/Volumes/config`; if you must rsync there for any reason, plain `rsync -a` fails — SMB needs `--inplace --no-perms --no-owner --no-group --omit-dir-times`, and stale directory-listing ghosts are a known SMB artifact.
- `config/` is the devcontainer's HA config (its `configuration.yaml` includes the `frontend: themes:` dir to mirror real installs), not the live instance's.
