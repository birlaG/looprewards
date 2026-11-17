import csv
from datetime import timedelta
from django.core import signing
from django.db.models import Count, Max, Q
from django.db.models.functions import ExtractHour
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.decorators import api_view
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from .models import Business, CustomerProfile, Notification, PurchaseEntry, RewardGrant


def _customers(biz):
    ok = Q(entries__status="approved")
    return CustomerProfile.objects.filter(business=biz).select_related("user").annotate(
        visits=Count("entries", filter=ok), last=Max("entries__created_at", filter=ok))


@api_view(["GET"])
def report(request, code):
    biz = get_object_or_404(Business, shop_code=code)
    if biz.owner_id != request.user.id:
        raise PermissionDenied()
    cs = list(_customers(biz))
    buyers = [c for c in cs if c.visits >= 1]
    entries = PurchaseEntry.objects.filter(profile__business=biz, status="approved")
    hours = entries.annotate(h=ExtractHour("created_at")).values("h").annotate(n=Count("id")).order_by("-n")[:3]
    grants = RewardGrant.objects.filter(profile__business=biz)
    today = timezone.localdate()
    return Response({
        "customers": len(cs),
        "repeat_rate": round(100 * sum(c.visits >= 2 for c in buyers) / len(buyers)) if buyers else 0,
        "top": [{"name": c.user.first_name or c.user.username[-4:], "visits": c.visits}
                for c in sorted(buyers, key=lambda c: -c.visits)[:5]],
        "rewards_issued": grants.count(), "rewards_redeemed": grants.filter(status="used").count(),
        "peak_hours": [{"hour": h["h"], "count": h["n"]} for h in hours],
        "approved_today": entries.filter(created_at__date=today).count(),
        "csv_url": "/export/" + signing.dumps(biz.id, salt="csv") + "/",  # short-lived signed link
    })


def export_csv(request, token):
    try:
        biz = get_object_or_404(Business, pk=signing.loads(token, salt="csv", max_age=600))
    except signing.BadSignature:
        return HttpResponse("Link expired. Reload the dashboard.", status=403)
    safe = lambda v: ("'" + str(v)) if str(v)[:1] in "=+-@" else str(v)  # CSV formula-injection guard
    r = HttpResponse(content_type="text/csv")
    r["Content-Disposition"] = f'attachment; filename="{biz.shop_code}-customers.csv"'
    w = csv.writer(r)
    w.writerow(["name", "mobile", "visits", "last_visit", "joined"])
    for c in _customers(biz).order_by("-visits"):
        w.writerow([safe(c.user.first_name), safe(c.user.username), c.visits,
                    c.last.date() if c.last else "", c.joined_at.date()])
    return r


@api_view(["GET"])
def notifications(request):
    return Response(list(request.user.notifications.order_by("-id").values("text", "read", "created_at")[:20]))


@api_view(["POST"])
def notifications_read(request):
    request.user.notifications.filter(read=False).update(read=True)
    return Response(status=204)
