"""Shared runtime data for the remote-access entities."""

from __future__ import annotations

from dataclasses import dataclass

from homeassistant.config_entries import ConfigEntry
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo

from .const import DEFAULT_DURATION_MINUTES, DOMAIN


@dataclass
class RemoteAccessData:
    """Per-managed-user shared state (keyed by auth user id)."""

    user_id: str
    user_name: str
    # Written by the number entity, read by the switch at turn-on time.
    duration_minutes: float = DEFAULT_DURATION_MINUTES


def remote_access_device_info(data: RemoteAccessData) -> DeviceInfo:
    """
    Build the per-user device shared by the switch and number.

    The card finds the duration number by walking this shared device, so both
    entities must use identical identifiers.
    """
    return DeviceInfo(
        identifiers={(DOMAIN, data.user_id)},
        name=data.user_name,
        manufacturer="HearthLight",
        model="Remote access",
        entry_type=DeviceEntryType.SERVICE,
    )


type HearthLightConfigEntry = ConfigEntry[dict[str, RemoteAccessData]]
