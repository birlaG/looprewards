from datetime import timedelta
from django.utils import timezone
from rest_framework.test import APITestCase
from .models import PurchaseEntry


class FlowTest(APITestCase):
    def _login(self, mobile, role):
        r = self.client.post("/api/auth/register/", {"mobile": mobile, "password": "secret1", "role": role, "name": "N", "accepted": True})
        self.client.credentials(HTTP_AUTHORIZATION="Token " + r.data["token"])

    def test_full_loop(self):
        self._login("9999999991", "owner")
        code = self.client.post("/api/businesses/", {"name": "Raju Pizza", "pay_upi_id": "raju@upi"}).data["shop_code"]
        self.client.post(f"/api/b/{code}/programs/", {"title": "Loyalty", "tasks": [
            {"title": "5 pizzas", "type": "count", "target": 5,
             "rewards": [{"title": "Free pizza", "type": "free_item"}]}]}, format="json")
        task_id = self.client.get(f"/api/b/{code}/").data["programs"][0]["tasks"][0]["id"]
        owner_token = self.client.handler._credentials["HTTP_AUTHORIZATION"]

        self._login("9999999992", "customer")
        self.client.post(f"/api/b/{code}/join/")
        r = self.client.post("/api/entries/", {"task": task_id, "value": 5})
        self.assertEqual(r.status_code, 201)
        # cooldown blocks immediate second entry
        self.assertEqual(self.client.post("/api/entries/", {"task": task_id, "value": 1}).status_code, 400)
        cust_token = self.client.handler._credentials["HTTP_AUTHORIZATION"]

        self.client.credentials(HTTP_AUTHORIZATION=owner_token)
        self.assertEqual(len(self.client.get("/api/owner/pending/").data), 1)
        self.client.post(f"/api/entries/{r.data['id']}/review/", {"action": "approve"})

        self.client.credentials(HTTP_AUTHORIZATION=cust_token)
        reward = self.client.get("/api/me/shops/").data[0]["rewards"][0]
        self.client.credentials(HTTP_AUTHORIZATION=owner_token)
        self.assertEqual(self.client.post("/api/rewards/redeem/", {"code": reward["code"]}).status_code, 200)
        self.assertEqual(self.client.post("/api/rewards/redeem/", {"code": reward["code"]}).status_code, 400)


import hashlib, hmac, json
from django.conf import settings
from django.test import override_settings
from .models import Payment, User, get_sub
from .billing import mark_paid


@override_settings(RAZORPAY_WEBHOOK_SECRET="whsec")
class BillingTest(APITestCase):
    def test_webhook_activates_once(self):
        u = User.objects.create_user("9999999993", password="x", role="owner")
        p = Payment.objects.create(owner=u, plan="monthly", amount=29900, method="gateway", order_id="order_1")
        body = json.dumps({"event": "payment.captured", "payload": {"payment": {"entity": {
            "id": "pay_1", "order_id": "order_1", "amount": 29900}}}}).encode()
        sig = hmac.new(b"whsec", body, hashlib.sha256).hexdigest()
        for _ in range(2):  # replayed webhook must not extend twice
            r = self.client.generic("POST", "/api/billing/webhook/", body, HTTP_X_RAZORPAY_SIGNATURE=sig)
            self.assertEqual(r.status_code, 200)
        s = get_sub(u)
        self.assertEqual(s.state, "active")
        self.assertLess((s.paid_until - s.trial_ends).days, 31)
        self.assertEqual(self.client.generic("POST", "/api/billing/webhook/", body, HTTP_X_RAZORPAY_SIGNATURE="bad").status_code, 400)


from datetime import timedelta as _td
from django.core.management import call_command
from .models import ReminderLog


class ReminderTest(APITestCase):
    def test_sent_once(self):
        u = User.objects.create_user("9999999994", password="x", role="owner")
        s = get_sub(u); s.trial_ends = timezone.now() + _td(days=1); s.save()
        call_command("send_reminders"); call_command("send_reminders")
        self.assertEqual(ReminderLog.objects.filter(owner=u).count(), 1)


from .models import Commission, Vendor
from .vendors import reverse


class VendorTest(APITestCase):
    def test_commission_accrual_and_reversal(self):
        vu = User.objects.create_user("8888888888", password="x", role="vendor")
        v = Vendor.objects.create(user=vu, code="ABC123", pan="ABCDE1234F", upi_id="v@upi", status="approved", rate=20)
        u = User.objects.create_user("9999999995", password="x", role="owner", referred_by=v)
        p = Payment.objects.create(owner=u, plan="monthly", amount=29900, method="upi", status="pending")
        mark_paid(p.pk); mark_paid(p.pk)  # idempotent
        c = Commission.objects.get()
        self.assertEqual(c.amount, 5067)  # 20% of 29900/1.18 paise
        reverse(p)
        c.refresh_from_db(); self.assertEqual(c.status, "reversed")


