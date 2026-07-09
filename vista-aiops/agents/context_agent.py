from pathlib import Path

from config.settings import VISTA_PATH


class ContextAgent:

    def __init__(self):
        self.project_path = Path(VISTA_PATH)

    def read_file(self, relative_path: str, max_chars: int = 1000):

        file_path = self.project_path / relative_path

        if not file_path.exists():
            return f"[FILE NOT FOUND] {relative_path}"

        try:
            content = file_path.read_text(
                encoding="utf-8",
                errors="ignore"
            )

            return content[:max_chars]

        except Exception as exc:
            return f"[ERROR] {relative_path}: {exc}"

    def collect_context(self):

        return {
            "pyproject": self.read_file(
                "pyproject.toml"
            ),
            "api_requirements": self.read_file(
                "apps/api/requirements.txt"
            ),
            "frontend_package": self.read_file(
                "frontend/package.json"
            ),
            "docker_compose": self.read_file(
                "infra/infra/docker/docker-compose.yml"
            ),
        }

    def build_context_text(self):

        context = self.collect_context()

        return f"""
=== PYPROJECT ===
{context['pyproject']}

=== API REQUIREMENTS ===
{context['api_requirements']}

=== FRONTEND PACKAGE.JSON ===
{context['frontend_package']}

=== DOCKER COMPOSE ===
{context['docker_compose']}
"""
