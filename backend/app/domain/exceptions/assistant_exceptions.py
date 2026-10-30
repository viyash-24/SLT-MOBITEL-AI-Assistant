"""Domain exceptions for the SLT-MOBITEL AI Assistant.

These exceptions represent domain-level failure conditions.  Application
and infrastructure layers catch provider-specific exceptions and re-raise
as one of these to keep the domain free of framework details.
"""
from __future__ import annotations


class AssistantError(Exception):
    """Base class for all assistant domain errors."""


class ConfigurationError(AssistantError):
    """A required environment variable or configuration value is missing."""


class ProviderError(AssistantError):
    """An external provider (LLM, vector store, embeddings) failed."""


class GroundingError(AssistantError):
    """The assistant could not ground an answer in verified knowledge."""


class KnowledgeBaseError(AssistantError):
    """The knowledge base could not be loaded or indexed."""
