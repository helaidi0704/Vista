"""Complete 14-step live test: full annotation CRUD cycle."""
import requests

BASE = "http://127.0.0.1:8000"
B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

print("=== LIVE TEST: Full Annotation CRUD Cycle ===")
print()

# 1. CLEANUP existing test image
r = requests.get(f"{BASE}/api/images")
existing = [i for i in r.json()["images"] if i["name"] == "carter_moteur.png"]
if existing:
    print("1. CLEANUP: deleting existing carter_moteur.png")
    requests.delete(f"{BASE}/api/images/{existing[0]['id']}")
    print("   deleted")

# 2. REGISTER IMAGE
print("2. REGISTER IMAGE")
r = requests.post(f"{BASE}/api/images", json={
    "id": "live_test", "name": "live_test.png",
    "src": f"data:image/png;base64,{B64}", "format": "PNG",
    "size": 68, "width": 1, "height": 1, "createdAt": "2026-07-08T08:00:00Z"
})
assert r.status_code == 200, f"FAIL: {r.status_code}"
img = r.json()["savedImage"]
iid = img["id"]
print(f"   OK image_id={iid[:8]}...")

# 3. LIST IMAGES
print("3. LIST IMAGES")
r = requests.get(f"{BASE}/api/images")
imgs = r.json()["images"]
assert any(i["id"] == iid for i in imgs), "Image not in list"
print(f"   OK image found in list")

# 4. SAVE BBOX ANNOTATION
print("4. SAVE ANNOTATION (BBox, Critique, Rayure profonde)")
r = requests.post(f"{BASE}/api/images/save-annotations", json={
    "requestId": "live_1", "sentAt": "2026-07-08T08:00:00Z",
    "image": {"id": iid, "name": "t.png", "format": "PNG", "width": 1, "height": 1, "createdAt": "2026-07-08T08:00:00Z"},
    "creates": [{
        "workId": "live_w1", "imageId": iid, "defectLabel": "Rayure profonde",
        "severity": "Critique", "description": "Critical scratch",
        "shapeLabel": "BBox",
        "geometry": {"type": "bbox", "bbox": {"nx": 0.25, "ny": 0.3, "nw": 0.5, "nh": 0.4}}
    }], "updates": []
})
assert r.status_code == 200, f"FAIL: {r.status_code}"
s = r.json()
aid = s["created"][0]["id"]
print(f"   OK ann_id={aid[:8]}... created={s['createdWorkIds']}")

# 5. READ BACK
print("5. READ ANNOTATIONS FROM DB")
r = requests.get(f"{BASE}/api/images/{iid}/annotations")
assert r.status_code == 200
anns = r.json()["annotations"]
assert len(anns) == 1
a = anns[0]
assert a["defectLabel"] == "Rayure profonde"
assert a["severity"] == "Critique"
assert a["geometryType"] == "bbox"
assert abs(a["geometry"]["bbox"]["nw"] - 0.5) < 0.001
print(f"   OK {a['defectLabel']} / {a['severity']} / bbox verified")

# 6. UPDATE (severity change)
print("6. UPDATE ANNOTATION (Majeur)")
r = requests.post(f"{BASE}/api/images/save-annotations", json={
    "requestId": "live_2", "sentAt": "2026-07-08T08:01:00Z",
    "image": {"id": iid, "name": "t.png", "format": "PNG", "width": 1, "height": 1, "createdAt": "2026-07-08T08:00:00Z"},
    "creates": [], "updates": [{
        "id": aid, "workId": "live_w1_upd", "imageId": iid,
        "defectLabel": "Rayure profonde", "severity": "Majeur",
        "description": "Updated", "shapeLabel": "BBox",
        "geometry": {"type": "bbox", "bbox": {"nx": 0.25, "ny": 0.3, "nw": 0.5, "nh": 0.4}}
    }]
})
assert r.status_code == 200
print(f"   OK updatedWorkIds={r.json()['updatedWorkIds']}")

# 7. VERIFY UPDATE
print("7. VERIFY UPDATE PERSISTED")
r = requests.get(f"{BASE}/api/images/{iid}/annotations")
assert r.json()["annotations"][0]["severity"] == "Majeur"
print("   OK severity=Majeur")

# 8. SAVE SECOND ANNOTATION (polygon)
print("8. SAVE SECOND ANNOTATION (Polygon, Mineur)")
r = requests.post(f"{BASE}/api/images/save-annotations", json={
    "requestId": "live_3", "sentAt": "2026-07-08T08:02:00Z",
    "image": {"id": iid, "name": "t.png", "format": "PNG", "width": 1, "height": 1, "createdAt": "2026-07-08T08:00:00Z"},
    "creates": [{
        "workId": "live_w2", "imageId": iid, "defectLabel": "Fissure (micro)",
        "severity": "Mineur", "description": "Minor fissure", "shapeLabel": "Polygon",
        "geometry": {"type": "polygon", "polygon": {
            "points": [{"nx": 0.38, "ny": 0.35}, {"nx": 0.42, "ny": 0.45}, {"nx": 0.4, "ny": 0.55}],
            "closed": True}}
    }], "updates": []
})
assert r.status_code == 200
aid2 = r.json()["created"][0]["id"]
print(f"   OK ann_id={aid2[:8]}...")

# 9. VERIFY 2 ANNOTATIONS
print("9. VERIFY 2 ANNOTATIONS")
r = requests.get(f"{BASE}/api/images/{iid}/annotations")
anns = r.json()["annotations"]
assert len(anns) == 2
for a in anns:
    print(f"   - {a['defectLabel']} ({a['severity']}) {a['geometryType']}")
print(f"   OK {len(anns)} total")

# 10. DELETE FIRST ANNOTATION
print("10. DELETE FIRST ANNOTATION")
r = requests.delete(f"{BASE}/api/annotations/{aid}")
assert r.status_code == 200 and r.json()["success"]
print("    OK")

# 11. VERIFY 1 REMAINING
print("11. VERIFY 1 REMAINING")
r = requests.get(f"{BASE}/api/images/{iid}/annotations")
assert len(r.json()["annotations"]) == 1
print("    OK 1 annotation")

# 12. DELETE IMAGE (cascade)
print("12. DELETE IMAGE")
r = requests.delete(f"{BASE}/api/images/{iid}")
assert r.status_code == 200 and r.json()["success"]
print("    OK")

# 13. VERIFY IMAGE GONE
print("13. VERIFY IMAGE GONE")
r = requests.get(f"{BASE}/api/images")
assert not any(i["id"] == iid for i in r.json()["images"])
print("    OK")

# 14. VERIFY CASCADE
print("14. VERIFY ANNOTATIONS CASCADE-DELETED")
r = requests.get(f"{BASE}/api/images/{iid}/annotations")
assert r.status_code == 404
print("    OK 404 (gone)")

print()
print("=== ALL 14 LIVE TEST STEPS PASSED ===")
