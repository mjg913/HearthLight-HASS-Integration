"""Config flow for the HearthLight integration."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import voluptuous as vol
from homeassistant.config_entries import ConfigFlow, OptionsFlowWithReload
from homeassistant.helpers.selector import (
    BooleanSelector,
    SelectOptionDict,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
    TextSelector,
)

from . import support_user
from .const import (
    CONF_CREATE_DASHBOARD,
    CONF_HOME_ADDRESS,
    CONF_MANAGE_THEME,
    CONF_MANAGED_USERS,
    CONF_PROVISION_SUPPORT_USER,
    CONF_REGISTER_CARD_RESOURCE,
    CONF_SET_DEFAULT_THEME,
    DOMAIN,
)

if TYPE_CHECKING:
    from homeassistant.config_entries import ConfigEntry, ConfigFlowResult

_BASE_OPTIONS = {
    vol.Required(CONF_MANAGE_THEME, default=True): BooleanSelector(),
    vol.Required(CONF_SET_DEFAULT_THEME, default=True): BooleanSelector(),
    vol.Required(CONF_REGISTER_CARD_RESOURCE, default=True): BooleanSelector(),
    vol.Required(CONF_CREATE_DASHBOARD, default=True): BooleanSelector(),
    vol.Required(CONF_PROVISION_SUPPORT_USER, default=False): BooleanSelector(),
    # Street address of this install; the contact card puts it in the
    # support email subject so tickets identify the home. Empty = omitted.
    vol.Optional(CONF_HOME_ADDRESS, default=""): TextSelector(),
}


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
                    CONF_CREATE_DASHBOARD: True,
                    CONF_MANAGED_USERS: [],
                    CONF_PROVISION_SUPPORT_USER: False,
                    CONF_HOME_ADDRESS: "",
                },
            )
        return self.async_show_form(step_id="user", data_schema=vol.Schema({}))

    @staticmethod
    def async_get_options_flow(_config_entry: ConfigEntry) -> HearthLightOptionsFlow:
        """Return the options flow."""
        return HearthLightOptionsFlow()


class HearthLightOptionsFlow(OptionsFlowWithReload):
    """Toggle theme/resource behaviors and pick remote-access managed users."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Manage the options."""
        if user_input is not None:
            return self.async_create_entry(data=user_input)

        # No UserSelector exists in HA, so build the picker from the auth
        # registry ourselves. The support user is implicitly managed when
        # provisioned, so it never appears as a manual choice.
        support = await support_user.async_find_support_user(self.hass)
        support_id = support.id if support else None
        users = await self.hass.auth.async_get_users()
        user_options = sorted(
            (
                SelectOptionDict(value=user.id, label=user.name or user.id)
                for user in users
                if not user.system_generated
                and user.is_active
                and user.id != support_id
            ),
            key=lambda option: option["label"].casefold(),
        )
        schema = vol.Schema(
            {
                **_BASE_OPTIONS,
                vol.Optional(CONF_MANAGED_USERS, default=[]): SelectSelector(
                    SelectSelectorConfig(
                        options=user_options,
                        multiple=True,
                        mode=SelectSelectorMode.DROPDOWN,
                    )
                ),
            }
        )
        # Drop ids of since-deleted users: a value without a matching select
        # option would break the form, and saving then prunes them for good.
        valid_ids = {option["value"] for option in user_options}
        suggested = dict(self.config_entry.options)
        suggested[CONF_MANAGED_USERS] = [
            user_id
            for user_id in suggested.get(CONF_MANAGED_USERS, [])
            if user_id in valid_ids
        ]
        return self.async_show_form(
            step_id="init",
            data_schema=self.add_suggested_values_to_schema(schema, suggested),
        )
