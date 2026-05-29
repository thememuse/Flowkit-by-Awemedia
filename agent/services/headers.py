"""Headers for browser-proxied Google Flow requests."""


def random_headers() -> dict:
    """Return only app-level headers; browser fetch supplies fingerprint headers."""
    return {
        "accept": "*/*",
        "accept-language": "en-US,en;q=0.9",
        "content-type": "text/plain;charset=UTF-8",
        "referer": "https://labs.google/",
    }
