"""Core configuration module.

Re-exports Settings and get_settings from the backend configuration.
"""
from config import Settings, get_settings

__all__ = ["Settings", "get_settings"]
