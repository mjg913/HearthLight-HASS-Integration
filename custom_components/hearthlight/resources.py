"""
Serve brand assets and register the brand card as a Lovelace resource.

There is no public API for integrations to register dashboard resources
(https://developers.home-assistant.io/docs/frontend/custom-ui/registering-resources),
so this uses the Lovelace resource storage collection the same way HACS does,
falling back to frontend.add_extra_js_url for YAML-mode dashboards.
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any

from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.helpers import issue_registry as ir

from .const import (
    BRAND_URL,
    CARD_URL,
    DOMAIN,
    ISSUE_YAML_MODE_RESOURCE,
    LOGGER,
)

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

COMPONENT_DIR = Path(__file__).parent


async def async_register_static_paths(hass: HomeAssistant) -> None:
    """
    Register the brand-asset and card URLs.

    Static paths cannot be removed, so this must run at most once per process.
    """
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get("static_registered"):
        return
    await hass.http.async_register_static_paths(
        [
            StaticPathConfig(
                BRAND_URL, str(COMPONENT_DIR / "brand"), cache_headers=True
            ),
            StaticPathConfig(
                CARD_URL,
                str(COMPONENT_DIR / "frontend" / "hearthlight-brand-card.js"),
                cache_headers=True,
            ),
        ]
    )
    domain_data["static_registered"] = True
    LOGGER.debug("Registered static paths %s and %s", BRAND_URL, CARD_URL)


def _get_resources(hass: HomeAssistant) -> Any:
    """Return the Lovelace resource collection, tolerating shape changes."""
    lovelace = hass.data.get("lovelace")
    resources = getattr(lovelace, "resources", None)
    if resources is None and isinstance(lovelace, dict):
        resources = lovelace.get("resources")
    return resources


async def async_register_card_resource(hass: HomeAssistant, version: str) -> None:
    """Ensure the card is registered as a module resource at the current version."""
    desired_url = f"{CARD_URL}?v={version}"
    resources = _get_resources(hass)

    if resources is None or not hasattr(resources, "async_create_item"):
        # YAML-mode dashboards (or unknown internals): load the module anyway.
        add_extra_js_url(hass, desired_url)
        ir.async_create_issue(
            hass,
            DOMAIN,
            ISSUE_YAML_MODE_RESOURCE,
            is_fixable=False,
            severity=ir.IssueSeverity.WARNING,
            translation_key=ISSUE_YAML_MODE_RESOURCE,
            learn_more_url="https://github.com/mjg913/HearthLight-HASS-Integration#yaml-dashboards",
        )
        LOGGER.info(
            "Lovelace resource collection unavailable (YAML mode?); "
            "loaded card via add_extra_js_url instead"
        )
        return

    ir.async_delete_issue(hass, DOMAIN, ISSUE_YAML_MODE_RESOURCE)

    # The collection is lazy-loaded; at boot it will not be loaded yet.
    if not resources.loaded:
        await resources.async_load()

    existing = next(
        (
            item
            for item in resources.async_items()
            if str(item.get("url", "")).split("?")[0] == CARD_URL
        ),
        None,
    )
    if existing is None:
        await resources.async_create_item({"res_type": "module", "url": desired_url})
        LOGGER.info("Registered Lovelace resource %s", desired_url)
    elif existing.get("url") != desired_url:
        await resources.async_update_item(existing["id"], {"url": desired_url})
        LOGGER.info("Updated Lovelace resource to %s", desired_url)


async def async_remove_card_resource(hass: HomeAssistant) -> None:
    """Remove the card's Lovelace resource entry (clean removal)."""
    resources = _get_resources(hass)
    if resources is None or not hasattr(resources, "async_delete_item"):
        return
    if not resources.loaded:
        await resources.async_load()
    for item in list(resources.async_items()):
        if str(item.get("url", "")).split("?")[0] == CARD_URL:
            await resources.async_delete_item(item["id"])
            LOGGER.info("Removed Lovelace resource %s", item.get("url"))
