import json
import sys
from pathlib import Path

import requests

API_URL = "http://localhost:8000"


def load_json_log(json_file):

    with open(json_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    return data["log"]


def load_text_log(log_file):

    with open(log_file, "r", encoding="utf-8") as f:
        return f.read()


def save_report(diagnostic):

    Path("reports").mkdir(exist_ok=True)

    report = f"""
CAUSE
=====

{diagnostic.get("cause", "")}


CORRECTION
==========

{diagnostic.get("correction", "")}
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

    response = requests.post(
        f"{API_URL}/diagnose",
        json={"log": log},
        timeout=120
    )

    response.raise_for_status()

    data = response.json()

    diagnostic = data["diagnostic"]

    save_report(diagnostic)

    print_banner("DIAGNOSTIC")

    print("CAUSE")
    print("-" * 20)
    print(diagnostic.get("cause", "N/A"))

    print()

    print("CORRECTION")
    print("-" * 20)
    print(diagnostic.get("correction", "N/A"))

    print()
    print("Rapport sauvegardé : reports/diagnostic.txt")
    print()


def main():

    if len(sys.argv) != 3:

        print(
            "\nUsage :\n"
            "  python cli.py diagnose docker.json\n"
            "  python cli.py diagnose-log logs/pytest.log\n"
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
