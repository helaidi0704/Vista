from pathlib import Path
import subprocess


LOG_DIR = Path("logs")
LOG_DIR.mkdir(exist_ok=True)


def run_and_capture(command, output_file):

    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        shell=True
    )

    content = ""

    if result.stdout:
        content += result.stdout

    if result.stderr:
        content += "\n\n=== STDERR ===\n\n"
        content += result.stderr

    Path(output_file).write_text(
        content,
        encoding="utf-8"
    )

    return result.returncode


if __name__ == "__main__":

    code = run_and_capture(
        "pytest",
        "logs/pytest.log"
    )

    exit(code)
