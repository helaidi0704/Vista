from clients.gemini_client import GeminiClient


class FixAgent:

    def __init__(self):
        self.llm = GeminiClient()

    def generate_patch(self, diagnostic):

        prompt = f"""
Tu es un expert DevOps.

Diagnostic :

{diagnostic}

Génère un patch Git minimal.

Répond uniquement avec un diff git valide.

Exemple :

diff --git a/file.txt b/file.txt
index 1111111..2222222 100644
--- a/file.txt
+++ b/file.txt
@@ -1 +1 @@
-old
+new
"""

        return self.llm.ask(prompt)
