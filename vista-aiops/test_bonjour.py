# test_bonjour.py

import requests

response = requests.post(
    "http://127.0.0.1:11434/api/generate",
    json={
        "model": "qwen3:8b",
        "prompt": "bonjour",
        "stream": False
    },
    timeout=300
)

print(response.status_code)
print(response.text)
