import requests

response = requests.post(
    "http://127.0.0.1:11434/api/generate",
    json={
        "model": "qwen3:8b",
        "prompt": "ModuleNotFoundError: No module named requests",
        "stream": False
    },
    timeout=120
)

print(response.status_code)
print(response.text)
