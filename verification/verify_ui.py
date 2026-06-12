from playwright.sync_api import sync_playwright
import time

def verify_dice_roll_request():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1280, 'height': 800})
        page = context.new_page()

        print("Navigating to DiceTest page...")
        page.goto("http://localhost:3000/app/dice-test")

        # Give it some time to load/redirect
        time.sleep(5)

        print(f"Current URL: {page.url}")

        page.screenshot(path="verification/dice_test_page_v2.png")
        print("Screenshot saved to verification/dice_test_page_v2.png")

        browser.close()

if __name__ == "__main__":
    verify_dice_roll_request()
