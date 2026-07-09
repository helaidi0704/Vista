import subprocess

from config.settings import VISTA_PATH


class TestAgent:

    def build_docker(self):

        return subprocess.run(
            ["docker", "compose", "build"],
            cwd=VISTA_PATH,
            capture_output=True,
            text=True
        )

    def start_stack(self):

        return subprocess.run(
            ["docker", "compose", "up", "-d"],
            cwd=VISTA_PATH,
            capture_output=True,
            text=True
        )
