"""
The HearthLight integration.

Packages the HearthLight theme, brand assets, and remote-access control:
- installs/updates the bundled theme and keeps it set as the backend default,
- serves the brand SVGs and the HearthLight cards at /hearthlight/*,
- registers the cards as a Lovelace dashboard resource,
- creates time-boxed remote-access switch/number entities per managed user.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from homeassistant.const import EVENT_HOMEASSISTANT_STARTED, Platform
from homeassistant.core import CoreState
from homeassistant.helpers import device_registry as dr
from homeassistant.loader import async_get_integration

from . import resources, theme
from .const import (
    CONF_MANAGE_THEME,
    CONF_MANAGED_USERS,
    CONF_REGISTER_CARD_RESOURCE,
    CONF_SET_DEFAULT_THEME,
    DOMAIN,
    LOGGER,
    THEME_NAME,
)
from .data import RemoteAccessData

if TYPE_CHECKING:
    from homeassistant.core import Event, HomeAssistant

    from .data import HearthLightConfigEntry

PLATFORMS: list[Platform] = [Platform.NUMBER, Platform.SWITCH]


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


async def _async_force_local_only(hass: HomeAssistant, user_id: str) -> None:
    """Restore local-only login for a user and end their active sessions."""
    user = await hass.auth.async_get_user(user_id)
    if user is None or user.local_only:
        return
    await hass.auth.async_update_user(user, local_only=True)
    for token in list(user.refresh_tokens.values()):
        hass.auth.async_remove_refresh_token(token)


async def _async_build_runtime_data(
    hass: HomeAssistant, managed_users: list[str]
) -> dict[str, RemoteAccessData]:
    """Resolve the managed user ids into per-user runtime data."""
    data: dict[str, RemoteAccessData] = {}
    for user_id in managed_users:
        user = await hass.auth.async_get_user(user_id)
        data[user_id] = RemoteAccessData(
            user_id=user_id,
            user_name=(user.name if user else None) or "Unknown user",
        )
    return data


async def _async_cleanup_stale_users(
    hass: HomeAssistant, entry: HearthLightConfigEntry, managed_users: list[str]
) -> None:
    """
    Drop devices for users no longer managed, failing closed first.

    De-selecting a user while their switch is ON would otherwise strand
    local_only=False forever with no entity left to time it out.
    """
    device_registry = dr.async_get(hass)
    for device in dr.async_entries_for_config_entry(device_registry, entry.entry_id):
        ids = {ident[1] for ident in device.identifiers if ident[0] == DOMAIN}
        if not ids or ids & set(managed_users):
            continue
        for user_id in ids:
            await _async_force_local_only(hass, user_id)
        device_registry.async_remove_device(device.id)


async def async_setup_entry(hass: HomeAssistant, entry: HearthLightConfigEntry) -> bool:
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

    managed_users: list[str] = entry.options.get(CONF_MANAGED_USERS, [])
    await _async_cleanup_stale_users(hass, entry, managed_users)
    entry.runtime_data = await _async_build_runtime_data(hass, managed_users)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # Entry added or reloaded after startup: STARTED already fired.
    if (
        entry.options.get(CONF_SET_DEFAULT_THEME, True)
        and hass.state is CoreState.running
    ):
        await _async_apply_default_theme(hass)

    return True


async def async_unload_entry(
    hass: HomeAssistant, entry: HearthLightConfigEntry
) -> bool:
    """Unload the entity platforms (listeners are removed via async_on_unload)."""
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)


async def async_remove_entry(
    hass: HomeAssistant, entry: HearthLightConfigEntry
) -> None:
    """Clean removal: resource, theme, default theme, and remote access."""
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
    # Uninstalling the safety mechanism must fail closed: revoke remote
    # access for every managed user before the entities disappear.
    for user_id in entry.options.get(CONF_MANAGED_USERS, []):
        try:
            await _async_force_local_only(hass, user_id)
        except Exception as err:  # noqa: BLE001 - best-effort cleanup
            LOGGER.warning("Could not restore local-only for %s: %s", user_id, err)
