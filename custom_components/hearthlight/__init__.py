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
from homeassistant.core import CoreState, callback
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import issue_registry as ir
from homeassistant.loader import async_get_integration

from . import dashboard, resources, support_user, theme
from .const import (
    CONF_CREATE_DASHBOARD,
    CONF_MANAGE_THEME,
    CONF_MANAGED_USERS,
    CONF_PROVISION_SUPPORT_USER,
    CONF_REGISTER_CARD_RESOURCE,
    CONF_SET_DEFAULT_THEME,
    DOMAIN,
    EVENT_USER_REMOVED,
    INSTALL_REGISTRY_KEY,
    ISSUE_NO_HA_AUTH_PROVIDER,
    LOGGER,
    SUPPORT_REGISTRY_KEY,
    SUPPORT_USER_NAME,
    THEME_NAME,
)
from .data import RemoteAccessData

if TYPE_CHECKING:
    from homeassistant.core import Event, HomeAssistant

    from .data import HearthLightConfigEntry

PLATFORMS: list[Platform] = [Platform.NUMBER, Platform.SENSOR, Platform.SWITCH]


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
            registry_key=user_id,
        )
    return data


async def _async_cleanup_stale_users(
    hass: HomeAssistant, entry: HearthLightConfigEntry, active_keys: set[str]
) -> None:
    """
    Drop devices whose registry key is no longer active, failing closed.

    De-selecting a user while their switch is ON would otherwise strand
    local_only=False forever with no entity left to time it out. A stale
    support key means provisioning was toggled off: that deletes the
    account itself (the auth cascade also revokes its tokens).
    """
    device_registry = dr.async_get(hass)
    for device in dr.async_entries_for_config_entry(device_registry, entry.entry_id):
        keys = {ident[1] for ident in device.identifiers if ident[0] == DOMAIN}
        if not keys or keys & active_keys:
            continue
        for key in keys:
            if key == SUPPORT_REGISTRY_KEY:
                await support_user.async_delete_support_user(hass)
            else:
                await _async_force_local_only(hass, key)
        device_registry.async_remove_device(device.id)


async def _async_provision_support_user(
    hass: HomeAssistant, entry: HearthLightConfigEntry
) -> RemoteAccessData | None:
    """Ensure the support user exists; None when skipped (no auth provider)."""
    try:
        support_id = await support_user.async_ensure_support_user(hass)
    except RuntimeError:
        LOGGER.warning(
            "Support-user provisioning skipped: no 'homeassistant' auth provider"
        )
        ir.async_create_issue(
            hass,
            DOMAIN,
            ISSUE_NO_HA_AUTH_PROVIDER,
            is_fixable=False,
            severity=ir.IssueSeverity.WARNING,
            translation_key=ISSUE_NO_HA_AUTH_PROVIDER,
        )
        return None
    ir.async_delete_issue(hass, DOMAIN, ISSUE_NO_HA_AUTH_PROVIDER)
    _async_register_self_heal(hass, entry, support_id)
    return RemoteAccessData(
        user_id=support_id,
        user_name=SUPPORT_USER_NAME,
        registry_key=SUPPORT_REGISTRY_KEY,
        is_support=True,
    )


@callback
def _async_register_self_heal(
    hass: HomeAssistant, entry: HearthLightConfigEntry, support_id: str
) -> None:
    """
    Recreate the support user if it is deleted out from under us.

    Loop safety needs no flags: the integration's own deletions run only in
    async_remove_entry (entry already unloaded, listener gone) or in a setup
    pass with provisioning off (listener never registered).
    """
    healing = False

    async def _on_user_removed(event: Event) -> None:
        nonlocal healing
        if healing or event.data.get("user_id") != support_id:
            return
        if not entry.options.get(CONF_PROVISION_SUPPORT_USER, False):
            return
        healing = True
        LOGGER.warning("HearthLight Support user was deleted; recreating it")
        try:
            # Recreated local-only with a throwaway password: grants nothing.
            await support_user.async_ensure_support_user(hass)
        except RuntimeError:
            LOGGER.warning("Could not recreate: no 'homeassistant' auth provider")
        # Reload rebinds runtime data/entities to the new user id; registry
        # ids stay stable via SUPPORT_REGISTRY_KEY, so no device churn.
        hass.config_entries.async_schedule_reload(entry.entry_id)

    entry.async_on_unload(hass.bus.async_listen(EVENT_USER_REMOVED, _on_user_removed))


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

    # After the card resource: the dashboard's strategy lives in that module.
    if entry.options.get(CONF_CREATE_DASHBOARD, True):
        await dashboard.async_create_dashboard(hass)

    support_data: RemoteAccessData | None = None
    if entry.options.get(CONF_PROVISION_SUPPORT_USER, False):
        support_data = await _async_provision_support_user(hass, entry)
    else:
        ir.async_delete_issue(hass, DOMAIN, ISSUE_NO_HA_AUTH_PROVIDER)

    # The support user is implicitly managed; drop any manual selection of it.
    managed_users: list[str] = [
        user_id
        for user_id in entry.options.get(CONF_MANAGED_USERS, [])
        if support_data is None or user_id != support_data.user_id
    ]
    active_keys = set(managed_users)
    active_keys.add(INSTALL_REGISTRY_KEY)
    if support_data is not None:
        active_keys.add(SUPPORT_REGISTRY_KEY)
    await _async_cleanup_stale_users(hass, entry, active_keys)
    runtime = await _async_build_runtime_data(hass, managed_users)
    if support_data is not None:
        runtime = {SUPPORT_REGISTRY_KEY: support_data, **runtime}
    entry.runtime_data = runtime
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
    """Clean removal: dashboard, resource, theme, default theme, remote access."""
    # Unconditional (not gated on the toggle): a dashboard created while the
    # toggle was on should still go; the pristine-config check is the guard.
    try:
        await dashboard.async_remove_dashboard(hass)
    except Exception as err:  # noqa: BLE001 - best-effort cleanup
        LOGGER.warning("Could not remove the HearthLight dashboard: %s", err)
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
    # Gated on the toggle so a hand-made account that merely uses our
    # reserved username is never deleted by an install that didn't provision.
    if entry.options.get(CONF_PROVISION_SUPPORT_USER, False):
        try:
            await support_user.async_delete_support_user(hass)
        except Exception as err:  # noqa: BLE001 - best-effort cleanup
            LOGGER.warning("Could not delete the support user: %s", err)
    # Uninstalling the safety mechanism must fail closed: revoke remote
    # access for every managed user before the entities disappear.
    for user_id in entry.options.get(CONF_MANAGED_USERS, []):
        try:
            await _async_force_local_only(hass, user_id)
        except Exception as err:  # noqa: BLE001 - best-effort cleanup
            LOGGER.warning("Could not restore local-only for %s: %s", user_id, err)
