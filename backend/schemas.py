from typing import Literal

from pydantic import BaseModel, Field


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=8000)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    history: list[ChatTurn] = Field(default_factory=list, max_length=20)
    session_id: str | None = Field(default=None, max_length=120)


class Source(BaseModel):
    title: str
    category: str


class ChatResponse(BaseModel):
    session_id: str
    answer: str
    sources: list[Source]
    confidence: Literal["high", "medium", "low"]


class HealthResponse(BaseModel):
    status: str
    gemini_configured: bool
    database_configured: bool
    database_ready: bool
    knowledge_base_documents: int
