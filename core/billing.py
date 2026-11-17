import base64, hashlib, hmac, json, urllib.parse, urllib.request
from datetime import timedelta
import io
import segno
from django.conf import settings
from django.db import transaction
from django.http import HttpResponse
from django.utils import timezone
from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from decimal import Decimal
from django.core import signing
from django.shortcuts import get_object_or_404, render
from django.db.models import F
from .models import Payment, RewardGrant, Subscription, get_sub
from .notify import push


@transaction.atomic
def mark_paid(pk, gateway_payment_id=""):
    p = Payment.objects.select_for_update().get(pk=pk)
    if p.status == "paid":
        return p  # idempotent (webhook + client verify can both arrive)
    p.status, p.payment_id = "paid", gateway_payment_id or p.payment_id
    p.invoice_no = f"LR/{timezone.now():%y}/{p.id:06d}"
    p.save()
    sub = get_sub(p.owner)
    now = timezone.now()
    old_end = sub.paid_until or sub.trial_ends
    lapse = max(timedelta(0), now - old_end)  # how long the shop was paused
    base = max(now, old_end)  # no back-charge for the gap, no overlap with trial
    sub.paid_until = base + timedelta(days=settings.PLANS[p.plan]["days"])
    sub.save()
    if lapse > timedelta(0):  # returning shop: keep customers whole, extend their reward dates by the paused time
        RewardGrant.objects.filter(profile__business__owner=p.owner, status="active", expires_at__gt=old_end).update(
            expires_at=F("expires_at") + lapse)
        push(p.owner, "Welcome back! Your shop is live again with all your customers and rewards.")
    from .vendors import accrue
    accrue(p)
    return p


def _plan(name):
    if name not in settings.PLANS:
        raise ValidationError("Unknown plan.")
    return settings.PLANS[name]


def upi_link(plan, owner_id):
    q = urllib.parse.urlencode({"pa": settings.PLATFORM_UPI_ID, "pn": settings.PLATFORM_UPI_NAME,
        "am": _plan(plan)["amount"] / 100, "cu": "INR", "tn": f"LOOP{owner_id}"})
    return "upi://pay?" + q


@api_view(["GET"])
def status(request):
    s = get_sub(request.user)
    end = s.paid_until or s.trial_ends
    return Response({"state": s.state, "ends": end, "grace_ends": end + timedelta(days=settings.GRACE_DAYS),
        "data_until": end + timedelta(days=settings.GRACE_DAYS + 30 * settings.RETENTION_MONTHS), "plans": settings.PLANS,
        "razorpay_key": settings.RAZORPAY_KEY_ID, "upi_id": settings.PLATFORM_UPI_ID,
        "owner_ref": request.user.id, "autopay": bool(settings.RAZORPAY_KEY_ID and any(settings.RZP_PLAN_IDS.values())),
        "autorenew": bool(s.rzp_sub_id),
        "invoices": [{"no": p.invoice_no, "url": "/invoice/" + signing.dumps(p.pk, salt="inv") + "/"}
                     for p in request.user.payments.filter(status="paid").order_by("-id")[:12]]})


@api_view(["POST"])
def create_order(request):
    plan = request.data.get("plan")
    amt = _plan(plan)["amount"]
    if not settings.RAZORPAY_KEY_ID:
        raise ValidationError("Online payment is not configured.")
    p = Payment.objects.create(owner=request.user, plan=plan, amount=amt, method="gateway")
    auth = base64.b64encode(f"{settings.RAZORPAY_KEY_ID}:{settings.RAZORPAY_KEY_SECRET}".encode()).decode()
    req = urllib.request.Request("https://api.razorpay.com/v1/orders",
        data=json.dumps({"amount": amt, "currency": "INR", "receipt": f"p{p.id}"}).encode(),
        headers={"Content-Type": "application/json", "Authorization": "Basic " + auth})
    p.order_id = json.load(urllib.request.urlopen(req, timeout=15))["id"]
    p.save()
    return Response({"order_id": p.order_id, "amount": amt, "key": settings.RAZORPAY_KEY_ID})


