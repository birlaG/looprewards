import secrets
from datetime import timedelta
from decimal import Decimal
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework.decorators import api_view
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from .models import Business, Commission, Payment, User, Vendor, get_sub, new_shop_code


def accrue(p):
    """Called when a payment is marked paid. Never on trials; single level; idempotent."""
    v = p.owner.referred_by
    if not v or v.status != "approved" or v.user_id == p.owner_id:
        return
    if p.owner.businesses.filter(pay_upi_id=v.upi_id).exists():  # self-referral guard
        return
    if settings.COMMISSION_FIRST_YEAR_ONLY:
        first = p.owner.payments.filter(status="paid").order_by("id").first()
        if first and (p.created_at - first.created_at).days >= 365:
            return
    base = Decimal(p.amount) * 100 / (100 + settings.GST_RATE)  # paise ex-GST
    Commission.objects.get_or_create(payment=p, defaults={
        "vendor": v, "rate": v.rate, "amount": int(base * v.rate / 100),
        "payable_on": timezone.now() + timedelta(days=settings.COMMISSION_HOLD_DAYS)})


def reverse(p):  # refunded payment -> commission reversed unless already in a payout
    Commission.objects.filter(payment=p, status__in=("hold",)).update(status="reversed")


def _vendor(request, approved=True):
    v = getattr(request.user, "vendor", None)
    if not v or (approved and v.status != "approved"):
        raise PermissionDenied("Approved vendor account required.")
    return v


@api_view(["POST"])
def apply(request):
    pan, upi = str(request.data.get("pan", "")).upper().strip(), str(request.data.get("upi_id", "")).strip()
    if len(pan) != 10 or "@" not in upi:
        raise ValidationError("Valid 10-character PAN and UPI ID required.")
    if request.user.role != "vendor" or hasattr(request.user, "vendor"):
        raise ValidationError("Not allowed.")
    Vendor.objects.create(user=request.user, code=new_shop_code().upper(), pan=pan, upi_id=upi)
    return Response({"detail": "Submitted for approval."}, status=201)


@api_view(["GET"])
def dashboard(request):
    v = _vendor(request, approved=False)
    out = {"status": v.status, "code": v.code, "rate": v.rate}
    if v.status != "approved":
        return Response(out)
    tot = {}
    for c in v.commissions.all():
        tot[c.status] = tot.get(c.status, 0) + c.amount
    out["commission_paise"] = tot
    out["payouts"] = [{"amount": x.amount, "status": x.status, "date": x.created_at.date()} for x in v.payouts.all()[:12]]
    out["businesses"] = [{"name": b.name, "state": get_sub(u).state, "until": (get_sub(u).paid_until or get_sub(u).trial_ends)}
                         for u in v.referrals.all() for b in u.businesses.all()]  # no customer data, no passwords
    return Response(out)


@api_view(["POST"])
@transaction.atomic
def assist(request):
    """Assisted registration: vendor creates the owner account + shop, owner gets the temp password."""
    v, d = _vendor(request), request.data
    mobile = str(d.get("mobile", "")).strip()
    if not mobile.isdigit() or len(mobile) < 10 or User.objects.filter(username=mobile).exists():
        raise ValidationError("Valid, unused owner mobile required.")
    upi = d.get("pay_upi_id", "")
    if upi and Business.objects.filter(pay_upi_id=upi).exists():
        raise ValidationError("This UPI ID is already registered.")
    tmp = secrets.token_urlsafe(6)
    u = User.objects.create_user(username=mobile, password=tmp, first_name=d.get("owner_name", ""),
                                 role="owner", referred_by=v)
    Business.objects.create(owner=u, name=d.get("name", "My Shop"), category=d.get("category", "other"),
                            address=d.get("address", ""), pay_upi_id=upi)
    return Response({"mobile": mobile, "temp_password": tmp}, status=201)


@api_view(["POST"])
def change_password(request):
    if not request.user.check_password(request.data.get("old", "")) or len(request.data.get("new", "")) < 6:
        raise ValidationError("Wrong old password or new password too short.")
    request.user.set_password(request.data["new"])
    request.user.save()
    return Response({"detail": "Changed."})
