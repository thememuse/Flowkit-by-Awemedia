import threading

_lock = threading.Lock()
_cancelled_requests = set()

def cancel_request(request_id: str):
    """Mark a request ID as cancelled."""
    with _lock:
        _cancelled_requests.add(request_id)

def is_request_cancelled(request_id: str) -> bool:
    """Check if a request ID is marked as cancelled."""
    if not request_id:
        return False
    with _lock:
        return request_id in _cancelled_requests

def clear_cancelled_request(request_id: str):
    """Clean up a request ID once it has exited."""
    with _lock:
        _cancelled_requests.discard(request_id)
