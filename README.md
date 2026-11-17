# LoopRewards

## Deploy
See **GUIDE.md** (Contabo step-by-step, updating, backups, scaling). Quick: `make deploy` on the server.

## Local development
    DEBUG=1 pip install -r requirements.txt && DEBUG=1 python manage.py makemigrations core && DEBUG=1 python manage.py migrate
    DEBUG=1 python manage.py test && DEBUG=1 python manage.py runserver

## Counter / desk card (profile + QR only, no bills)
Owner dashboard has buttons for A6 counter card, A5, desk tent (A4 folded) and A4 B/W.
Direct: /print/<shop_code>/?size=a6|a5|a4|tent[&bw=1] -> Print button.

## Not built yet
OTP/SMS, subscriptions/billing, staff accounts + rotating code, vendor/affiliate,
GPS check, push/WhatsApp notifications, reports, multi-language UI.

## Billing
- 14-day trial (no card), then ₹299/mo or ₹2,999/yr (edit `PLANS` in settings). 30-day grace: profile/QR paused, print kit + progress kept.
- Online: Razorpay Checkout (UPI/cards/netbanking). Add webhook `https://<domain>/api/billing/webhook/`, events `payment.captured` + `order.paid`.
- UPI QR/ID: owner pays platform UPI, enters UTR; admin approves in /admin -> Payments -> "Approve selected UPI payments" after checking the bank statement.

## Invoices and reminders
- Each paid payment gets invoice no. `LR/<yy>/<id>` and a printable GST invoice (price treated as GST-inclusive; set SELLER_* in .env). Have your CA confirm the format (CGST/SGST vs IGST split by state is not done).
- `python manage.py send_reminders` (run daily by the `cron` container): trial ends in 2 days, renewal in 7 days, paused notice. Point NOTIFY_WEBHOOK_URL at your SMS/WhatsApp bridge, else it only logs.
- After the first run commit the generated `core/migrations/` folder so production uses fixed migrations.

## Vendors / agents
- Agent registers as "agent / reseller" in the app, applies with PAN + UPI ID; you approve in /admin -> Vendors and set the rate (default 20%).
- Attribution is permanent: owner signs up via `/app/?ref=CODE` or the agent uses "Register a shop for an owner" (temp password; owner changes it).
- Commission = rate × subscription price excluding GST, created only on a real paid payment (never trial), 30-day hold, single level, every renewal (set `COMMISSION_FIRST_YEAR_ONLY=1` for year one only).
- Refund: /admin -> Payments -> "Mark refunded" reverses a held commission.
- Monthly (1st) `run_payouts` bundles ripe commissions ≥ ₹500 into Payouts; you transfer via UPI/bank (deduct TDS as required) and mark "paid" in /admin.
- Blocked: self-referral (same UPI), duplicate shop UPI IDs. Agents see shop names/status only, never customer data or passwords. Confirm commission, TDS and GST on commission with your CA.

## Staff accounts and counter code
- Owner adds staff per shop (dashboard -> Add staff). Staff can approve/reject and redeem only; they cannot edit the shop, rewards or billing.
- **Counter code screen** (`/app/?screen=<shop_code>`, open on a counter tablet/phone): 6-digit code + QR, changes every 60s. After paying, the customer scans the QR (or types the code); the purchase is then auto-approved, with no owner tap. The cooldown and daily cap still apply, each customer can use a code once, and a code works at most 20 times.
- Weak spot: a customer could WhatsApp the code to a friend who is not at the shop. Add the GPS proximity check (PRD 7.5) next if you see this.

## Reports and notifications
- Owner dashboard (per shop): customers, repeat-customer rate, top customers, rewards issued vs redeemed, peak hours, approved today, and a customers CSV (signed link valid 10 min). Customer name and mobile are visible only to the shop they joined.
- In-app notifications: customer gets approved/rejected, reward unlocked, reward expiring (3 days, from the daily `send_reminders`); owner and staff get "new purchase pending". Set `NOTIFY_SMS=1` + `NOTIFY_WEBHOOK_URL` to also send reward unlocked/expiring by SMS/WhatsApp. Broadcast offers need customer marketing consent, so they are not built yet.

## Hindi
- The app has an English/हिन्दी button (top right), remembered per phone; it defaults to the shop's language (set when creating the shop) or the phone language. Owner/staff/customer/agent screens, common error messages and notifications are translated; the print card is Hindi when the shop language is Hindi (or `?lang=hi`).
- To add a string or language, edit the `EX` (whole-text) and `PT` (phrase) tables at the end of `core/web/app.html`. Please have a native Hindi speaker proofread the wording. Invoices stay in English (GST).

## Safety, renewal and privacy features
- **GPS check (soft):** the customer's phone sends its location with each entry; shops set their location once (Settings -> "Set shop location"). Beyond `max_distance_m` (default 300 m) the entry is flagged "far from shop", never auto-approved (even with a counter code), and the owner sees a warning.
- **Bill photo:** optional per shop (Settings -> Require bill photo). Files get random names and are served from `/media/`; keep nginx as provided.
- **Undo + block:** "Recent approvals" has Undo (reverses progress and revokes an unredeemed reward); pending entries have "Block customer".
- **Pause/resume** a program from the dashboard; `PATCH /api/tasks/<id>/` edits a task. Customers already in progress keep the target they started with (snapshot), new cycles use the new target.
- **Auto-renew:** Razorpay Subscriptions (UPI AutoPay/cards). Create two plans in Razorpay, set `RAZORPAY_PLAN_MONTHLY/YEARLY`, and add `subscription.charged` to the webhook. The first charge is after the trial / current period; each charge creates a payment, invoice and commission automatically. Owners can cancel in the dashboard.
- **Offers (broadcast):** only to customers who ticked "Send me offers from this shop"; one per shop per day; delivered in-app.
- **Forgot password:** OTP by SMS through `NOTIFY_WEBHOOK_URL` (logs only until you connect a provider). 5 tries, 10 min expiry, same answer for unknown numbers.
- **Delete my account (DPDP):** customers are erased; owners/agents are anonymised and their shops closed (invoices and commissions must be kept for accounts).
- **Platform stats:** `GET /api/admin/stats/` with a staff user's token (create one with `createsuperuser`, then log in via `/api/auth/login/`).
