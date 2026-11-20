import hashlib, secrets
from datetime import timedelta
from django.conf import settings
from django.db import transaction
from django.db.models import Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from .throttles import AuthThrottle
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from . import services
from .models import (AuditLog, Business, CustomerProfile, OtpCode, Payment, Program, PurchaseEntry, RewardGrant,
                     Subscription, Task, TaskProgress, User, Vendor)
from .notify import notify, push
from .serializers import BusinessSerializer, CustomerProfileImageSerializer, EntrySerializer


@api_view(["PATCH"])
def business_settings(request, code):
    biz = get_object_or_404(Business, shop_code=code, owner=request.user)
    upi = request.data.get("pay_upi_id")
    if upi and Business.objects.filter(pay_upi_id=upi).exclude(pk=biz.pk).exists():
        raise ValidationError("This UPI ID is already registered.")
    s = BusinessSerializer(biz, data=request.data, partial=True)
    s.is_valid(raise_exception=True)
    s.save()
    return Response(s.data)


@api_view(["PATCH", "DELETE"])
@transaction.atomic
def program_update(request, pk):  # pause / resume / end / rename
    pr = get_object_or_404(Program.objects.select_for_update(), pk=pk, business__owner=request.user)
    archived = AuditLog.objects.filter(
        business=pr.business, action="program_archived", ref=str(pr.pk)
    ).exists()
    if request.method == "DELETE":
        if archived:
            return Response({"archived": True, "detail": "This program is already archived."})
        task_ids = pr.tasks.values_list("id", flat=True)
        has_customer_data = (
            PurchaseEntry.objects.filter(task_id__in=task_ids).exists()
            or TaskProgress.objects.filter(task_id__in=task_ids).exists()
            or RewardGrant.objects.filter(reward__task_id__in=task_ids).exists()
        )
        if has_customer_data:
            pr.active = False
            pr.end = timezone.localdate() - timedelta(days=1)
            pr.save(update_fields=["active", "end"])
            AuditLog.objects.create(
                business=pr.business, actor=request.user, action="program_archived", ref=str(pr.pk)
            )
            return Response({
                "archived": True,
                "detail": "This program has customer history, so it was archived. Existing progress and reward codes are preserved.",
            })
        pr.delete()
        return Response({"archived": False, "detail": "Program deleted."})
    if archived and request.data.get("active") is True:
        raise ValidationError("Archived programs cannot be resumed. Create a new program instead.")
    for k in ("title", "active", "start", "end"):
        if k in request.data:
            setattr(pr, k, request.data[k])
    pr.save()
    return Response({"active": pr.active})


@api_view(["PATCH"])
def task_update(request, pk):
    """Edits never hurt in-progress customers: their TaskProgress keeps the target it started with."""
    t = get_object_or_404(Task, pk=pk, program__business__owner=request.user)
    for k in ("title", "target", "item_name", "repeatable", "max_per_customer"):
        if k in request.data:
            setattr(t, k, request.data[k])
    t.version += 1
    t.save()
    return Response({"version": t.version})


@api_view(["POST"])
def reverse(request, pk):
    e = services.reverse_entry(get_object_or_404(PurchaseEntry, pk=pk), request.user)
    return Response(EntrySerializer(e).data)


@api_view(["GET"])
def recent(request):
    from django.db.models import Q
    qs = PurchaseEntry.objects.filter(status="approved").filter(
        Q(profile__business__owner=request.user) | Q(profile__business__staff__user=request.user)).order_by("-id")[:8]
    return Response(EntrySerializer(qs, many=True).data)


@api_view(["POST"])
def block(request, code, pid):
    biz = get_object_or_404(Business, shop_code=code, owner=request.user)
    p = get_object_or_404(CustomerProfile, pk=pid, business=biz)
    p.status = "blocked" if request.data.get("blocked", True) else "active"
    p.save()
    return Response({"status": p.status})


@api_view(["POST"])
def broadcast(request, code):
    """Offer to customers who opted in (marketing consent). Max one per 24h per shop."""
    biz = get_object_or_404(Business, shop_code=code, owner=request.user)
    text = str(request.data.get("text", "")).strip()[:200]
    if not text:
        raise ValidationError("Write the offer text.")
    if AuditLog.objects.filter(business=biz, action="broadcast", at__gte=timezone.now() - timedelta(hours=24)).exists():
        raise ValidationError("You can send one offer per day.")
    users = [p.user for p in biz.customers.filter(marketing_consent=True, status="active").select_related("user")]
    for u in users:
        push(u, f"{biz.name}: {text}")
    AuditLog.objects.create(business=biz, actor=request.user, action="broadcast", ref=str(len(users)))
    return Response({"sent": len(users)})


