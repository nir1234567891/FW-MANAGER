"""Shared utilities for FortiManager Pro backend.

Centralizes functions and constants that were previously duplicated
across devices.py, monitoring.py, and health_checker.py.
"""


# ---------------------------------------------------------------------------
# Alert thresholds (configurable in one place)
# ---------------------------------------------------------------------------
CPU_HIGH_THRESHOLD = 85.0
CPU_CRITICAL_THRESHOLD = 95.0
MEM_HIGH_THRESHOLD = 85.0
MEM_CRITICAL_THRESHOLD = 95.0


# ---------------------------------------------------------------------------
# Resource usage helpers
# ---------------------------------------------------------------------------

def extract_current(resource_list) -> int:
    """Extract 'current' value from FortiGate resource/usage list format.

    FortiGate resource/usage returns each metric as an array of length 1:
      results.cpu = [{"current": 5, "historical": {...}}]
    This extracts [0]["current"].
    """
    if isinstance(resource_list, list) and resource_list:
        first = resource_list[0]
        if isinstance(first, dict):
            return int(first.get("current", 0))
    return 0


def build_model_name(status_data: dict) -> str:
    """Build friendly model name from system/status response.

    Real FortiGate returns:
      model_name = "FortiGateRugged"
      model_number = "60F"
      model = "FGR60F"  (model code)

    Builds: "FortiGateRugged 60F", falling back to model code.
    """
    model_name = status_data.get("model_name", "")
    model_number = status_data.get("model_number", "")
    model_code = status_data.get("model", "")
    if model_name and model_number:
        return f"{model_name} {model_number}"
    elif model_name:
        return model_name
    return model_code
