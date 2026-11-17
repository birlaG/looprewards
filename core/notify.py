import json, logging, threading, urllib.request
from django.conf import settings
log = logging.getLogger("notify")


def _post(url, payload):
    req = urllib.request.Request(url, method="POST", data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=10)
    except Exception:
        log.exception("notify failed")


def notify(user, text):
    """SMS/WhatsApp via your provider bridge (NOTIFY_WEBHOOK_URL). Fire-and-forget thread so requests never wait.
    At very large scale replace with a queue (Celery/RQ) so messages survive restarts."""
    log.info("NOTIFY %s: %s", user.username, text)
    if settings.NOTIFY_WEBHOOK_URL:
        threading.Thread(target=_post, args=(settings.NOTIFY_WEBHOOK_URL, {"mobile": user.username, "text": text}),
                         daemon=True).start()


def push(user, text, sms=False):
    """In-app notification (always); SMS/WhatsApp only for key alerts when NOTIFY_SMS=1."""
    from .models import Notification
    Notification.objects.create(user=user, text=text[:240])
    if sms and settings.NOTIFY_SMS:
        notify(user, text)
