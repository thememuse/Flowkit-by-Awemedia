from pathlib import Path

from agent.services.headers import random_headers


def test_random_headers_do_not_spoof_browser_fingerprint():
    headers = random_headers()

    assert headers == {
        "accept": "*/*",
        "accept-language": "en-US,en;q=0.9",
        "content-type": "text/plain;charset=UTF-8",
        "referer": "https://labs.google/",
    }

    forbidden = {
        "user-agent",
        "sec-ch-ua",
        "sec-ch-ua-mobile",
        "sec-ch-ua-platform",
        "x-client-data",
        "x-browser-validation",
    }
    assert forbidden.isdisjoint({k.lower() for k in headers})


def test_extension_does_not_emit_synthetic_telemetry():
    source = Path("extension/background.js").read_text()

    assert "batchLogFrontendEvents" not in source
    assert "v1:batchLog" not in source
    assert "sendTelemetry" not in source