@api_view(["DELETE"])
def delete_me(request):
    """DPDP erasure. Customers are deleted; owners/vendors are anonymised (invoices/commissions must be retained)."""
    u = request.user
    if u.role == "customer":
        u.delete()
    else:
        Token.objects.filter(user=u).delete()
        u.is_active, u.username, u.first_name = False, f"deleted-{u.id}", ""
        u.set_unusable_password()
        u.save()
        u.businesses.update(status="closed")
        if hasattr(u, "vendor"):
            u.vendor.status = "suspended"
            u.vendor.save(update_fields=["status"])
    return Response(status=204)


@api_view(["GET", "PATCH", "DELETE"])
def profile_image(request):
    if request.user.role != "customer":
        raise PermissionDenied("Customer account required.")
    user = request.user
    if request.method == "GET":
        return Response({"profile_image_url": user.profile_image.url if user.profile_image else ""})
    if request.method == "DELETE":
        if user.profile_image:
            user.profile_image.delete(save=False)
            user.profile_image = ""
            user.save(update_fields=["profile_image"])
        return Response({"profile_image_url": ""})
    serializer = CustomerProfileImageSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    previous_name = user.profile_image.name
    user.profile_image = serializer.validated_data["profile_image"]
    user.save(update_fields=["profile_image"])
    if previous_name and previous_name != user.profile_image.name:
        user.profile_image.storage.delete(previous_name)
    return Response({"profile_image_url": user.profile_image.url})


def _h(code):
    return hashlib.sha256((code + settings.SECRET_KEY).encode()).hexdigest()


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([AuthThrottle])
def otp_request(request):
    u = User.objects.filter(username=str(request.data.get("mobile", "")).strip(), is_active=True).first()
    if u and not OtpCode.objects.filter(user=u, created_at__gte=timezone.now() - timedelta(seconds=60)).exists():
        code = f"{secrets.randbelow(10**6):06d}"
        OtpCode.objects.create(user=u, code_hash=_h(code), expires=timezone.now() + timedelta(minutes=10))
        notify(u, f"Firaao OTP {code}. Valid for 10 minutes. Do not share it.")
    return Response({"detail": "If the number is registered, an OTP was sent."})  # same answer either way


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([AuthThrottle])
def otp_confirm(request):
    u = User.objects.filter(username=str(request.data.get("mobile", "")).strip(), is_active=True).first()
    o = OtpCode.objects.filter(user=u, expires__gt=timezone.now()).order_by("-id").first() if u else None
    new = request.data.get("new", "")
    if not o or o.attempts >= 5 or len(new) < 6:
        raise ValidationError("Wrong or expired OTP.")
    if o.code_hash != _h(str(request.data.get("otp", "")).strip()):
        o.attempts += 1; o.save()
        raise ValidationError("Wrong or expired OTP.")
    u.set_password(new); u.save()
    OtpCode.objects.filter(user=u).delete()
    Token.objects.filter(user=u).delete()  # sign out other devices
    return Response({"detail": "Password changed."})


@api_view(["POST"])
def accept_terms(request):
    request.user.consent_at = timezone.now()
    request.user.save(update_fields=["consent_at"])
    return Response(status=204)


@api_view(["GET"])
def admin_stats(request):
    if not request.user.is_staff:
        raise PermissionDenied()
    states = {}
    for s in Subscription.objects.all():
        states[s.state] = states.get(s.state, 0) + 1
    rev = Payment.objects.filter(status="paid", created_at__gte=timezone.now() - timedelta(days=30)).aggregate(t=Sum("amount"))["t"] or 0
    return Response({"shops": Business.objects.count(), "subscriptions": states, "revenue_30d_rupees": rev / 100,
        "customers": User.objects.filter(role="customer").count(),
        "entries_today": PurchaseEntry.objects.filter(created_at__date=timezone.localdate()).count(),
        "vendors_pending": Vendor.objects.filter(status="pending").count()})
