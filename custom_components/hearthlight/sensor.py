"""Diagnostic sensors describing this HearthLight install."""

from __future__ import annotations

from typing import TYPE_CHECKING

from homeassistant.components.sensor import SensorEntity
from homeassistant.const import EntityCategory
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo

from .const import CONF_HOME_ADDRESS, DOMAIN, INSTALL_REGISTRY_KEY

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant
    from homeassistant.helpers.entity_platform import AddEntitiesCallback

    from .data import HearthLightConfigEntry


async def async_setup_entry(
    _hass: HomeAssistant,
    entry: HearthLightConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the install-level sensors."""
    async_add_entities([HearthLightHomeAddressSensor(entry)])


class HearthLightHomeAddressSensor(SensorEntity):
    """
    The street address of this install, from the integration options.

    The contact card reads this entity to build the support email subject
    line; entry reload on options save keeps it current.
    """

    _attr_has_entity_name = True
    _attr_translation_key = "home_address"
    _attr_should_poll = False
    _attr_entity_category = EntityCategory.DIAGNOSTIC
    _attr_icon = "mdi:home-map-marker"

    def __init__(self, entry: HearthLightConfigEntry) -> None:
        """Initialize from the config entry options."""
        self._attr_unique_id = "home_address"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, INSTALL_REGISTRY_KEY)},
            name="HearthLight",
            manufacturer="HearthLight",
            model="Install",
            entry_type=DeviceEntryType.SERVICE,
        )
        address = (entry.options.get(CONF_HOME_ADDRESS) or "").strip()
        self._attr_native_value = address or None
