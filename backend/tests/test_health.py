from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_root_endpoint_returns_service_status() -> None:
    response = client.get("/")
    assert response.status_code == 200
    body = response.json()
    assert body["service"] == "backend"
    assert body["status"] == "ok"
    assert body["message"] == "Backend API is ready"


def test_health_endpoint_returns_backend_status() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "backend"
    assert body["message"] == "Backend service is running"
    assert body["environment"] == "local"
    assert "timestamp_utc" in body
