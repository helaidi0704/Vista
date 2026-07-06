import requests

from config.settings import MODEL
from config.settings import OLLAMA_URL


class OllamaClient:

    def ask(self, prompt: str) -> str:

        print("\n=== APPEL OLLAMA ===")
        print("MODEL :", MODEL)
        print("URL   :", OLLAMA_URL)
        print("TAILLE PROMPT :", len(prompt))

        response = requests.post(
            f"{OLLAMA_URL}/api/generate",
            json={
                "model": MODEL,
                "prompt": prompt,
                "stream": False,
                "options": {
                    "temperature": 0,
                    "num_predict": 150
                }
            },
            timeout=600
        )

        print("\n=== REPONSE OLLAMA ===")
        print("STATUS :", response.status_code)

        response.raise_for_status()

        data = response.json()

        return data.get("response", "")
