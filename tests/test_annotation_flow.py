import os
from playwright.sync_api import sync_playwright

BASE_URL = os.getenv("BASE_URL", "http://localhost:4201")
TEST_IMAGE = "tests/sample.jpg"

os.makedirs("tests/screenshots", exist_ok=True)


# =========================
# TOOL SELECTOR ✅ (SVG BASED)
# =========================
def select_tool_rect(page):
    page.locator("button:has(svg rect)").first.click()
    print("✅ Rectangle tool")


def select_tool_line(page):
    page.locator("button:has(svg path)").nth(1).click()
    print("✅ Line tool")


def select_tool_polygon(page):
    page.locator("button:has(svg path)").first.click()
    print("✅ Polygon tool")


# =========================
# DRAW
# =========================
def draw_polygon(page, canvas):
    box = canvas.bounding_box()
    x, y = box["x"] + 150, box["y"] + 150

    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + 120, y)
    page.mouse.move(x + 80, y + 100)
    page.mouse.move(x + 30, y + 80)
    page.mouse.up()


def draw_line(page, canvas):
    box = canvas.bounding_box()
    x, y = box["x"] + 200, box["y"] + 200

    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + 200, y + 50)
    page.mouse.up()


def draw_rectangle(page, canvas):
    box = canvas.bounding_box()
    x, y = box["x"] + 250, box["y"] + 150

    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + 100, y)
    page.mouse.move(x + 100, y + 100)
    page.mouse.move(x, y + 100)
    page.mouse.move(x, y)
    page.mouse.up()


# =========================
# ANNOTATION
# =========================
def annotate_and_save(page, description, severity, filename):

    page.locator("textarea").fill(description)

    page.click(f"text={severity}")

    if page.locator("text=Enregistrer les modifications").count():
        page.click("text=Enregistrer les modifications")
    else:
        page.click("text=Enregistrer")

    print(f"✅ saved: {severity}")

    page.wait_for_timeout(2000)

    page.screenshot(path=f"tests/screenshots/{filename}")
    print(f"✅ screenshot: {filename}")


# =========================
# TEST
# =========================
def test_annotation_complete():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(BASE_URL)
        page.wait_for_selector("text=Visualiseur & Annotation")

        page.click("text=Visualiseur & Annotation")
        page.wait_for_timeout(5000)

        page.click("text=Importer image")
        page.wait_for_timeout(1000)

        page.locator("input[type=file]").set_input_files(TEST_IMAGE)
        page.wait_for_timeout(5000)

        canvas = page.locator("canvas").nth(1)
        canvas.wait_for(state="visible")

        print("✅ canvas ready")

        # =========================
        # 1 POLYGON
        # =========================
        select_tool_polygon(page)
        draw_polygon(page, canvas)

        annotate_and_save(
            page,
            "Défaut critique complexe",
            "Critique",
            "01_polygon.png"
        )

        # =========================
        # 2 LINE
        # =========================
        select_tool_line(page)
        draw_line(page, canvas)

        annotate_and_save(
            page,
            "Fissure importante",
            "Majeur",
            "02_line.png"
        )

        # =========================
        # 3 RECTANGLE
        # =========================
        select_tool_rect(page)
        draw_rectangle(page, canvas)

        annotate_and_save(
            page,
            "Zone mineure",
            "Mineur",
            "03_rectangle.png"
        )

        browser.close()
