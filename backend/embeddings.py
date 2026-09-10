from langchain_google_genai import GoogleGenerativeAIEmbeddings

from config import Settings


def create_embeddings(settings: Settings) -> GoogleGenerativeAIEmbeddings:
    if not settings.google_api_key:
        raise RuntimeError("GOOGLE_API_KEY is not configured")
    return GoogleGenerativeAIEmbeddings(
        model=settings.gemini_embedding_model,
        google_api_key=settings.google_api_key,
    )
