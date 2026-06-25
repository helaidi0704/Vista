import os
from playwright.sync_api import sync_playwright

BASE_URL = os.getenv("BASE_URL", "http://localhost:4200")
TEST_IMAGE = "tests/sample.jpg"


def draw_polygon(page, canvas):
    box = canvas.bounding_box()

    if not box:
        raise Exception("Canvas non trouvé")

    x = box["x"] + 150
    y = box["y"] + 150

    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + 120, y, steps=10)
    page.mouse.move(x + 100, y + 80, steps=10)
    page.mouse.move(x + 40, y + 120, steps=10)
    page.mouse.up()


def test_annotation_complete():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        print("BASE_URL =", BASE_URL)

        # =========================
        # 1. HOME
        # =========================
        page.goto(BASE_URL)
        page.wait_for_selector("text=Visualiseur & Annotation")

        # =========================
        # 2. NAVIGATION
        # =========================
        page.click("text=Accéder")
        page.wait_for_timeout(3000)

        # =========================
        # 3. UPLOAD IMAGE ✅ (SEULE BONNE MÉTHODE)
        # =========================
        with page.expect_file_chooser() as fc_info:
            page.click("text=Importer")  # ⚠️ adapte si le texte change

        file_chooser = fc_info.value
        file_chooser.set_files(TEST_IMAGE)

        print("✅ Image uploadée")

        page.wait_for_timeout(5000)

        # =========================
        # 4. ACTIVER OUTIL DESSIN ✅
        # =========================
        page.locator("button").nth(1).click()
        page.wait_for_timeout(2000)

        # =========================
        # 5. CANVAS ✅
        # =========================
        page.wait_for_selector("canvas", timeout=20000)
        canvas = page.locator("canvas")

        # =========================
        # 6. DESSIN ✅
        # =========================
        draw_polygon(page, canvas)

        # =========================
        # 7. ANNOTATION ✅
        # =========================
        if page.locator("text=Rayure profonde").count():
            page.click("text=Rayure profonde")

        if page.locator("text=Majeur").count():
            page.click("text=Majeur")

        if page.locator("textarea").count():
            page.fill("textarea", "une rayure critique 3")

        # =========================
        # 8. SAVE ✅
        # =========================
        if page.locator("text=Enregistrer").count():
            page.click("text=Enregistrer")

        page.wait_for_timeout(3000)

        browser.close()

