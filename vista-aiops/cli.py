import json
import sys
from pathlib import Path

from google import genai


def load_json_log(json_file):

    with open(json_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    return data["log"]


def load_text_log(log_file):

    with open(log_file, "r", encoding="utf-8") as f:
        return f.read()


def save_report(cause: str, correction: str):

    Path("reports").mkdir(exist_ok=True)

    report = f"""
CAUSE
=====

{cause}


CORRECTION
==========

{correction}
"""

    Path("reports/diagnostic.txt").write_text(
        report,
        encoding="utf-8"
    )


def print_banner(title):

    print()
    print("=" * 60)
    print(title)
    print("=" * 60)
    print()


def diagnose(log):

    client = genai.Client()

    prompt = f"""
Tu es un expert DevOps, CI/CD, Docker, FastAPI, Angular et Playwright.

Analyse le log suivant.

Retourne uniquement un JSON au format :

{{
  "cause": "...",
  "correction": "..."
}}

LOG :

{log}
"""

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt
    )

    text = response.text.strip()

    if text.startswith("```json"):
        text = text.replace("```json", "", 1)

    if text.endswith("```"):
        text = text[:-3]

    data = json.loads(text.strip())

    cause = data.get("cause", "N/A")
    correction = data.get("correction", "N/A")

    save_report(cause, correction)

    print_banner("DIAGNOSTIC")

    print("CAUSE")
    print("-" * 20)
    print(cause)

    print()

    print("CORRECTION")
    print("-" * 20)
    print(correction)

    print()
    print("Rapport sauvegardé : reports/diagnostic.txt")
    print()


def main():

    if len(sys.argv) != 3:

        print(
            "\nUsage :\n"
            "  python cli.py diagnose docker.json\n"
            "  python cli.py diagnose-log logs/docker.log\n"
        )

        sys.exit(1)

    command = sys.argv[1]
    file_path = sys.argv[2]

    if command == "diagnose":

        log = load_json_log(file_path)
        diagnose(log)

    elif command == "diagnose-log":

        log = load_text_log(file_path)
        diagnose(log)

    else:

        print(f"Commande inconnue : {command}")
        sys.exit(1)


if __name__ == "__main__":
    main()
