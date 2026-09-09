from langchain_google_genai import ChatGoogleGenerativeAI

from config import Settings
from prompt import build_prompt


def generate_answer(settings: Settings, context: str, history: str, message: str) -> str:
    if not settings.google_api_key:
        raise RuntimeError("GOOGLE_API_KEY is not configured")
    llm = ChatGoogleGenerativeAI(
        model=settings.gemini_model,
        temperature=0.1,
        google_api_key=settings.google_api_key,
    )
    answer = llm.invoke(build_prompt(context, history, message)).content
    if isinstance(answer, str):
        return answer
    if isinstance(answer, list):
        return "".join(
            part.get("text", "") if isinstance(part, dict) else str(part)
            for part in answer
        )
    return str(answer)