class StaffCodeTest(APITestCase):
    def test_staff_and_counter_code(self):
        self._login = FlowTest._login.__get__(self)
        self._login("9999999996", "owner")
        code = self.client.post("/api/businesses/", {"name": "Chai Point"}).data["shop_code"]
        self.client.post(f"/api/b/{code}/programs/", {"title": "L", "tasks": [{"title": "8 chai", "type": "count",
            "target": 8, "rewards": [{"title": "Free chai", "type": "free_item"}]}]}, format="json")
        tid = self.client.get(f"/api/b/{code}/").data["programs"][0]["tasks"][0]["id"]
        self.assertEqual(self.client.post(f"/api/b/{code}/staff/", {"mobile": "9999999997", "password": "secret1"}).status_code, 201)
        token = self.client.post("/api/auth/login/", {"username": "9999999997", "password": "secret1"}).data["token"]
        self.client.credentials(HTTP_AUTHORIZATION="Token " + token)  # staff
        cc = self.client.get(f"/api/b/{code}/counter-code/").data["code"]
        self.assertEqual(self.client.post(f"/api/b/{code}/staff/", {"mobile": "9999999998", "password": "secret1"}).status_code, 404)
        self._login("9999999999", "customer")
        self.client.post(f"/api/b/{code}/join/")
        self.assertEqual(self.client.post("/api/entries/", {"task": tid, "value": 1, "counter_code": "000000"}).status_code, 400)
        r = self.client.post("/api/entries/", {"task": tid, "value": 1, "counter_code": cc})
        self.assertEqual(r.data["status"], "approved")  # code auto-validates even in manual mode


from .models import Notification


class ReportNotifyTest(APITestCase):
    def test_report_and_notifications(self):
        self._login = FlowTest._login.__get__(self)
        self._login("9000000001", "owner")
        code = self.client.post("/api/businesses/", {"name": "Dairy", "daily_cap": 5, "cooldown_minutes": 0}).data["shop_code"]
        self.client.post(f"/api/b/{code}/programs/", {"title": "L", "tasks": [{"title": "2 visits", "type": "visit",
            "target": 2, "rewards": [{"title": "Free milk", "type": "free_item"}]}]}, format="json")
        tid = self.client.get(f"/api/b/{code}/").data["programs"][0]["tasks"][0]["id"]
        owner_auth = self.client.handler._credentials["HTTP_AUTHORIZATION"]
        self._login("9000000002", "customer")
        self.client.post(f"/api/b/{code}/join/")
        ids = [self.client.post("/api/entries/", {"task": tid}).data["id"] for _ in range(2)]
        cust_auth = self.client.handler._credentials["HTTP_AUTHORIZATION"]
        self.client.credentials(HTTP_AUTHORIZATION=owner_auth)
        self.assertGreaterEqual(len(self.client.get("/api/notifications/").data), 2)  # pending alerts
        for i in ids:
            self.client.post(f"/api/entries/{i}/review/", {"action": "approve"})
        rep = self.client.get(f"/api/b/{code}/report/").data
        self.assertEqual((rep["customers"], rep["repeat_rate"], rep["rewards_issued"]), (1, 100, 1))
        self.assertEqual(self.client.get(rep["csv_url"]).status_code, 200)
        self.client.credentials(HTTP_AUTHORIZATION=cust_auth)
        self.assertTrue(any("Reward unlocked" in n["text"] for n in self.client.get("/api/notifications/").data))


class HindiPrintTest(APITestCase):
    def test_hindi_print_card(self):
        self._login = FlowTest._login.__get__(self)
        self._login("9000000003", "owner")
        code = self.client.post("/api/businesses/", {"name": "Chai", "language": "hi"}).data["shop_code"]
        self.assertIn("स्कैन करें", self.client.get(f"/print/{code}/?size=tent").content.decode())


