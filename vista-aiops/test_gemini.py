# test_gemini.py

from clients.gemini_client import GeminiClient

client = GeminiClient()

print(
    client.ask(
        "ModuleNotFoundError: No module named requests"
    )
)
