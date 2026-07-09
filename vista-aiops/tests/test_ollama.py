from clients.ollama_client import OllamaClient


def test_ollama():

    client = OllamaClient()

    result = client.ask(
        "Dis bonjour"
    )

    assert result

