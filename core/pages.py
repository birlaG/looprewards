import segno
from pathlib import Path
from django.conf import settings
from django.http import HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, render
from django.utils.safestring import mark_safe
from .models import Business

WEB = Path(__file__).parent / "web"
SIZES = {"a6": ("105mm 148mm", 1), "a5": ("148mm 210mm", 1), "a4": ("210mm 297mm", 1),
         "tent": ("210mm 297mm", 2)}  # tent: A4 folded in half, top panel upside-down


def shell(request, code=None):
    return HttpResponse((WEB / "app.html").read_text(), content_type="text/html")


def print_card(request, code):
    """Counter / reception-desk card: shop profile + QR only (no bills)."""
    b = get_object_or_404(Business, shop_code=code)
    if b.sub_state == "expired":
        return HttpResponse("Subscription expired. Renew to download the print kit.", status=402)
    size = request.GET.get("size", "a6")
    page, reps = SIZES.get(size, SIZES["a6"])
    bw = request.GET.get("bw") == "1"
    qr = segno.make(f"{settings.BASE_URL}/b/{b.shop_code}", error="m").svg_inline(
        scale=6, border=2, dark="#000", light="#fff")
    return render(request, "print.html", {"b": b, "qr": mark_safe(qr), "page": page, "size": size,
                  "panels": range(reps), "bw": bw, "tent": size == "tent",
                  "lang_hi": b.language == "hi" or request.GET.get("lang") == "hi"})


def healthz(request):
    from django.db import connection
    connection.cursor().execute("SELECT 1")
    return HttpResponse("ok")


def manifest(request):
    return JsonResponse({"name": "LoopRewards", "short_name": "Rewards", "start_url": "/app/",
        "display": "standalone", "background_color": "#ffffff", "theme_color": "#0f766e",
        "icons": [{"src": "/icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any"}]})


def sw(request):
    return HttpResponse("self.addEventListener('install',()=>self.skipWaiting());"
                        "self.addEventListener('fetch',()=>{});", content_type="application/javascript")


def icon(request):
    return HttpResponse('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" '
        'height="100" rx="20" fill="#0f766e"/><circle cx="50" cy="50" r="24" fill="none" stroke="#fff" '
        'stroke-width="10"/></svg>', content_type="image/svg+xml")
