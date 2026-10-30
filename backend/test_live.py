import asyncio
from config import get_settings
from google.genai import Client

settings = get_settings()

async def main():
    print(f"API key length: {len(settings.google_api_key)}")
    print(f"Model: {settings.gemini_live_model}")
    client = Client(api_key=settings.google_api_key)
    try:
        print("Connecting to Gemini Live...")
        async with client.aio.live.connect(
            model=settings.gemini_live_model,
            config={"response_modalities": ["AUDIO"]},
        ) as session:
            print("Successfully connected to Gemini Live!")
    except Exception as e:
        print(f"Connection failed: {type(e).__name__}: {e}")

if __name__ == "__main__":
    asyncio.run(main())
