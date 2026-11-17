"""Business rules: submit / review purchases, progress, reward grants, redemption."""
from datetime import timedelta
from decimal import Decimal
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError
from . import counter
from .notify import push
from .models import AuditLog, CodeUse, PurchaseEntry, RewardGrant, TaskProgress, can_manage


def _log(business, actor, action, ref=""):
    AuditLog.objects.create(business=business, actor=actor, action=action, ref=str(ref))


@transaction.atomic
def submit_entry(profile, task, value, bill_photo=None, counter_code="", lat=None, lng=None):
    biz = profile.business
    if profile.status == "blocked":
        raise PermissionDenied("You cannot earn rewards at this shop.")
    if not biz.is_live or not task.program.active or task.program.business_id != biz.id:
        raise ValidationError("This offer is not active.")
    now = timezone.now()
    mine = PurchaseEntry.objects.filter(profile=profile).exclude(status="rejected")
    last = mine.order_by("-created_at").first()
    if last and now - last.created_at < timedelta(minutes=biz.cooldown_minutes):
        raise ValidationError(f"Please wait {biz.cooldown_minutes} minutes between entries.")
    if mine.filter(created_at__date=timezone.localdate()).count() >= biz.daily_cap:
        raise ValidationError("Daily entry limit reached.")
    value = Decimal("1") if task.type == "visit" else Decimal(str(value))
    if value <= 0:
        raise ValidationError("Invalid quantity/amount.")
    far, dist = False, None
    if None not in (lat, lng, biz.lat, biz.lng):
        dist = int(_dist_m(lat, lng, biz.lat, biz.lng))
        far = dist > biz.max_distance_m  # soft check: flagged for the owner, never auto-approved
    if biz.require_bill_photo and not bill_photo:
        raise ValidationError("Please attach the bill photo.")
    step = None
    if counter_code:
        step = counter.match(biz, counter_code)
        if step is None:
            raise ValidationError("Counter code expired or wrong. Ask the staff for the current code.")
        if CodeUse.objects.filter(business=biz, step=step, profile=profile).exists():
            raise ValidationError("You already used this code.")
        if CodeUse.objects.filter(business=biz, step=step).count() >= 20:
            raise ValidationError("This code was used too many times. Ask for the new code.")
    entry = PurchaseEntry.objects.create(profile=profile, task=task, value=value, bill_photo=bill_photo or "", far=far, distance_m=dist)
    _log(biz, profile.user, "entry_submitted", entry.id)
    if step is not None:
        CodeUse.objects.create(business=biz, step=step, profile=profile)
        _log(biz, None, "counter_code_used", entry.id)
    if not far and (step is not None or biz.approval_mode == "auto"):
        review_entry(entry, None, approve=True)
        entry.refresh_from_db()
    else:
        for u in [biz.owner] + [s.user for s in biz.staff.all()]:
            push(u, f"New purchase pending: {profile.user.first_name or profile.user.username} - {task.title}" + (" (far from shop)" if far else ""))
    return entry


@transaction.atomic
def review_entry(entry, actor, approve):
    entry = PurchaseEntry.objects.select_for_update().select_related("profile__business", "task").get(pk=entry.pk)
    if entry.status != "pending":
        raise ValidationError("Entry already reviewed.")
    biz = entry.profile.business
    if actor and not can_manage(actor, biz):
        raise PermissionDenied()
    entry.status = "approved" if approve else "rejected"
    entry.reviewed_by, entry.reviewed_at = actor, timezone.now()
    entry.save()
    _log(biz, actor, entry.status, entry.id)
    push(entry.profile.user, f"{biz.name}: your purchase was {entry.status}.")
    if approve:
        _apply_progress(entry)
    return entry


def _apply_progress(entry):
    task, profile = entry.task, entry.profile
    prog, _ = TaskProgress.objects.select_for_update().get_or_create(profile=profile, task=task)
    if prog.target is None:
        prog.target = task.target  # snapshot: later edits do not change this customer's goal
    prog.current_value += entry.value
    if task.repeatable:
        cap = task.max_per_customer or None  # 0 = unlimited
    else:
        cap = 1
    while prog.current_value >= prog.target and (cap is None or prog.completed_count < cap):
        prog.current_value -= prog.target
        prog.completed_count += 1
        prog.target = task.target  # next cycle uses the latest target
        for r in task.rewards.all():
            g = RewardGrant.objects.create(profile=profile, reward=r,
                                           expires_at=timezone.now() + timedelta(days=r.expiry_days))
            push(profile.user, f"Reward unlocked at {profile.business.name}: {r.title}. Code {g.code}", sms=True)
    if cap is not None and prog.completed_count >= cap:
        prog.current_value = Decimal("0")
    prog.save()


@transaction.atomic
def redeem(code, actor):
    try:
        g = RewardGrant.objects.select_for_update().select_related("profile__business").get(code=code.upper())
    except RewardGrant.DoesNotExist:
        raise ValidationError("Invalid code.")
    biz = g.profile.business
    if not can_manage(actor, biz):
        raise PermissionDenied()
    if g.status != "active":
        raise ValidationError(f"Reward already {g.status}.")
    if g.expires_at < timezone.now():
        g.status = "expired"; g.save()
        raise ValidationError("Reward expired.")
    g.status, g.redeemed_at = "used", timezone.now()
    g.save()
    _log(biz, actor, "redeemed", g.code)
    return g


def _dist_m(lat1, lng1, lat2, lng2):
    from math import asin, cos, radians, sin, sqrt
    a = sin(radians(lat2 - lat1) / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lng2 - lng1) / 2) ** 2
    return 6371000 * 2 * asin(sqrt(a))


@transaction.atomic
def reverse_entry(entry, actor):
    entry = PurchaseEntry.objects.select_for_update().select_related("profile__business", "task").get(pk=entry.pk)
    biz = entry.profile.business
    if not can_manage(actor, biz):
        raise PermissionDenied()
    if entry.status != "approved":
        raise ValidationError("Only approved entries can be undone.")
    task = entry.task
    prog = TaskProgress.objects.select_for_update().get(profile=entry.profile, task=task)
    tgt = prog.target or task.target
    prog.current_value -= entry.value
    while prog.current_value < 0 and prog.completed_count > 0:
        prog.completed_count -= 1
        prog.current_value += tgt
        g = RewardGrant.objects.filter(profile=entry.profile, reward__task=task, status="active").order_by("-id").first()
        if g:
            g.status = "revoked"; g.save()
    prog.current_value = max(prog.current_value, 0)
    prog.save()
    entry.status = "reversed"; entry.save()
    _log(biz, actor, "reversed", entry.id)
    return entry
