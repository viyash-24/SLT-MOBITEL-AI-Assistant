import asyncio
from config import get_settings
from google.genai import Client, types

settings = get_settings()

tests = [
    ("tools=None", types.LiveConnectConfig(response_modalities=["AUDIO"], tools=None)),
    ("tools with actual func", types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        tools=[types.Tool(function_declarations=[
            types.FunctionDeclaration(
                name="test_func",
                description="test",
                parameters=types.Schema(type=types.Type.OBJECT, properties={"q": types.Schema(type=types.Type.STRING)})
            )
        ])]
    )),
]

async def main():
    client = Client(api_key=settings.google_api_key)
    for name, cfg in tests:
        print(f"Testing {name}...")
        try:
            async with asyncio.timeout(6):
                async with client.aio.live.connect(model=settings.gemini_live_model, config=cfg) as s:
                    print(f"  -> SUCCESS: {name}")
        except Exception as e:
            print(f"  -> FAILED: {name} ({type(e).__name__}: {e})")

if __name__ == "__main__":
    asyncio.run(main())
