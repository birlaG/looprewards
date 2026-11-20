# Firaao v2 upgrade

Goal: turn the loyalty tool into a SaaS platform that helps **local shops and service businesses bring customers back**,
using rewards, tasks, boosts, referrals and bookings. The existing API is unchanged (everything is additive), so old
clients, print kits, billing, vendors and legal pages keep working.

## What is new

### For owners
| Area | What it does |
|---|---|
| One-tap setup | Pick a business type (cafe, restaurant, grocery, retail, salon, fitness, services, other). A ready program, slow-hour boost, welcome gift, referral reward, tier perks and (for service types) a service menu are created. `core/blueprints.py` |
| Today screen | Approval queue first (approve/decline with Undo), booking requests, reward redeem box, KPIs, 30-day chart and plain-language tips ("12 customers have not visited in 30 days"). |
| Customers (CRM) | Segments computed live: new, regular, slipping away (31-60 days), lapsed (60+), not yet bought. Search, sort, private notes, block, call/WhatsApp, CSV export. |
| Offers | Segment-targeted messages to opted-in customers. Limits: 1 per audience per day, 3 per day. |
| Boosts | "Double stamps on Tuesdays / 2-5pm". Applies to visit and item tasks, never to spend totals. Undo reverses exactly what was credited. |
| Welcome + referral gifts | Welcome gift on a customer's first approved purchase; referral reward for the inviter after the friend's first purchase. Exactly once, even after an undo. |
| Membership tiers | Member / Silver / Gold from lifetime visit days, with perks you set. |
| Services and bookings | Customers request a slot, staff confirm, and "Completed" credits the visit to every live program (visit +1, spend += price). |
| Insights | Come-back rate, returning-visit share, tracked sales, busiest days/hours, customer groups, redeem rate, ratings. |
| Reviews | Customers rate approved visits and completed bookings; 1-2 star ratings alert the owner privately. |
| Branding | Logo, brand colour, about, phone, WhatsApp, maps link. Shop links show a proper preview card on WhatsApp. |
| Team | Staff list (was add/remove only). Staff get a focused queue, bookings and counter-code screens. |

### For customers
Wallet home with one stamp card per shop (brand colour, tier, week streak, active boost, next booking), shop page tabs
(Earn, Rewards, Book, History, Invite), ticket-style reward codes, referral link with WhatsApp share, ratings.

### Frontend
Rebuilt as a small modular app (`core/static/app/`): design system `app.css`, `core.js` (router, API, layout, auth),
`customer.js`, `owner.js`, `owner2.js`, `partner.js`, Hindi in `i18n-hi.js` (+ the classic tables reused for server
messages). No build step. The previous single-file UI is kept at `/app/classic/` for one release.

## Upgrade steps
```
pip install -r requirements.txt          # no new dependencies
python manage.py makemigrations --check  # must say "No changes detected" (0007 and 0008 are hand-written to match models.py)
python manage.py migrate
python manage.py test                    # existing suite + core/tests_growth.py + core/tests_vendor.py
python manage.py collectstatic --noinput # deploy.sh already does this
```
Bump `ASSET_VERSION` in `core/pages.py` on every frontend release (busts browser + service-worker cache).


## Partners (vendors who refer shops and earn from subscriptions)
Existing behaviour is unchanged: a partner is approved by you, owners who register through `/app/?ref=CODE` are attributed
permanently, and every paid subscription payment accrues a commission (on the ex-GST amount) that is held, bundled monthly
into a payout, and marked paid by you in the admin.

| New | What it does |
|---|---|
| Tiers | Bonus percentage points on top of the base rate, based on referred shops that are **currently paid up** (default: 5 = Silver +2, 15 = Gold +4, 40 = Platinum +6; edit `VENDOR_TIERS` in settings). The rate is frozen on each commission when it is created, so a later tier drop never changes past earnings. These defaults are placeholders: check them against your margins. |
| Shop activity | For every referred shop the partner sees customers, visits in 30 days, last activity and a health label (new / active / quiet / inactive) with a next step ("help them print the QR code"). Aggregate numbers only; a partner never sees a shop's customers. |
| Marketing kit | Printable A4 flyer (English and Hindi) carrying the partner's own referral QR at `/kit/<code>/`, ready-to-send WhatsApp messages, a 30-second pitch, answers to common objections and the prices to quote. |
| TDS on payouts | Migration `0008` adds `paid_at` and `tds` to payouts. **Off by default.** Set `VENDOR_TDS_RATE` (percent) and `VENDOR_TDS_THRESHOLD_PAISE` with your accountant. When the yearly total crosses the threshold, TDS is withheld on the whole year's total (earlier payouts are caught up). "Mark paid" in the admin now records the date, the TDS and notifies the partner of the net amount. This is a bookkeeping aid, not tax advice. |
| Earnings statements | Per financial year (Apr-Mar): commissions, payouts, gross / TDS / net totals, and a CSV download for the partner's records and ITR / Form 26AS reconciliation. |
| Assisted onboarding | A shop a partner creates for an owner now starts with the same ready-made program as the owner wizard (it used to start empty). |

Partner leaderboards were deliberately not built: they would expose other partners' earnings and encourage spam.
The new partner code (`core/tests_vendor.py`, about 20 tests) has not been run either; see the verification note above.

## Verification status (please read)
The sandbox this was built in had no network, so **Django could not be installed and the Python test suite was not run**.
What *was* done: every Python file compiles, a static undefined-name check passes, the frontend was executed in Node
against a fake DOM with mocked API data across all 43 screen/role/language combinations (no errors, no
"undefined"/"NaN"), and API field names were cross-checked against the backend. Migration `0007` is written by hand;
run `makemigrations --check` first and, if it reports differences, regenerate it (`makemigrations core`) - the model
code is the source of truth. `core/tests_growth.py` (about 40 tests) has not been executed yet, so expect to fix small
test-side details on first run. Not verified: real browser rendering, Razorpay checkout in the new UI, image upload of
logos.

## Needs a human
* **Hindi review.** All new Hindi strings were machine-written; have a native speaker proof them.
* **Secrets.** The zip you sent contained `.env`, `.superuser-credentials.txt` and `db.sqlite3` (not in git history, which
  is good). They are excluded from the upgraded package. Treat them as exposed: rotate `SECRET_KEY`, Razorpay keys and
  the superuser password.
* Fonts load from Google Fonts (Bricolage Grotesque, Hind); self-host them if you need offline/privacy guarantees.

## Suggested next steps
Plan tiers with limits (e.g. Free / Starter / Pro) and feature flags; WhatsApp Business API for offers and booking
reminders (extend `send_reminders`); multi-location with per-branch staff roles (cashier vs manager); gift cards and
prepaid packages; customer birthday rewards (needs DOB consent under DPDP); owner mobile app wrapper (the PWA
manifest is ready); automated win-back campaigns on a schedule; webhook/Zapier export.
