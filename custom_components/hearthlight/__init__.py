"""
The HearthLight integration.

Packages the HearthLight theme and brand assets:
- installs/updates the bundled theme and keeps it set as the backend default,
- serves the brand SVGs and the hearthlight-brand card at /hearthlight/*,
- registers the card as a Lovelace dashboard resource.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from homeassistant.const import EVENT_HOMEASSISTANT_STARTED
from homeassistant.core import CoreState
from homeassistant.loader import async_get_integration

from . import resources, theme
from .const import (
    CONF_MANAGE_THEME,
    CONF_REGISTER_CARD_RESOURCE,
    CONF_SET_DEFAULT_THEME,
    LOGGER,
    THEME_NAME,
)

if TYPE_CHECKING:
    from homeassistant.config_entries import ConfigEntry
    from homeassistant.core import Event, HomeAssistant


async def _async_apply_default_theme(hass: HomeAssistant) -> None:
    """
    Set HearthLight as the backend default for both mode slots.

    frontend.set_theme is runtime-only, so this must re-run on every start.
    """
    for mode in ("light", "dark"):
        await hass.services.async_call(
            "frontend",
            "set_theme",
            {"name": THEME_NAME, "mode": mode},
            blocking=True,
        )
    LOGGER.debug("Applied %s as backend default theme (light + dark)", THEME_NAME)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up HearthLight from a config entry."""
    # Register the STARTED listener before any awaits so a fast boot can't
    # slip past it; set_theme is runtime-only and must re-apply every start.
    if entry.options.get(CONF_SET_DEFAULT_THEME, True):

        async def _on_started(_event: Event) -> None:
            await _async_apply_default_theme(hass)

        entry.async_on_unload(
            hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STARTED, _on_started)
        )

    await resources.async_register_static_paths(hass)

    if entry.options.get(CONF_MANAGE_THEME, True):
        await theme.async_install_theme(hass)

    if entry.options.get(CONF_REGISTER_CARD_RESOURCE, True):
        integration = await async_get_integration(hass, entry.domain)
        await resources.async_register_card_resource(hass, str(integration.version))

    # Entry added or reloaded after startup: STARTED already fired.
    if (
        entry.options.get(CONF_SET_DEFAULT_THEME, True)
        and hass.state is CoreState.running
    ):
        await _async_apply_default_theme(hass)

    entry.async_on_unload(entry.add_update_listener(_async_update_listener))
    return True


async def _async_update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Reload the entry when options change."""
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(_hass: HomeAssistant, _entry: ConfigEntry) -> bool:
    """Unload a config entry (listeners are removed via async_on_unload)."""
    return True


async def async_remove_entry(hass: HomeAssistant, _entry: ConfigEntry) -> None:
    """Clean removal: drop the resource, theme file, and default-theme setting."""
    try:
        await resources.async_remove_card_resource(hass)
    except Exception as err:  # noqa: BLE001 - best-effort cleanup
        LOGGER.warning("Could not remove Lovelace resource: %s", err)
    try:
        await theme.async_uninstall_theme(hass)
    except Exception as err:  # noqa: BLE001 - best-effort cleanup
        LOGGER.warning("Could not remove theme: %s", err)
    try:
        for mode in ("light", "dark"):
            await hass.services.async_call(
                "frontend",
                "set_theme",
                {"name": "default", "mode": mode},
                blocking=True,
            )
    except Exception as err:  # noqa: BLE001 - best-effort cleanup
        LOGGER.warning("Could not reset default theme: %s", err)
