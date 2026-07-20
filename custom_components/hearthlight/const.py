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
CONF_MANAGED_USERS = "managed_users"

DEFAULT_DURATION_MINUTES = 60
MIN_DURATION_MINUTES = 5
MAX_DURATION_MINUTES = 1440

ATTR_EXPIRES_AT = "expires_at"

ISSUE_THEMES_INCLUDE_MISSING = "themes_include_missing"
ISSUE_YAML_MODE_RESOURCE = "yaml_mode_resource"
