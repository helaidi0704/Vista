from google import genai

from config.settings import GEMINI_API_KEY
from config.settings import MODEL


class GeminiClient:

    def __init__(self):

        if not GEMINI_API_KEY:
            raise ValueError(
                "GEMINI_API_KEY n'est pas définie dans les variables d'environnement"
            )

        self.client = genai.Client(
            api_key=GEMINI_API_KEY
        )

    def ask(self, prompt: str) -> str:

        print("\n=== APPEL GEMINI ===")
        print("MODEL :", MODEL)
        print("TAILLE PROMPT :", len(prompt))

        response = self.client.models.generate_content(
            model=MODEL,
            contents=prompt
        )

        return response.text
