"""Switch entities that time-box a managed user's remote access."""

from __future__ import annotations

from datetime import timedelta
from typing import TYPE_CHECKING, Any

from homeassistant.auth.const import EVENT_USER_REMOVED, EVENT_USER_UPDATED
from homeassistant.components.switch import SwitchEntity
from homeassistant.core import callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.event import async_call_later
from homeassistant.helpers.restore_state import RestoreEntity
from homeassistant.util import dt as dt_util

from .const import ATTR_EXPIRES_AT, LOGGER
from .data import remote_access_device_info

if TYPE_CHECKING:
    from datetime import datetime

    from homeassistant.auth.models import User
    from homeassistant.core import CALLBACK_TYPE, Event, HomeAssistant
    from homeassistant.helpers.entity_platform import AddEntitiesCallback

    from .data import HearthLightConfigEntry, RemoteAccessData


async def async_setup_entry(
    _hass: HomeAssistant,
    entry: HearthLightConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up a remote-access switch per managed user."""
    async_add_entities(
        HearthLightRemoteAccessSwitch(data) for data in entry.runtime_data.values()
    )


class HearthLightRemoteAccessSwitch(SwitchEntity, RestoreEntity):
    """
    Grants a user remote access, auto-revoking when the window expires.

    ON clears the auth user's local_only flag and starts the auto-off timer;
    OFF (manual or timed) restores local_only and deletes the user's refresh
    tokens so in-flight remote sessions end immediately, not at token expiry.
    """

    _attr_has_entity_name = True
    _attr_translation_key = "remote_access"
    _attr_should_poll = False

    def __init__(self, data: RemoteAccessData) -> None:
        """Initialize the switch for one managed user."""
        self._data = data
        self._attr_unique_id = f"{data.user_id}_remote_access"
        self._attr_device_info = remote_access_device_info(data)
        self._unsub_auto_off: CALLBACK_TYPE | None = None
        self._expires_at: datetime | None = None

    @property
    def extra_state_attributes(self) -> dict[str, str]:
        """Expose the auto-off deadline; also persists it for restore."""
        if self._attr_is_on and self._expires_at is not None:
            return {ATTR_EXPIRES_AT: self._expires_at.isoformat()}
        return {}

    async def async_added_to_hass(self) -> None:
        """Restore state, reconciling against the real auth flag."""
        await super().async_added_to_hass()
        self.async_on_remove(
            self.hass.bus.async_listen(EVENT_USER_REMOVED, self._async_user_removed)
        )
        self.async_on_remove(
            self.hass.bus.async_listen(EVENT_USER_UPDATED, self._async_user_updated)
        )
        user = await self._async_get_user()
        if user is None:
            self._attr_available = False
            return

        restored_expiry: datetime | None = None
        last = await self.async_get_last_state()
        if last is not None and (raw := last.attributes.get(ATTR_EXPIRES_AT)):
            restored_expiry = dt_util.parse_datetime(raw)

        if user.local_only:
            # The auth flag is the source of truth; ignore any restored ON.
            self._attr_is_on = False
        elif restored_expiry is not None and restored_expiry <= dt_util.utcnow():
            # Window expired while HA was down: fail closed now.
            await self._async_revoke(user)
            self._attr_is_on = False
        elif restored_expiry is not None:
            self._attr_is_on = True
            self._schedule_auto_off(restored_expiry - dt_util.utcnow())
        else:
            # Remote access was enabled outside the integration (e.g. the
            # users UI). Adopt it so it is time-boxed rather than open-ended.
            self._attr_is_on = True
            self._schedule_auto_off(timedelta(minutes=self._data.duration_minutes))

    async def async_will_remove_from_hass(self) -> None:
        """Cancel the timer without revoking access (reload must not revoke)."""
        # The deadline survives as a restored state attribute, so the restore
        # path above resumes the remaining window after a reload or restart.
        self._cancel_auto_off()

    async def async_turn_on(self, **_kwargs: Any) -> None:
        """Allow remote logins and start the auto-off window."""
        user = await self._async_get_user()
        if user is None:
            msg = f"Managed user {self._data.user_id} no longer exists"
            raise HomeAssistantError(msg)
        await self.hass.auth.async_update_user(user, local_only=False)
        # Turning on while already on deliberately restarts the full window.
        self._schedule_auto_off(timedelta(minutes=self._data.duration_minutes))
        self._attr_is_on = True
        self.async_write_ha_state()

    async def async_turn_off(self, **_kwargs: Any) -> None:
        """Revoke remote access immediately."""
        self._cancel_auto_off()
        user = await self._async_get_user()
        if user is not None:
            await self._async_revoke(user)
        self._attr_is_on = False
        self.async_write_ha_state()

    async def _async_get_user(self) -> User | None:
        """Return the managed auth user, if it still exists."""
        return await self.hass.auth.async_get_user(self._data.user_id)

    async def _async_revoke(self, user: User) -> None:
        """Set the user local-only and end their active sessions."""
        await self.hass.auth.async_update_user(user, local_only=True)
        # local_only is only enforced at login/token-grant time; deleting the
        # refresh tokens is what actually terminates an in-flight session.
        for token in list(user.refresh_tokens.values()):
            self.hass.auth.async_remove_refresh_token(token)

    def _schedule_auto_off(self, delay: timedelta) -> None:
        """(Re)start the auto-off timer to fire after the given delay."""
        self._cancel_auto_off()
        self._expires_at = dt_util.utcnow() + delay
        self._unsub_auto_off = async_call_later(self.hass, delay, self._async_auto_off)

    def _cancel_auto_off(self) -> None:
        """Cancel any pending auto-off timer and clear the deadline."""
        if self._unsub_auto_off is not None:
            self._unsub_auto_off()
            self._unsub_auto_off = None
        self._expires_at = None

    async def _async_auto_off(self, _now: datetime) -> None:
        """Revoke access when the window expires."""
        self._unsub_auto_off = None
        self._expires_at = None
        user = await self._async_get_user()
        if user is not None:
            try:
                await self._async_revoke(user)
            except Exception:  # noqa: BLE001 - nothing above catches timer callbacks
                LOGGER.exception(
                    "Could not auto-revoke remote access for %s", self._data.user_name
                )
        self._attr_is_on = False
        self.async_write_ha_state()

    @callback
    def _async_user_removed(self, event: Event) -> None:
        """Go unavailable if the managed auth user is deleted."""
        if event.data.get("user_id") != self._data.user_id:
            return
        self._cancel_auto_off()
        self._attr_is_on = False
        self._attr_available = False
        self.async_write_ha_state()

    async def _async_user_updated(self, event: Event) -> None:
        """
        Reconcile with external changes to the user's local_only flag.

        Our own auth updates fire this event too, but by then the switch
        state already matches the flag, so both branches are no-ops.
        """
        if event.data.get("user_id") != self._data.user_id or not self.available:
            return
        user = await self._async_get_user()
        if user is None:
            return
        if user.local_only and self._attr_is_on:
            # Revoked externally (e.g. the users UI): mirror it, and end the
            # sessions the external flip alone would have left running.
            self._cancel_auto_off()
            for token in list(user.refresh_tokens.values()):
                self.hass.auth.async_remove_refresh_token(token)
            self._attr_is_on = False
            self.async_write_ha_state()
        elif not user.local_only and not self._attr_is_on:
            # Granted externally: adopt it so it stays time-boxed.
            self._attr_is_on = True
            self._schedule_auto_off(timedelta(minutes=self._data.duration_minutes))
            self.async_write_ha_state()
