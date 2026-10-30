"""Domain-layer grounding policy for the SLT-MOBITEL AI Assistant.

Determines whether the assistant should fall back to a canned response
when retrieved knowledge is insufficient.  This lives in the domain layer
because the fallback *decision* and *message* are business rules that must
not depend on any specific LLM, vector store, or framework.
"""
from __future__ import annotations

# The canonical fallback message — no speculative content.
FALLBACK_ANSWER = (
    "I do not have enough verified information to answer that question. "
    "Please call the SLT-MOBITEL customer helpline at 1212 or visit "
    "https://www.sltmobitel.lk/ for accurate assistance."
)


def should_fallback(retrieved_document_count: int) -> bool:
    """Return True when there are no retrieved documents to ground the answer."""
    return retrieved_document_count == 0


def confidence_from_count(retrieved_document_count: int) -> str:
    """Map retrieval count to a confidence level string."""
    if retrieved_document_count >= 2:
        return "high"
    if retrieved_document_count == 1:
        return "medium"
    return "low"