@api_view(["POST"])
def verify(request):
    d = request.data
    oid, pid, sig = d.get("razorpay_order_id", ""), d.get("razorpay_payment_id", ""), d.get("razorpay_signature", "")
    good = hmac.new(settings.RAZORPAY_KEY_SECRET.encode(), f"{oid}|{pid}".encode(), hashlib.sha256).hexdigest()
    p = Payment.objects.filter(order_id=oid, owner=request.user).first()
    if not p or not hmac.compare_digest(good, sig):
        raise ValidationError("Payment could not be verified.")
    mark_paid(p.pk, pid)
    return Response({"state": get_sub(request.user).state})


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([])  # never throttle the payment gateway
def webhook(request):
    """Razorpay -> us. Set events payment.captured / order.paid. Source of truth for payments."""
    sig = request.headers.get("X-Razorpay-Signature", "")
    good = hmac.new(settings.RAZORPAY_WEBHOOK_SECRET.encode(), request.body, hashlib.sha256).hexdigest()
    if not settings.RAZORPAY_WEBHOOK_SECRET or not hmac.compare_digest(good, sig):
        return HttpResponse(status=400)
    ev = json.loads(request.body)
    pay = ev.get("payload", {}).get("payment", {}).get("entity", {})
    if ev.get("event") in ("payment.captured", "order.paid") and pay.get("order_id"):
        p = Payment.objects.filter(order_id=pay["order_id"], amount=pay.get("amount")).first()
        if p:
            mark_paid(p.pk, pay.get("id", ""))
    if ev.get("event") in ("subscription.cancelled", "subscription.halted", "subscription.completed"):
        se = ev["payload"].get("subscription", {}).get("entity", {})
        for s in Subscription.objects.filter(rzp_sub_id=se.get("id", "x")).select_related("owner"):
            s.rzp_sub_id = ""
            s.save()
            if ev["event"] == "subscription.halted":
                push(s.owner, "Your auto-renew payment failed. Please renew from the dashboard to keep your shop live.")
    if ev.get("event") == "subscription.charged":  # auto-renew charge
        se = ev["payload"].get("subscription", {}).get("entity", {})
        sub = Subscription.objects.filter(rzp_sub_id=se.get("id", "x")).select_related("owner").first()
        plan = next((k for k, v in settings.RZP_PLAN_IDS.items() if v and v == se.get("plan_id")), None)
        if sub and plan and pay.get("id") and not Payment.objects.filter(payment_id=pay["id"]).exists():
            p = Payment.objects.create(owner=sub.owner, plan=plan, method="gateway", status="pending",
                amount=pay.get("amount") or settings.PLANS[plan]["amount"], order_id=pay.get("order_id") or "")
            mark_paid(p.pk, pay["id"])
    return HttpResponse("ok")


@api_view(["POST"])
def upi_submit(request):
    """Owner paid our UPI QR/ID and enters the 12-digit UTR; admin approves (Django admin action)."""
    plan, utr = request.data.get("plan"), str(request.data.get("utr", "")).strip()
    amt = _plan(plan)["amount"]
    if not (utr.isdigit() and len(utr) == 12):
        raise ValidationError("Enter the 12-digit UTR / transaction ID.")
    if Payment.objects.filter(utr=utr).exists():
        raise ValidationError("This transaction ID was already submitted.")
    Payment.objects.create(owner=request.user, plan=plan, amount=amt, method="upi", status="pending", utr=utr)
    return Response({"detail": "Submitted. Your plan activates after we confirm the payment."}, status=201)


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def upi_qr(request):
    buf = io.BytesIO()
    segno.make(upi_link(request.GET.get("plan"), int(request.GET.get("ref", 0) or 0)), error="m").save(
        buf, kind="png", scale=8, border=3)
    return HttpResponse(buf.getvalue(), content_type="image/png")


def invoice(request, token):
    try:
        pk = signing.loads(token, salt="inv")
    except signing.BadSignature:
        return HttpResponse(status=404)
    p = get_object_or_404(Payment, pk=pk, status="paid")
    gross = Decimal(p.amount) / 100
    base = (gross * 100 / (100 + settings.GST_RATE)).quantize(Decimal("0.01"))
    return render(request, "invoice.html", {"p": p, "seller": settings.SELLER, "rate": settings.GST_RATE,
                  "gross": gross, "base": base, "gst": gross - base})


def _rzp_post(path, body):
    auth = base64.b64encode(f"{settings.RAZORPAY_KEY_ID}:{settings.RAZORPAY_KEY_SECRET}".encode()).decode()
    req = urllib.request.Request("https://api.razorpay.com/v1/" + path, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Authorization": "Basic " + auth})
    return json.load(urllib.request.urlopen(req, timeout=15))


@api_view(["POST"])
def autopay(request):
    """Auto-renew via Razorpay Subscriptions (UPI AutoPay / cards). First charge happens after the trial/paid period."""
    plan = request.data.get("plan")
    _plan(plan)
    pid = settings.RZP_PLAN_IDS.get(plan)
    if not (settings.RAZORPAY_KEY_ID and pid):
        raise ValidationError("Auto-renew is not configured.")
    sub = get_sub(request.user)
    body = {"plan_id": pid, "total_count": 120 if plan == "monthly" else 10, "customer_notify": 1}
    start = sub.paid_until or sub.trial_ends
    if start > timezone.now() + timedelta(minutes=5):
        body["start_at"] = int(start.timestamp())
    sub.rzp_sub_id = _rzp_post("subscriptions", body)["id"]
    sub.save()
    return Response({"subscription_id": sub.rzp_sub_id, "key": settings.RAZORPAY_KEY_ID})


@api_view(["POST"])
def autopay_cancel(request):
    sub = get_sub(request.user)
    if sub.rzp_sub_id:
        _rzp_post(f"subscriptions/{sub.rzp_sub_id}/cancel", {"cancel_at_cycle_end": 1})
        sub.rzp_sub_id = ""
        sub.save()
    return Response({"detail": "Auto-renew cancelled."})
