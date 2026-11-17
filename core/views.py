import io
import segno
from urllib.parse import urlencode
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django.db.models import Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from .throttles import AuthThrottle
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from . import services
from .models import (Vendor, Business, CustomerProfile, Program, PurchaseEntry, Reward, Task, User,
                     new_shop_code)
from .serializers import BusinessSerializer, EntrySerializer, ProgramSerializer


def _mgr_only(user):
    if user.role not in ("owner", "staff"):
        raise PermissionDenied("Owner or staff account required.")


def _owner_only(user):
    if user.role != "owner":
        raise PermissionDenied("Owner account required.")


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([AuthThrottle])
def register(request):
    d = request.data
    mobile, pw = str(d.get("mobile", "")).strip(), d.get("password", "")
    if not mobile.isdigit() or len(mobile) < 10 or len(pw) < 6:
        raise ValidationError("Valid mobile and 6+ char password required.")
    if User.objects.filter(username=mobile).exists():
        raise ValidationError("Mobile already registered.")
    role = d.get("role") if d.get("role") in ("owner", "vendor") else "customer"
    if str(d.get("accepted")).lower() not in ("true", "1", "on"):
        raise ValidationError("Please accept the Terms and Privacy Policy.")
    ref = Vendor.objects.filter(code=str(d.get("ref", "")).upper(), status="approved").first() if role == "owner" else None
    u = User.objects.create_user(username=mobile, password=pw, first_name=d.get("name", ""), role=role, referred_by=ref, consent_at=timezone.now())
    return Response({"token": Token.objects.create(user=u).key, "role": role}, status=201)


@api_view(["POST"])
def create_business(request):
    _owner_only(request.user)
    upi = request.data.get("pay_upi_id")
    if upi and Business.objects.filter(pay_upi_id=upi).exists():
        raise ValidationError("This UPI ID is already registered.")
    s = BusinessSerializer(data=request.data)
    s.is_valid(raise_exception=True)
    return Response(BusinessSerializer(s.save(owner=request.user)).data, status=201)


@api_view(["POST"])
def regenerate_qr(request, code):
    biz = get_object_or_404(Business, shop_code=code, owner=request.user)
    biz.shop_code = new_shop_code()
    biz.save()
    return Response({"shop_code": biz.shop_code})


@api_view(["POST"])
@transaction.atomic
def create_program(request, code):
    """Body: {title, tasks:[{title,type,target,item_name,repeatable,max_per_customer,
    rewards:[{title,type,value,expiry_days,terms}]}]}"""
    biz = get_object_or_404(Business, shop_code=code, owner=request.user)
    d = request.data
    prog = Program.objects.create(business=biz, title=d.get("title", "Rewards"))
    for t in d.get("tasks", []):
        rewards = t.pop("rewards", [])
        task = Task.objects.create(program=prog, **{k: t[k] for k in t if k in
            ("title", "type", "target", "item_name", "repeatable", "max_per_customer")})
        for r in rewards:
            Reward.objects.create(task=task, **{k: r[k] for k in r if k in
                ("title", "type", "value", "expiry_days", "terms")})
    return Response(ProgramSerializer(prog).data, status=201)


@api_view(["GET"])
@permission_classes([AllowAny])
def public_business(request, code):
    """Landing page data for the scanned QR: profile, active programs, Pay link."""
    biz = get_object_or_404(Business, shop_code=code)
    if not biz.is_live:
        return Response({"name": biz.name, "paused": True})
    data = BusinessSerializer(biz).data
    today = timezone.localdate()
    active_programs = biz.programs.filter(active=True).filter(
        Q(start__isnull=True) | Q(start__lte=today)
    ).filter(Q(end__isnull=True) | Q(end__gte=today))
    data["programs"] = ProgramSerializer(active_programs, many=True).data
    if biz.pay_upi_id:
        data["pay_link"] = "upi://pay?" + urlencode({"pa": biz.pay_upi_id, "pn": biz.name, "cu": "INR"})
    return Response(data)


@api_view(["GET"])
@permission_classes([AllowAny])
def business_qr(request, code):
    biz = get_object_or_404(Business, shop_code=code)
    buf = io.BytesIO()
    segno.make(f"{settings.BASE_URL}/b/{biz.shop_code}", error="m").save(buf, kind="png", scale=10, border=4)
    return HttpResponse(buf.getvalue(), content_type="image/png")


@api_view(["POST"])
def join(request, code):
    biz = get_object_or_404(Business, shop_code=code)
    if not biz.is_live:
        raise ValidationError("This shop is paused.")
    p, _ = CustomerProfile.objects.get_or_create(user=request.user, business=biz)
    if "consent" in request.data:
        p.marketing_consent = bool(request.data["consent"])
        p.save()
    return Response({"profile": p.id}, status=201)


