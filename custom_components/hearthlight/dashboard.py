"""
Create and remove the auto-generated HearthLight dashboard.

There is no public API for integrations to create Lovelace dashboards, so
this drives the same storage collection the UI's dashboard manager uses
(core precedent: lovelace's own _create_map_dashboard). The dashboard's
config is a single pointer at the bundled frontend strategy, which builds
the actual layout client-side on every load.

Every internal access is feature-detected; on any surprise the module
degrades to a Repair issue with manual instructions instead of failing
setup. The collection itself lives in a local variable of lovelace's
async_setup, so the only live handle is the registered websocket create
command, whose unwrapped handler is a bound method on the collection's
websocket helper.
"""

from __future__ import annotations

import inspect
from typing import TYPE_CHECKING, Any

import voluptuous as vol
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import issue_registry as ir

from .const import (
    DASHBOARD_ICON,
    DASHBOARD_STRATEGY_TYPE,
    DASHBOARD_TITLE,
    DASHBOARD_URL_PATH,
    DOMAIN,
    ISSUE_DASHBOARD_CREATE_FAILED,
    LOGGER,
)

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant


def _get_dashboards(hass: HomeAssistant) -> dict[str | None, Any] | None:
    """Return the url_path -> dashboard config store map, tolerating shape changes."""
    lovelace = hass.data.get("lovelace")
    dashboards = getattr(lovelace, "dashboards", None)
    if dashboards is None and isinstance(lovelace, dict):
        dashboards = lovelace.get("dashboards")
    return dashboards if isinstance(dashboards, dict) else None


def _get_dashboards_collection(hass: HomeAssistant) -> Any | None:
    """Return the live DashboardsCollection, or None if internals changed shape."""
    handlers = hass.data.get("websocket_api")
    if not isinstance(handlers, dict):
        return None
    registered = handlers.get("lovelace/dashboards/create")
    if not isinstance(registered, tuple) or not registered:
        return None
    handler = inspect.unwrap(registered[0])
    collection = getattr(getattr(handler, "__self__", None), "storage_collection", None)
    if collection is None or not hasattr(collection, "async_create_item"):
        return None
    return collection


def _raise_issue(hass: HomeAssistant) -> None:
    """Ask the user to create the dashboard manually."""
    ir.async_create_issue(
        hass,
        DOMAIN,
        ISSUE_DASHBOARD_CREATE_FAILED,
        is_fixable=False,
        severity=ir.IssueSeverity.WARNING,
        translation_key=ISSUE_DASHBOARD_CREATE_FAILED,
        learn_more_url="https://github.com/mjg913/HearthLight-HASS-Integration#dashboard",
    )


async def _async_do_create(hass: HomeAssistant, collection: Any) -> None:
    """Create the collection item and write the pristine strategy config."""
    if not getattr(collection, "loaded", True):
        await collection.async_load()
    if not any(
        item.get("url_path") == DASHBOARD_URL_PATH for item in collection.async_items()
    ):
        await collection.async_create_item(
            {
                "title": DASHBOARD_TITLE,
                "icon": DASHBOARD_ICON,
                "url_path": DASHBOARD_URL_PATH,
                "require_admin": False,
                "show_in_sidebar": True,
            }
        )
    # The create listener spawns the per-dashboard config store synchronously,
    # so it is available immediately (KeyError here means internals changed).
    store = (_get_dashboards(hass) or {})[DASHBOARD_URL_PATH]
    await store.async_save({"strategy": {"type": DASHBOARD_STRATEGY_TYPE}})


async def async_create_dashboard(hass: HomeAssistant) -> None:
    """Ensure the HearthLight dashboard exists, never touching an existing one."""
    dashboards = _get_dashboards(hass)
    if dashboards is None:
        LOGGER.warning(
            "Lovelace dashboard internals unavailable; cannot create the dashboard"
        )
        _raise_issue(hass)
        return
    if DASHBOARD_URL_PATH in dashboards:
        # Already present — ours from an earlier run, taken over by the user,
        # or defined in YAML at our url_path. All of those are left alone.
        ir.async_delete_issue(hass, DOMAIN, ISSUE_DASHBOARD_CREATE_FAILED)
        return

    collection = _get_dashboards_collection(hass)
    if collection is None:
        LOGGER.warning(
            "Lovelace dashboards collection unavailable; cannot create the dashboard"
        )
        _raise_issue(hass)
        return

    try:
        await _async_do_create(hass, collection)
    except (vol.Invalid, HomeAssistantError, KeyError, TypeError) as err:
        LOGGER.warning("Could not create the HearthLight dashboard: %s", err)
        _raise_issue(hass)
        return
    ir.async_delete_issue(hass, DOMAIN, ISSUE_DASHBOARD_CREATE_FAILED)
    LOGGER.info("Created the HearthLight dashboard at /%s", DASHBOARD_URL_PATH)


async def _async_is_pristine(store: Any) -> bool:
    """Whether the dashboard still holds the untouched strategy config."""
    try:
        config = await store.async_load(force=False)
    except Exception:  # noqa: BLE001 - ConfigNotFound et al: never configured
        return True
    if not isinstance(config, dict):
        return True
    strategy = config.get("strategy")
    strategy_type = strategy.get("type") if isinstance(strategy, dict) else None
    return strategy_type == DASHBOARD_STRATEGY_TYPE and "views" not in config


async def async_remove_dashboard(hass: HomeAssistant) -> None:
    """Delete the dashboard on clean removal, unless the user customized it."""
    dashboards = _get_dashboards(hass)
    store = dashboards.get(DASHBOARD_URL_PATH) if dashboards else None
    if store is None:
        return
    if not await _async_is_pristine(store):
        LOGGER.info(
            "Leaving dashboard /%s in place: it has been customized",
            DASHBOARD_URL_PATH,
        )
        return
    collection = _get_dashboards_collection(hass)
    if collection is None or not hasattr(collection, "async_delete_item"):
        return
    if not getattr(collection, "loaded", True):
        await collection.async_load()
    item = next(
        (
            item
            for item in collection.async_items()
            if item.get("url_path") == DASHBOARD_URL_PATH
        ),
        None,
    )
    if item is not None:
        # Core's removal listener unregisters the panel and deletes the
        # dashboard's own config store.
        await collection.async_delete_item(item["id"])
        LOGGER.info("Removed the HearthLight dashboard at /%s", DASHBOARD_URL_PATH)
