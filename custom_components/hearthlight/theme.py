"""Install and maintain the bundled HearthLight theme."""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from homeassistant.helpers import issue_registry as ir

from .const import (
    DOMAIN,
    ISSUE_THEMES_INCLUDE_MISSING,
    LOGGER,
    THEME_DIR_NAME,
    THEME_FILENAME,
    THEME_NAME,
)

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

BUNDLED_THEME = Path(__file__).parent / "themes" / THEME_FILENAME


def _sync_theme_file(target: Path) -> bool:
    """Write the bundled theme to the config themes dir. Returns True if changed."""
    bundled = BUNDLED_THEME.read_bytes()
    if target.exists() and target.read_bytes() == bundled:
        return False
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(".yaml.tmp")
    tmp.write_bytes(bundled)
    tmp.replace(target)
    return True


async def async_install_theme(hass: HomeAssistant) -> None:
    """Install/refresh the bundled theme and reload themes if it changed."""
    target = Path(hass.config.path("themes")) / THEME_DIR_NAME / THEME_FILENAME
    changed = await hass.async_add_executor_job(_sync_theme_file, target)
    if changed:
        LOGGER.info("Installed bundled theme to %s", target)
        await hass.services.async_call("frontend", "reload_themes", blocking=True)
    _verify_theme_loaded(hass)


def _verify_theme_loaded(hass: HomeAssistant) -> None:
    """
    Best-effort check that the theme is actually loaded by the frontend.

    Uses the frontend's internal theme store; if the shape changes we treat the
    check as passed rather than raising a false alarm.
    """
    try:
        themes = hass.data.get("frontend_themes")
        theme_missing = isinstance(themes, dict) and THEME_NAME not in themes
    except Exception:  # noqa: BLE001 - internal API, never fail setup over this
        return
    if theme_missing:
        LOGGER.warning(
            "Theme %s was installed but is not loaded; is a themes include "
            "configured under 'frontend:' in configuration.yaml?",
            THEME_NAME,
        )
        ir.async_create_issue(
            hass,
            DOMAIN,
            ISSUE_THEMES_INCLUDE_MISSING,
            is_fixable=False,
            severity=ir.IssueSeverity.WARNING,
            translation_key=ISSUE_THEMES_INCLUDE_MISSING,
            learn_more_url="https://github.com/mjg913/HearthLight-HASS-Integration#themes-include",
        )
    else:
        ir.async_delete_issue(hass, DOMAIN, ISSUE_THEMES_INCLUDE_MISSING)


def _remove_theme_files(themes_dir: Path) -> None:
    theme_file = themes_dir / THEME_FILENAME
    theme_file.unlink(missing_ok=True)
    tmp = themes_dir / f"{THEME_FILENAME}.tmp"
    tmp.unlink(missing_ok=True)
    if themes_dir.is_dir() and not any(themes_dir.iterdir()):
        themes_dir.rmdir()


async def async_uninstall_theme(hass: HomeAssistant) -> None:
    """Remove the installed theme file and reload themes (clean removal)."""
    themes_dir = Path(hass.config.path("themes")) / THEME_DIR_NAME
    try:
        await hass.async_add_executor_job(_remove_theme_files, themes_dir)
    except OSError as err:
        LOGGER.warning("Could not remove theme files from %s: %s", themes_dir, err)
        return
    LOGGER.info("Removed installed theme from %s", themes_dir)
    await hass.services.async_call("frontend", "reload_themes", blocking=True)