class SafetyFeaturesTest(APITestCase):
    def test_gps_reverse_broadcast_delete(self):
        self._login = FlowTest._login.__get__(self)
        self._login("9000000010", "owner")
        code = self.client.post("/api/businesses/", {"name": "Kirana", "lat": 19.0, "lng": 72.8,
                                "cooldown_minutes": 0, "daily_cap": 9}).data["shop_code"]
        self.client.post(f"/api/b/{code}/programs/", {"title": "L", "tasks": [{"title": "2 buys", "type": "count",
            "target": 2, "rewards": [{"title": "Gift", "type": "gift"}]}]}, format="json")
        tid = self.client.get(f"/api/b/{code}/").data["programs"][0]["tasks"][0]["id"]
        oa = self.client.handler._credentials["HTTP_AUTHORIZATION"]
        cc = self.client.get(f"/api/b/{code}/counter-code/").data["code"]
        self._login("9000000011", "customer")
        self.client.post(f"/api/b/{code}/join/", {"consent": True})
        far = self.client.post("/api/entries/", {"task": tid, "value": 1, "counter_code": cc, "lat": 28.6, "lng": 77.2})
        self.assertEqual((far.data["status"], far.data["far"]), ("pending", True))  # far: code does not auto-approve
        near = self.client.post("/api/entries/", {"task": tid, "value": 2, "counter_code": cc, "lat": 19.0001, "lng": 72.8001})
        self.assertEqual(near.data["status"], "approved")
        self.assertEqual(len(self.client.get("/api/me/shops/").data[0]["rewards"]), 1)
        ca = self.client.handler._credentials["HTTP_AUTHORIZATION"]
        self.client.credentials(HTTP_AUTHORIZATION=oa)
        self.assertEqual(self.client.post(f"/api/entries/{near.data['id']}/reverse/").status_code, 200)  # undo revokes reward
        self.assertEqual(self.client.post(f"/api/b/{code}/broadcast/", {"text": "10% off today"}).data["sent"], 1)
        self.assertEqual(self.client.post(f"/api/b/{code}/broadcast/", {"text": "again"}).status_code, 400)
        self.client.credentials(HTTP_AUTHORIZATION=ca)
        self.assertEqual(self.client.get("/api/me/shops/").data[0]["rewards"][0]["status"], "revoked")
        self.assertEqual(self.client.delete("/api/me/").status_code, 204)
        self.assertFalse(User.objects.filter(username="9000000011").exists())

    def test_otp_reset(self):
        User.objects.create_user("9000000012", password="oldpass1")
        self.client.post("/api/auth/reset/request/", {"mobile": "9000000012"})
        from .models import OtpCode
        o = OtpCode.objects.get()
        o.code_hash = __import__("core.extras", fromlist=["_h"])._h("123456"); o.save()
        self.assertEqual(self.client.post("/api/auth/reset/confirm/", {"mobile": "9000000012", "otp": "000000", "new": "newpass1"}).status_code, 400)
        self.assertEqual(self.client.post("/api/auth/reset/confirm/", {"mobile": "9000000012", "otp": "123456", "new": "newpass1"}).status_code, 200)
        self.assertEqual(self.client.post("/api/auth/login/", {"username": "9000000012", "password": "newpass1"}).status_code, 200)


class LifecycleLegalTest(APITestCase):
    def test_legal_pages_and_consent(self):
        for p in ("privacy", "terms", "refund", "pricing", "contact"):
            self.assertEqual(self.client.get(f"/{p}/").status_code, 200)
        r = self.client.post("/api/auth/register/", {"mobile": "9000000020", "password": "secret1"})
        self.assertEqual(r.status_code, 400)  # must accept Terms + Privacy
        r = self.client.post("/api/auth/register/", {"mobile": "9000000020", "password": "secret1", "accepted": True})
        self.assertEqual(r.status_code, 201)
        self.assertIsNotNone(User.objects.get(username="9000000020").consent_at)

    def test_lapse_then_return_keeps_everything(self):
        from .models import Business, CustomerProfile, RewardGrant, Reward, Program, Task
        o = User.objects.create_user("9000000021", password="x", role="owner")
        b = Business.objects.create(owner=o, name="Chai", pay_upi_id="chai@upi")
        pr = Program.objects.create(business=b, title="L")
        t = Task.objects.create(program=pr, title="5 chai", type="count", target=5)
        rw = Reward.objects.create(task=t, title="Free chai", type="free_item")
        c = User.objects.create_user("9000000022", password="x")
        prof = CustomerProfile.objects.create(user=c, business=b)
        s = get_sub(o)
        s.paid_until = timezone.now() - _td(days=40)  # paid month ended 40 days ago -> in grace, shop paused
        s.save()
        g = RewardGrant.objects.create(profile=prof, reward=rw, expires_at=timezone.now() + _td(days=10))
        self.assertEqual((s.state, b.is_live), ("grace", False))
        before = g.expires_at
        p = Payment.objects.create(owner=o, plan="monthly", amount=29900, method="upi", status="pending", utr="123456789012")
        mark_paid(p.pk)
        s.refresh_from_db(); g.refresh_from_db(); b = Business.objects.get(pk=b.pk)
        self.assertEqual((s.state, b.is_live), ("active", True))
        self.assertGreater((g.expires_at - before).days, 38)  # extended by the paused time
        self.assertTrue(CustomerProfile.objects.filter(pk=prof.pk).exists())  # customers kept
        s.paid_until = timezone.now() - _td(days=30 + 400)  # long gone
        s.save()
        from django.core.management import call_command
        call_command("purge_lapsed", "--apply")
        self.assertFalse(Business.objects.filter(pk=b.pk).exists())  # deleted after retention


