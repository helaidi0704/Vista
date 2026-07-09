class MainPage:

    def __init__(self, page):
        self.page = page

    def go(self):
        self.page.goto("http://ui:4200")

        # attendre que la page ait du contenu
        self.page.wait_for_function(
            "() => document.body.innerText.length > 100"
        )

    def is_loaded(self):
        return self.page.evaluate("document.body.innerText.length") > 100

    def has_text(self, text):
        return text.lower() in self.page.inner_text("body").lower()
