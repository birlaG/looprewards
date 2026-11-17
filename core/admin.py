from django.contrib import admin
from . import models
from .billing import mark_paid
from .vendors import reverse
for m in (models.User, models.Business, models.Program, models.Task, models.Reward,
          models.CustomerProfile, models.PurchaseEntry, models.RewardGrant, models.AuditLog):
    admin.site.register(m)


@admin.register(models.Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = ("id", "owner", "plan", "amount", "method", "status", "utr", "created_at")
    list_filter = ("status", "method")
    actions = ["approve", "reject", "refund"]

    @admin.action(description="Approve selected UPI payments (verify UTR in bank first)")
    def approve(self, request, qs):
        for p in qs.filter(method="upi").exclude(status="paid"):
            mark_paid(p.pk)

    @admin.action(description="Reject selected")
    def reject(self, request, qs):
        qs.exclude(status="paid").update(status="rejected")

    @admin.action(description="Mark refunded (reverses vendor commission; cut access manually in Subscription)")
    def refund(self, request, qs):
        for p in qs.filter(status="paid"):
            p.status = "refunded"; p.save(); reverse(p)


@admin.register(models.Vendor)
class VendorAdmin(admin.ModelAdmin):
    list_display = ("code", "user", "rate", "upi_id", "pan", "status")
    actions = ["approve", "suspend"]

    @admin.action(description="Approve vendors")
    def approve(self, request, qs): qs.update(status="approved")

    @admin.action(description="Suspend vendors")
    def suspend(self, request, qs): qs.update(status="suspended")


@admin.register(models.Commission)
class CommissionAdmin(admin.ModelAdmin):
    list_display = ("id", "vendor", "amount", "rate", "status", "payable_on")
    list_filter = ("status", "vendor")


@admin.register(models.Payout)
class PayoutAdmin(admin.ModelAdmin):
    list_display = ("id", "vendor", "amount", "status", "reference", "created_at")
    actions = ["paid"]

    @admin.action(description="Mark paid (after you transfer to vendor UPI/bank, less TDS if applicable)")
    def paid(self, request, qs):
        for po in qs.filter(status="pending"):
            po.status = "paid"; po.save()
            po.commission_set.update(status="paid")


@admin.register(models.Subscription)
class SubscriptionAdmin(admin.ModelAdmin):  # use for win-back calls: sort by paid_until
    list_display = ("owner", "trial_ends", "paid_until", "state_now")
    search_fields = ("owner__username", "owner__first_name")
    ordering = ("-paid_until",)

    @admin.display(description="state")
    def state_now(self, o):
        return o.state
