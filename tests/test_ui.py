from playwright.sync_api import sync_playwright
import sys


def test_debug_page_content():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto("http://ui:4200")
        page.wait_for_timeout(5000)

        content = page.inner_text("body")

        print("\n===== PAGE CONTENT =====\n")
        print(content[:1000])
        print("\n========================\n")

        # ✅ force flush (IMPORTANT)
        sys.stdout.flush()

        browser.close()

        assert True
