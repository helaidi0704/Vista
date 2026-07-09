import json

from agents.context_agent import ContextAgent
from clients.gemini_client import GeminiClient


class DiagnosticAgent:

    def __init__(self):
        self.llm = GeminiClient()
        self.context_agent = ContextAgent()

    def analyze(self, log_content: str):

        context = self.context_agent.build_context_text()

        prompt = f"""
Tu es un expert DevOps et CI/CD.

CONTEXTE PROJET :

{context}

ERREUR :

{log_content}

IMPORTANT :

- Réponds uniquement avec un JSON brut.
- Ne jamais utiliser ```json
- Ne jamais utiliser ```
- Ne jamais ajouter d'explication avant ou après le JSON.

Format obligatoire :

{{
  "cause": "...",
  "correction": "..."
}}
"""

        response = self.llm.ask(prompt)

        response = response.strip()

        if response.startswith("```json"):
            response = response[len("```json"):]

        if response.startswith("```"):
            response = response[len("```"):]

        if response.endswith("```"):
            response = response[:-3]

        response = response.strip()

        print("\n=== REPONSE GEMINI ===")
        print(response)

        try:
            return json.loads(response)

        except Exception as exc:
            return {
                "cause": "parse_error",
                "correction": response,
                "error": str(exc)
            }
