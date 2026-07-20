"""Number entities configuring each remote-access window's duration."""

from __future__ import annotations

from typing import TYPE_CHECKING

from homeassistant.components.number import (
    NumberDeviceClass,
    NumberMode,
    RestoreNumber,
)
from homeassistant.const import EntityCategory, UnitOfTime

from .const import (
    DEFAULT_DURATION_MINUTES,
    MAX_DURATION_MINUTES,
    MIN_DURATION_MINUTES,
)
from .data import remote_access_device_info

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant
    from homeassistant.helpers.entity_platform import AddEntitiesCallback

    from .data import HearthLightConfigEntry, RemoteAccessData


async def async_setup_entry(
    _hass: HomeAssistant,
    entry: HearthLightConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up a duration number per managed user."""
    async_add_entities(
        HearthLightRemoteAccessDurationNumber(data)
        for data in entry.runtime_data.values()
    )


class HearthLightRemoteAccessDurationNumber(RestoreNumber):
    """
    How long remote access stays enabled once toggled on.

    Changing it never reschedules a live window; it applies to the next
    activation only.
    """

    _attr_has_entity_name = True
    _attr_translation_key = "remote_access_duration"
    _attr_should_poll = False
    _attr_device_class = NumberDeviceClass.DURATION
    _attr_native_unit_of_measurement = UnitOfTime.MINUTES
    _attr_native_min_value = MIN_DURATION_MINUTES
    _attr_native_max_value = MAX_DURATION_MINUTES
    _attr_native_step = 5
    _attr_mode = NumberMode.BOX
    _attr_entity_category = EntityCategory.CONFIG

    def __init__(self, data: RemoteAccessData) -> None:
        """Initialize the duration number for one managed user."""
        self._data = data
        self._attr_unique_id = f"{data.user_id}_remote_access_duration"
        self._attr_device_info = remote_access_device_info(data)
        self._attr_native_value = float(DEFAULT_DURATION_MINUTES)

    async def async_added_to_hass(self) -> None:
        """Restore the last configured duration."""
        await super().async_added_to_hass()
        # Platforms set up concurrently, so the switch's adopt-untimed restore
        # path can read the default before this restore lands; that lone boot
        # window then uses the default duration. Benign.
        last = await self.async_get_last_number_data()
        value = last.native_value if last is not None else None
        if value is None or not MIN_DURATION_MINUTES <= value <= MAX_DURATION_MINUTES:
            value = float(DEFAULT_DURATION_MINUTES)
        self._attr_native_value = value
        self._data.duration_minutes = value

    async def async_set_native_value(self, value: float) -> None:
        """Store a new duration for the next activation."""
        self._attr_native_value = value
        self._data.duration_minutes = value
        self.async_write_ha_state()
