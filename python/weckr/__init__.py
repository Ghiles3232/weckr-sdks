from __future__ import annotations

from .client import Weckr, WeckrDowngradeWarning
from .errors import (
    WeckrCapError,
    WeckrConfigError,
    is_weckr_cap_error,
    is_weckr_config_error,
)
from .pricing import (
    CHEAPER_ALTERNATIVE,
    PRICING,
    calculate_cost,
    resolve_pricing,
)

__version__ = "0.1.1"

__all__ = [
    "Weckr",
    "WeckrDowngradeWarning",
    "WeckrCapError",
    "WeckrConfigError",
    "is_weckr_cap_error",
    "is_weckr_config_error",
    "PRICING",
    "CHEAPER_ALTERNATIVE",
    "calculate_cost",
    "resolve_pricing",
    "__version__",
]
