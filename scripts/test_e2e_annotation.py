"""End-to-end test of all 4 VISTA annotation endpoints through the proxy."""
import json

import requests

BASE = "http://localhost:56752"
B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


def test_e2e() -> None:
    # 1. Register image
    print("=== 1. REGISTER IMAGE ===")
    r = requests.post(
        f"{BASE}/api/images",
        json={
            "id": "test_e2e",
            "name": "test.png",
            "src": f"data:image/png;base64,{B64}",
            "format": "PNG",
            "size": 68,
            "width": 1,
            "height": 1,
            "createdAt": "2026-01-01T00:00:00Z",
        },
    )
    assert r.status_code == 200, f"FAIL: {r.status_code}"
    img = r.json()
    img_id = img["savedImage"]["id"]
    print(f"  Image registered: id={img_id}")

    # 2. Save annotation
    print("=== 2. SAVE ANNOTATION ===")
    r = requests.post(
        f"{BASE}/api/images/save-annotations",
        json={
            "requestId": "req_e2e",
            "sentAt": "2026-01-01T00:00:00Z",
            "image": {
                "id": img_id,
                "name": "test.png",
                "format": "PNG",
                "width": 1,
                "height": 1,
                "createdAt": "2026-01-01T00:00:00Z",
            },
            "creates": [
                {
                    "workId": "work_e2e_1",
                    "imageId": img_id,
                    "defectLabel": "Rayure profonde",
                    "severity": "Critique",
                    "description": "Test bbox",
                    "shapeLabel": "BBox",
                    "geometry": {
                        "type": "bbox",
                        "bbox": {"nx": 0.45, "ny": 0.35, "nw": 0.15, "nh": 0.3},
                    },
                }
            ],
            "updates": [],
        },
    )
    assert r.status_code == 200, f"FAIL: {r.status_code}"
    save = r.json()
    ann_id = save["created"][0]["id"]
    print(f"  Annotation created: id={ann_id}")
    print(f"  createdWorkIds={save['createdWorkIds']}")

    # 3. Delete annotation
    print("=== 3. DELETE ANNOTATION ===")
    r = requests.delete(f"{BASE}/api/annotations/{ann_id}")
    assert r.status_code == 200, f"FAIL: {r.status_code}"
    print(f"  Annotation deleted: {r.json()['success']}")

    # 4. Delete image
    print("=== 4. DELETE IMAGE ===")
    r = requests.delete(f"{BASE}/api/images/{img_id}")
    assert r.status_code == 200, f"FAIL: {r.status_code}"
    print(f"  Image deleted: {r.json()['success']}")

    print()
    print("=== ALL 4 ENDPOINTS: PASS ===")


if __name__ == "__main__":
    test_e2e()
