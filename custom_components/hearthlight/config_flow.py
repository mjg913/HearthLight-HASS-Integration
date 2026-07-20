"""Config flow for the HearthLight integration."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import voluptuous as vol
from homeassistant.config_entries import ConfigFlow, OptionsFlow
from homeassistant.helpers.selector import BooleanSelector

from .const import (
    CONF_MANAGE_THEME,
    CONF_REGISTER_CARD_RESOURCE,
    CONF_SET_DEFAULT_THEME,
    DOMAIN,
)

if TYPE_CHECKING:
    from homeassistant.config_entries import ConfigEntry, ConfigFlowResult

OPTIONS_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_MANAGE_THEME, default=True): BooleanSelector(),
        vol.Required(CONF_SET_DEFAULT_THEME, default=True): BooleanSelector(),
        vol.Required(CONF_REGISTER_CARD_RESOURCE, default=True): BooleanSelector(),
    }
)


class HearthLightConfigFlow(ConfigFlow, domain=DOMAIN):
    """Confirm-only flow; single instance is enforced by the manifest."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Show a confirmation form, then create the entry."""
        if user_input is not None:
            return self.async_create_entry(
                title="HearthLight",
                data={},
                options={
                    CONF_MANAGE_THEME: True,
                    CONF_SET_DEFAULT_THEME: True,
                    CONF_REGISTER_CARD_RESOURCE: True,
                },
            )
        return self.async_show_form(step_id="user", data_schema=vol.Schema({}))

    @staticmethod
    def async_get_options_flow(_config_entry: ConfigEntry) -> HearthLightOptionsFlow:
        """Return the options flow."""
        return HearthLightOptionsFlow()


class HearthLightOptionsFlow(OptionsFlow):
    """Toggle theme/resource management behaviors."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Manage the options."""
        if user_input is not None:
            return self.async_create_entry(data=user_input)
        return self.async_show_form(
            step_id="init",
            data_schema=self.add_suggested_values_to_schema(
                OPTIONS_SCHEMA, self.config_entry.options
            ),
        )
