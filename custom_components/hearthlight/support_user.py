"""
Lifecycle of the integration-provisioned HearthLight Support auth user.

All imports from homeassistant.auth.providers.homeassistant are confined to
this module — that surface is not guaranteed stable, so nothing else in the
integration may import provider internals (see the v0.3.0 const-import bug).

The account is identified by its provider credential username, never by a
stored user id: the id changes on every self-heal recreation, while the
credential username is the stable key. This also means a pre-existing
hearthlight_support account is adopted rather than duplicated.
"""

from __future__ import annotations

import secrets
from typing import TYPE_CHECKING

from homeassistant.auth.const import GROUP_ID_ADMIN
from homeassistant.auth.providers.homeassistant import (
    InvalidUser,
    InvalidUsername,
    async_get_provider,
)
from homeassistant.exceptions import HomeAssistantError

from .const import (
    PASSWORD_ALPHABET,
    PASSWORD_GROUP_LEN,
    PASSWORD_GROUPS,
    SUPPORT_USER_NAME,
    SUPPORT_USERNAME,
)

if TYPE_CHECKING:
    from homeassistant.auth.models import User
    from homeassistant.core import HomeAssistant


def generate_session_password() -> str:
    """Password formatted for reading aloud; the dashes are typed too."""
    return "-".join(
        "".join(secrets.choice(PASSWORD_ALPHABET) for _ in range(PASSWORD_GROUP_LEN))
        for _ in range(PASSWORD_GROUPS)
    )


def _throwaway_password() -> str:
    """Return a password nobody will ever see; it locks the account."""
    return secrets.token_urlsafe(32)


async def async_find_support_user(hass: HomeAssistant) -> User | None:
    """Find the support user by its provider credential (the stable key)."""
    for user in await hass.auth.async_get_users():
        for credential in user.credentials:
            if (
                credential.auth_provider_type == "homeassistant"
                and credential.data.get("username") == SUPPORT_USERNAME
            ):
                return user
    return None


async def async_ensure_support_user(hass: HomeAssistant) -> str:
    """
    Create or adopt the support user and return its id.

    Raises RuntimeError if no 'homeassistant' auth provider is configured.
    Always leaves the account local-only with an unknown password (fail
    closed); only the switch's turn-on path grants access and reveals one.
    """
    provider = async_get_provider(hass)  # RuntimeError bubbles to the caller
    existing = await async_find_support_user(hass)
    if existing is not None:
        return existing.id

    user = await hass.auth.async_create_user(
        SUPPORT_USER_NAME, group_ids=[GROUP_ID_ADMIN], local_only=True
    )
    try:
        await provider.async_add_auth(SUPPORT_USERNAME, _throwaway_password())
    except InvalidUsername:
        # Orphaned provider entry (auth exists but no user matched the
        # credential scan): reuse it, but rotate away whatever it held.
        await provider.async_change_password(SUPPORT_USERNAME, _throwaway_password())
    credentials = await provider.async_get_or_create_credentials(
        {"username": SUPPORT_USERNAME}
    )
    try:
        await hass.auth.async_link_user(user, credentials)
    except ValueError:
        # Credential got linked to another user between scan and link:
        # drop our duplicate and adopt the linked account.
        await hass.auth.async_remove_user(user)
        adopted = await async_find_support_user(hass)
        if adopted is None:
            raise
        return adopted.id
    return user.id


async def async_rotate_password(hass: HomeAssistant) -> str:
    """Set and return a fresh session password (shown to the customer)."""
    try:
        provider = async_get_provider(hass)
        password = generate_session_password()
        await provider.async_change_password(SUPPORT_USERNAME, password)
    except (RuntimeError, InvalidUser) as err:
        msg = "Could not set a session password for the support user"
        raise HomeAssistantError(msg) from err
    return password


async def async_scramble_password(hass: HomeAssistant) -> None:
    """Best-effort rotate to a throwaway; safe when the account is gone."""
    try:
        provider = async_get_provider(hass)
        await provider.async_change_password(SUPPORT_USERNAME, _throwaway_password())
    except (RuntimeError, InvalidUser):
        return


async def async_delete_support_user(hass: HomeAssistant) -> None:
    """Remove the support user; the auth cascade wipes its credentials."""
    user = await async_find_support_user(hass)
    if user is not None:
        await hass.auth.async_remove_user(user)
