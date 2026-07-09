from clients.gemini_client import GeminiClient


class TroubleshootingAgent:

    def __init__(self):
        self.llm = GeminiClient()

    def suggest(self, diagnostic):

        prompt = f"""
Tu es un expert DevOps.

Diagnostic :

{diagnostic}

Propose 3 solutions.

Pour chaque solution :

- description
- niveau de confiance (%)

Réponse courte.
"""

        return self.llm.ask(prompt)
