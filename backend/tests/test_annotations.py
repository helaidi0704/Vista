from typing import Any

from fastapi.testclient import TestClient

_BASE64_PNG = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


def _register_image(client: TestClient, *, name: str = "test.png") -> str:
    payload = {
        "id": "upload_1719140000000_ab12cd",
        "name": name,
        "src": f"data:image/png;base64,{_BASE64_PNG}",
        "format": "PNG",
        "size": 68,
        "width": 1,
        "height": 1,
        "createdAt": "2026-07-01T10:30:00.000Z",
    }
    response = client.post("/api/images", json=payload)
    assert response.status_code == 200
    return response.json()["savedImage"]["id"]


def _bbox_create(work_id: str, image_id: str, **overrides: Any) -> dict[str, Any]:
    item = {
        "workId": work_id,
        "imageId": image_id,
        "defectLabel": "Rayure profonde",
        "severity": "Critique",
        "description": "Rayure importante sur la surface principale.",
        "shapeLabel": "\U0001f7e5 BBox",
        "geometry": {"type": "bbox", "bbox": {"nx": 0.45, "ny": 0.35, "nw": 0.15, "nh": 0.3}},
    }
    item.update(overrides)
    return item


def _save_payload(image_id: str, **overrides: Any) -> dict[str, Any]:
    payload = {
        "requestId": "req_test_1",
        "sentAt": "2026-07-01T10:30:00.000Z",
        "image": {
            "id": image_id,
            "name": "test.png",
            "format": "PNG",
            "size": 68,
            "width": 1,
            "height": 1,
            "createdAt": "2026-07-01T10:30:00.000Z",
        },
        "creates": [],
        "updates": [],
    }
    payload.update(overrides)
    return payload


def test_save_annotations_create_success(client: TestClient) -> None:
    image_id = _register_image(client)
    payload = _save_payload(image_id, creates=[_bbox_create("work_1", image_id)])

    response = client.post("/api/images/save-annotations", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["requestId"] == "req_test_1"
    assert body["createdWorkIds"] == ["work_1"]
    assert body["failedWorkIds"] == []
    assert len(body["created"]) == 1
    assert body["created"][0]["workId"] == "work_1"
    assert body["created"][0]["id"]


def test_save_annotations_update_success(client: TestClient) -> None:
    image_id = _register_image(client)
    create_payload = _save_payload(image_id, creates=[_bbox_create("work_1", image_id)])
    create_response = client.post("/api/images/save-annotations", json=create_payload)
    annotation_id = create_response.json()["created"][0]["id"]

    update_item = _bbox_create("work_1", image_id, id=annotation_id, severity="Majeur")
    update_payload = _save_payload(image_id, updates=[update_item])

    response = client.post("/api/images/save-annotations", json=update_payload)
    assert response.status_code == 200
    body = response.json()
    assert body["updatedWorkIds"] == ["work_1"]
    assert body["failedWorkIds"] == []


def test_save_annotations_unknown_defect_label_fails_item(client: TestClient) -> None:
    image_id = _register_image(client)
    create_item = _bbox_create("work_1", image_id, defectLabel="Unknown defect")
    payload = _save_payload(image_id, creates=[create_item])

    response = client.post("/api/images/save-annotations", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["createdWorkIds"] == []
    assert body["failedWorkIds"] == ["work_1"]


def test_save_annotations_invalid_bbox_geometry_returns_422(client: TestClient) -> None:
    image_id = _register_image(client)
    create_item = _bbox_create("work_1", image_id)
    create_item["geometry"] = {"type": "bbox", "bbox": {"nx": 0.1, "ny": 0.1, "nw": 0, "nh": 0.2}}
    payload = _save_payload(image_id, creates=[create_item])

    response = client.post("/api/images/save-annotations", json=payload)
    assert response.status_code == 422


def test_save_annotations_unknown_image_returns_404(client: TestClient) -> None:
    payload = _save_payload("00000000-0000-0000-0000-000000000000")
    response = client.post("/api/images/save-annotations", json=payload)
    assert response.status_code == 404
    assert response.json()["success"] is False


def test_delete_annotation_success(client: TestClient) -> None:
    image_id = _register_image(client)
    create_payload = _save_payload(image_id, creates=[_bbox_create("work_1", image_id)])
    create_response = client.post("/api/images/save-annotations", json=create_payload)
    annotation_id = create_response.json()["created"][0]["id"]

    response = client.delete(f"/api/annotations/{annotation_id}")
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["id"] == annotation_id


def test_delete_annotation_unknown_id_returns_404(client: TestClient) -> None:
    response = client.delete("/api/annotations/00000000-0000-0000-0000-000000000000")
    assert response.status_code == 404
    assert response.json()["success"] is False


def test_list_annotations_for_image(client: TestClient) -> None:
    image_id = _register_image(client)
    payload = _save_payload(image_id, creates=[_bbox_create("work_1", image_id)])
    create_response = client.post("/api/images/save-annotations", json=payload)
    assert create_response.status_code == 200

    response = client.get(f"/api/images/{image_id}/annotations")
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert len(body["annotations"]) == 1
    ann = body["annotations"][0]
    assert ann["defectLabel"] == "Rayure profonde"
    assert ann["severity"] == "Critique"
    assert "id" in ann
    assert "geometry" in ann


def test_list_annotations_unknown_image_returns_404(client: TestClient) -> None:
    response = client.get("/api/images/00000000-0000-0000-0000-000000000000/annotations")
    assert response.status_code == 404
