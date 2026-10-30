"""Domain models for the SLT-MOBITEL AI Assistant.

These are plain Python dataclasses with no dependency on FastAPI,
LangChain, or any other framework.  They represent the core business
concepts of a conversation turn and an assistant request/response.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


@dataclass(frozen=True)
class ChatTurn:
    """A single turn in a conversation — either user or assistant."""
    role: Literal["user", "assistant"]
    content: str


@dataclass
class AssistantRequest:
    """Everything the AssistantService needs to produce an answer."""
    message: str
    history: list[ChatTurn] = field(default_factory=list)
    session_id: str | None = None
    # Channel hint: "text" gets full metadata; "voice" gets plain answer only.
    channel: Literal["text", "voice"] = "text"


@dataclass
class SourceReference:
    """A document source cited in an answer."""
    title: str
    category: str


@dataclass
class AssistantResponse:
    """The full result produced by AssistantService."""
    session_id: str
    answer: str
    sources: list[SourceReference] = field(default_factory=list)
    confidence: Literal["high", "medium", "low"] = "low"
    # Whether the answer came from the grounding fallback (no retrieved docs).
    is_fallback: bool = False
