"""Shared runtime data for the remote-access entities."""

from __future__ import annotations

from dataclasses import dataclass

from homeassistant.config_entries import ConfigEntry
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo

from .const import DEFAULT_DURATION_MINUTES, DOMAIN


@dataclass
class RemoteAccessData:
    """Per-managed-user shared state (keyed by registry_key)."""

    # Live auth id — used for all hass.auth operations. May change across
    # self-heal recreations of the provisioned support user.
    user_id: str
    user_name: str
    # Device/unique_id key: equals user_id for options-managed users, but is
    # the fixed SUPPORT_REGISTRY_KEY for the provisioned support user so the
    # registry never churns when the account is recreated.
    registry_key: str
    is_support: bool = False
    # Written by the number entity, read by the switch at turn-on time.
    duration_minutes: float = DEFAULT_DURATION_MINUTES


def remote_access_device_info(data: RemoteAccessData) -> DeviceInfo:
    """
    Build the per-user device shared by the switch and number.

    The card finds the duration number by walking this shared device, so both
    entities must use identical identifiers.
    """
    return DeviceInfo(
        identifiers={(DOMAIN, data.registry_key)},
        name=data.user_name,
        manufacturer="HearthLight",
        model="Remote access",
        entry_type=DeviceEntryType.SERVICE,
    )


type HearthLightConfigEntry = ConfigEntry[dict[str, RemoteAccessData]]