@api_view(["POST"])
def submit_entry(request):
    task = get_object_or_404(Task, pk=request.data.get("task"))
    profile = get_object_or_404(CustomerProfile, user=request.user, business=task.program.business)
    e = services.submit_entry(profile, task, request.data.get("value", 1), request.FILES.get("bill_photo"), request.data.get("counter_code", ""),
                             _f(request.data.get("lat")), _f(request.data.get("lng")))
    return Response(EntrySerializer(e).data, status=201)


@api_view(["GET"])
def pending(request):
    _mgr_only(request.user)
    qs = PurchaseEntry.objects.filter(status="pending").filter(
        Q(profile__business__owner=request.user) | Q(profile__business__staff__user=request.user))
    return Response(EntrySerializer(qs.order_by("created_at"), many=True).data)


@api_view(["POST"])
def review(request, pk):
    _mgr_only(request.user)
    entry = get_object_or_404(PurchaseEntry, pk=pk)  # services.review_entry enforces owner/staff of that shop
    e = services.review_entry(entry, request.user, approve=request.data.get("action") == "approve")
    return Response(EntrySerializer(e).data)


@api_view(["POST"])
def redeem(request):
    _mgr_only(request.user)
    g = services.redeem(request.data.get("code", ""), request.user)
    return Response({"status": g.status, "reward": g.reward.title})


@api_view(["GET"])
def my_shops(request):
    out = []
    for p in request.user.profiles.select_related("business"):
        out.append({
            "shop": p.business.name, "shop_code": p.business.shop_code, "consent": p.marketing_consent,
            "progress": [{"task_id": t.task_id, "task": t.task.title, "current": t.current_value, "target": t.target or t.task.target,
                          "completed": t.completed_count} for t in p.progress.select_related("task")],
            "rewards": [{"title": g.reward.title, "code": g.code, "status": g.status,
                         "expires_at": g.expires_at} for g in p.grants.select_related("reward")],
        })
    return Response(out)


from django.contrib.auth import authenticate


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([AuthThrottle])
def login(request):
    u = authenticate(username=request.data.get("username"), password=request.data.get("password"))
    if not u:
        raise ValidationError("Wrong mobile or password.")
    return Response({"token": Token.objects.get_or_create(user=u)[0].key, "role": u.role, "needs_consent": u.consent_at is None})


@api_view(["GET"])
def my_businesses(request):
    _mgr_only(request.user)
    out = []
    shops = request.user.businesses.all() if request.user.role == "owner" else [request.user.staff_of.business]
    for b in shops:
        d = BusinessSerializer(b).data
        d["programs"] = ProgramSerializer(b.programs.all(), many=True).data
        out.append(d)
    return Response(out)


from . import counter
from .models import StaffMember, can_manage


@api_view(["POST", "DELETE"])
def staff(request, code):
    biz = get_object_or_404(Business, shop_code=code, owner=request.user)
    d, mobile = request.data, str(request.data.get("mobile", "")).strip()
    if request.method == "DELETE":
        User.objects.filter(username=mobile, staff_of__business=biz).delete()
        return Response(status=204)
    if not mobile.isdigit() or len(mobile) < 10 or len(d.get("password", "")) < 6 or User.objects.filter(username=mobile).exists():
        raise ValidationError("Valid unused mobile and 6+ char password required.")
    u = User.objects.create_user(username=mobile, password=d["password"], first_name=d.get("name", ""), role="staff")
    StaffMember.objects.create(user=u, business=biz)
    return Response({"mobile": mobile}, status=201)


@api_view(["GET"])
def counter_code(request, code):
    biz = get_object_or_404(Business, shop_code=code)
    if not can_manage(request.user, biz):
        raise PermissionDenied()
    c, left = counter.current(biz)
    return Response({"code": c, "expires_in": left})


@api_view(["GET"])
@permission_classes([AllowAny])
def counter_qr(request, code):
    """QR for the counter screen. Only renders for a currently valid code (the code itself is the secret)."""
    biz = get_object_or_404(Business, shop_code=code)
    c = request.GET.get("c", "")
    if counter.match(biz, c) is None:
        return HttpResponse(status=404)
    buf = io.BytesIO()
    segno.make(f"{settings.BASE_URL}/b/{biz.shop_code}/?c={c}", error="m").save(buf, kind="png", scale=8, border=3)
    return HttpResponse(buf.getvalue(), content_type="image/png")


def _f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None
