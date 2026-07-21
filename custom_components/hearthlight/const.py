"""Constants for the HearthLight integration."""

from logging import Logger, getLogger

DOMAIN = "hearthlight"
LOGGER: Logger = getLogger(__package__)

THEME_NAME = "HearthLight"
THEME_DIR_NAME = "hearthlight"  # -> <config>/themes/hearthlight/
THEME_FILENAME = "hearthlight.yaml"

URL_BASE = "/hearthlight"
BRAND_URL = f"{URL_BASE}/brand"
CARD_URL = f"{URL_BASE}/hearthlight-brand-card.js"

CONF_MANAGE_THEME = "manage_theme"
CONF_SET_DEFAULT_THEME = "set_default_theme"
CONF_REGISTER_CARD_RESOURCE = "register_card_resource"
CONF_CREATE_DASHBOARD = "create_dashboard"
CONF_MANAGED_USERS = "managed_users"
CONF_PROVISION_SUPPORT_USER = "provision_support_user"
CONF_HOME_ADDRESS = "home_address"

# Storage-dashboard url_paths must contain a hyphen (core validation).
DASHBOARD_URL_PATH = "hearthlight-home"
DASHBOARD_TITLE = "HearthLight"
DASHBOARD_ICON = "mdi:fire"
DASHBOARD_STRATEGY_TYPE = "custom:hearthlight"

SUPPORT_USERNAME = "hearthlight_support"  # pre-normalized: .strip().casefold()
SUPPORT_USER_NAME = "HearthLight Support"
# Stable device/unique_id key: the auth user id changes on every self-heal
# recreation, so registry identity must not be derived from it.
SUPPORT_REGISTRY_KEY = "support_user"
# Install-level service device (home address sensor); not a managed user, so
# the stale-user cleanup must always treat it as active.
INSTALL_REGISTRY_KEY = "install"

# Session passwords are dictated over the phone: 12 digits in groups of 4.
# ~40 bits is adequate here — the only viable attack is online guessing
# during an open, time-boxed access window.
PASSWORD_GROUPS = 3
PASSWORD_GROUP_LEN = 4
PASSWORD_ALPHABET = "0123456789"  # noqa: S105 - alphabet, not a credential

DEFAULT_DURATION_MINUTES = 60
MIN_DURATION_MINUTES = 5
MAX_DURATION_MINUTES = 1440

ATTR_EXPIRES_AT = "expires_at"
ATTR_SESSION_PASSWORD = "session_password"  # noqa: S105 - attribute name

# Core bus event types fired by AuthManager. Defined here because their
# constants live in homeassistant.auth.__init__, which is not a stable
# import surface; the event names themselves are stable.
EVENT_USER_REMOVED = "user_removed"
EVENT_USER_UPDATED = "user_updated"

ISSUE_THEMES_INCLUDE_MISSING = "themes_include_missing"
ISSUE_YAML_MODE_RESOURCE = "yaml_mode_resource"
ISSUE_NO_HA_AUTH_PROVIDER = "no_ha_auth_provider"
ISSUE_DASHBOARD_CREATE_FAILED = "dashboard_create_failed"
