from typing import Any

from fastapi.testclient import TestClient

# 1x1 transparent PNG, base64-encoded.
_BASE64_PNG = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


def _image_payload(**overrides: Any) -> dict[str, Any]:
    payload = {
        "id": "upload_1719140000000_ab12cd",
        "name": "test.png",
        "src": f"data:image/png;base64,{_BASE64_PNG}",
        "format": "PNG",
        "size": 68,
        "width": 1,
        "height": 1,
        "createdAt": "2026-07-01T10:30:00.000Z",
    }
    payload.update(overrides)
    return payload


def test_register_image_success(client: TestClient) -> None:
    response = client.post("/api/images", json=_image_payload())
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["savedImage"]["id"] != "upload_1719140000000_ab12cd"
    assert body["savedImage"]["width"] == 1
    assert body["savedImage"]["format"] == "PNG"
    assert "requestId" in body
    assert "receivedAt" in body


def test_register_image_idempotent_on_duplicate_hash(client: TestClient) -> None:
    first = client.post("/api/images", json=_image_payload())
    second = client.post("/api/images", json=_image_payload(id="upload_other"))
    assert first.json()["savedImage"]["id"] == second.json()["savedImage"]["id"]


def test_register_image_invalid_base64_returns_error(client: TestClient) -> None:
    response = client.post(
        "/api/images", json=_image_payload(src="data:image/png;base64,not-valid-base64!!")
    )
    assert response.status_code == 400
    body = response.json()
    assert body["success"] is False
    assert body["errorCode"] == "IMAGE_REGISTRATION_FAILED"


def test_register_image_unsupported_format_returns_error(client: TestClient) -> None:
    response = client.post("/api/images", json=_image_payload(format="GIF"))
    assert response.status_code == 400
    assert response.json()["errorCode"] == "IMAGE_REGISTRATION_FAILED"


def test_delete_image_success(client: TestClient) -> None:
    register = client.post("/api/images", json=_image_payload())
    image_id = register.json()["savedImage"]["id"]

    response = client.delete(f"/api/images/{image_id}")
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["deletedImageId"] == image_id


def test_delete_image_unknown_id_returns_404(client: TestClient) -> None:
    response = client.delete("/api/images/00000000-0000-0000-0000-000000000000")
    assert response.status_code == 404
    assert response.json()["success"] is False


def test_delete_image_invalid_id_returns_404(client: TestClient) -> None:
    response = client.delete("/api/images/not-a-uuid")
    assert response.status_code == 404


def test_list_images_returns_empty_list_when_no_images(client: TestClient) -> None:
    response = client.get("/api/images")
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert isinstance(body["images"], list)


def test_list_images_includes_registered_image(client: TestClient) -> None:
    payload = _image_payload()
    client.post("/api/images", json=payload)
    response = client.get("/api/images")
    assert response.status_code == 200
    body = response.json()
    assert len(body["images"]) >= 1
    img = body["images"][0]
    assert "id" in img
    assert img["name"] == "test.png"
    assert "src" in img
    assert "/api/images/" in img["src"]


def test_get_image_file_returns_binary(client: TestClient) -> None:
    register = client.post("/api/images", json=_image_payload())
    image_id = register.json()["savedImage"]["id"]
    response = client.get(f"/api/images/{image_id}/file")
    assert response.status_code == 200
    assert response.headers["content-type"] in ("image/png", "image/jpeg")


def test_get_image_file_not_found(client: TestClient) -> None:
    response = client.get("/api/images/00000000-0000-0000-0000-000000000000/file")
    assert response.status_code == 404