class PublicShopOffersTest(APITestCase):
    def test_public_shop_lists_only_running_offers_and_returns_upi_intent(self):
        from urllib.parse import parse_qs, urlparse
        from .models import Business, CustomerProfile, Program, Task, Reward, get_sub

        owner = User.objects.create_user("9000000030", "secret1", role="owner")
        business = Business.objects.create(owner=owner, name="Cafe & Tea", pay_upi_id="cafe@upi")
        get_sub(owner)
        today = timezone.localdate()
        running = Program.objects.create(business=business, title="Lunch rewards",
                                         start=today, end=today)
        task = Task.objects.create(program=running, title="Buy lunch", type="amount", target=500)
        Reward.objects.create(task=task, title="Free tea", type="free_item")
        Program.objects.create(business=business, title="Expired", start=today - _td(days=2),
                               end=today - _td(days=1))
        Program.objects.create(business=business, title="Coming soon", start=today + _td(days=1))

        response = self.client.get(f"/api/b/{business.shop_code}/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([p["title"] for p in response.data["programs"]], ["Lunch rewards"])
        self.assertEqual(response.data["programs"][0]["tasks"][0]["rewards"][0]["title"], "Free tea")
        self.assertTrue(response.data["require_bill_photo"] is False)
        self.assertEqual(parse_qs(urlparse(response.data["pay_link"]).query),
                         {"pa": ["cafe@upi"], "pn": ["Cafe & Tea"], "cu": ["INR"]})

    def test_customer_progress_includes_task_id(self):
        from .models import Business, CustomerProfile, Program, Task, TaskProgress, get_sub

        owner = User.objects.create_user("9000000031", "secret1", role="owner")
        business = Business.objects.create(owner=owner, name="Cafe")
        get_sub(owner)
        task = Task.objects.create(program=Program.objects.create(business=business, title="Visits"),
                                   title="Visit 5 times", type="visit", target=5)
        customer = User.objects.create_user("9000000032", "secret1")
        profile = CustomerProfile.objects.create(user=customer, business=business)
        TaskProgress.objects.create(profile=profile, task=task, current_value=2, target=5)
        self.client.force_authenticate(user=customer)

        response = self.client.get("/api/me/shops/")
        self.assertEqual(response.data[0]["progress"][0]["task_id"], task.id)

    def test_customer_purchase_entry_updates_progress_after_shop_approval(self):
        from .models import Business, CustomerProfile, Program, Task, Reward, get_sub

        owner = User.objects.create_user("9000000033", "secret1", role="owner")
        business = Business.objects.create(owner=owner, name="Cafe")
        get_sub(owner)
        task = Task.objects.create(program=Program.objects.create(business=business, title="Spend rewards"),
                                   title="Spend ₹100", type="amount", target=100)
        Reward.objects.create(task=task, title="Free tea", type="free_item")
        customer = User.objects.create_user("9000000034", "secret1")
        CustomerProfile.objects.create(user=customer, business=business)
        self.client.force_authenticate(user=customer)

        entry = self.client.post("/api/entries/", {"task": task.id, "value": "125.50"}, format="json")
        self.assertEqual((entry.status_code, entry.data["status"]), (201, "pending"))
        self.client.force_authenticate(user=owner)
        approved = self.client.post(f"/api/entries/{entry.data['id']}/review/",
                                    {"action": "approve"}, format="json")
        self.assertEqual(approved.data["status"], "approved")

        self.client.force_authenticate(user=customer)
        customer_shop = self.client.get("/api/me/shops/").data[0]
        self.assertEqual(customer_shop["progress"][0]["task_id"], task.id)
        self.assertEqual(str(customer_shop["progress"][0]["current"]), "25.50")
        self.assertEqual(customer_shop["progress"][0]["completed"], 1)
        self.assertEqual(customer_shop["rewards"][0]["title"], "Free tea")
