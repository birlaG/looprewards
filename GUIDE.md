# LoopRewards – Contabo deployment & operations guide

Stack on ONE server (Docker): **Caddy** (HTTPS, files) → **Django/gunicorn** (app + API + PWA) → **PostgreSQL** + **Redis**, plus a **cron** container (reminders, payouts). Everything is started by one command: `./deploy/deploy.sh`.

> Honest note: this kit was written and syntax-checked, but I could not run Docker or Razorpay where I built it. Do the **pilot checklist (section 7)** on a test domain before real customers.

---
## 1. What you need first
| Item | Why |
|---|---|
| Domain name (e.g. looprewards.in) | HTTPS, QR codes point here. **Never change it later** – printed QRs carry it. |
| Contabo VPS, Ubuntu 24.04 | the server |
| GitHub account (private repo) | where your code lives; server pulls updates from it |
| Razorpay account (KYC done) | online payments + auto-renew |
| SMS/WhatsApp provider | OTP + alerts (optional at first) |
| A laptop with Docker **or** Python 3.12 | to create migrations before the first deploy |

## 2. Choose the server (Contabo)
Check Contabo's current plans/prices on their site. For launch with real shops pick **at least 4 vCPU, 8 GB RAM, SSD ≥ 100 GB**, region near India users if available, **Ubuntu 24.04**, and **add your SSH key at order time**. Contabo plans are cheap per resource; speed can vary between neighbours, so monitor (section 9) and keep backups offsite (section 8).
Rough capacity (an *estimate*, not measured – load-test before a big launch): one such server should handle a few thousand shops and a few hundred thousand registered customers at normal daily traffic. Section 10 shows how to grow past that.
`docker-compose.yml` Postgres settings are tuned for 8 GB; for other sizes set `shared_buffers` ≈ 25% RAM and `effective_cache_size` ≈ 60% RAM.

## 3. One-time prep on your laptop
```bash
# unzip the project, then:
git init && git add . && git commit -m "first version"
# create an empty PRIVATE repo on GitHub, then:
git remote add origin git@github.com:YOU/looprewards.git && git branch -M main && git push -u origin main
```
**Create the database migrations (required once, commit them):**
```bash
make migrations-local          # needs Docker. Without Docker: pip install -r requirements.txt; DEBUG=1 python manage.py makemigrations core
git add core/migrations && git commit -m "migrations" && git push
make test-local                # run the tests; fix anything that fails BEFORE deploying
```
(The server refuses to start without committed migrations – this protects your data.)

## 4. Prepare the server
1. In your domain DNS add **A records**: `yourdomain.com` → SERVER_IP and `www` → SERVER_IP. Use plain DNS (not a CDN proxy) at first.
2. From your laptop: `ssh-copy-id root@SERVER_IP` (skip if you added the key at order time).
3. `scp deploy/setup-server.sh root@SERVER_IP:/root/ && ssh root@SERVER_IP "bash /root/setup-server.sh"`
   It installs Docker, firewall (only SSH/80/443), fail2ban, automatic security updates, swap, and a `deploy` user; it disables password login.
4. **Open a new terminal** and check `ssh deploy@SERVER_IP` works before closing the first one.

## 5. First deploy
```bash
ssh deploy@SERVER_IP
ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519 && cat ~/.ssh/id_ed25519.pub
#   -> GitHub repo > Settings > Deploy keys > Add (read-only)
git clone git@github.com:YOU/looprewards.git && cd looprewards
cp .env.example .env && nano .env        # fill every CHANGE line
#   secrets: openssl rand -base64 48     (use for SECRET_KEY and POSTGRES_PASSWORD)
make deploy                               # builds, migrates, starts, health-checks
make superuser                            # your admin login
```
Open `https://yourdomain.com/admin` (Caddy gets the HTTPS certificate automatically; takes a minute the first time). The app is at `https://yourdomain.com/app/`.

## 6. Connect the money and messages
- **Razorpay:** put `RAZORPAY_KEY_ID/SECRET` in `.env`. Dashboard → Webhooks → URL `https://yourdomain.com/api/billing/webhook/`, set a secret (same as `RAZORPAY_WEBHOOK_SECRET`), events: `payment.captured`, `order.paid`, `subscription.charged`. For auto-renew create a Monthly and a Yearly plan (Subscriptions → Plans) and put their ids in `.env`.
- **Your UPI:** `PLATFORM_UPI_ID` for the "pay by QR" option; approve those payments in `/admin → Payments`.
- **SMS/WhatsApp:** `NOTIFY_WEBHOOK_URL` = a small endpoint of yours that receives `{"mobile","text"}` and calls your provider. Set `NOTIFY_SMS=1` for reward alerts.
- After editing `.env`: `docker compose up -d` (restarts changed services).

## 7. Pilot checklist (do on test domain, then with 10–20 real shops)
- [ ] Register owner → create shop → publish reward → print A6 card (also Hindi)
- [ ] Customer scans QR on a phone → registers → "I purchased" → owner approves → progress moves → reward code → redeem
- [ ] Counter-code screen: customer scans and gets instant approval; far-away entry is flagged
- [ ] Razorpay **test mode** payment, then webhook arrives (check `/admin → Payments` shows paid + invoice opens)
- [ ] Auto-renew in test mode; cancel works
- [ ] UPI-QR payment + admin approve
- [ ] Agent signs up, you approve, referral shop pays, commission appears in `/admin → Commissions`
- [ ] Forgot-password OTP, delete account
- [ ] `docker compose restart web` – the app comes back; run `make backup` and a test restore on a spare machine
- [ ] Legal pages: fill the legal block in `.env`, open `/privacy/ /terms/ /refund/ /pricing/ /contact/`, read them once, **have a lawyer review**, then give those URLs to Razorpay

## 8. Updating (every future change)
```
laptop:  change code → make test-local → git commit → git push        (GitHub runs the tests too)
         changed models?  make migrations-local → commit core/migrations too
server:  cd ~/looprewards && make deploy
```
`make deploy` = pull latest → automatic backup → rebuild → restart → health check. Users see a few seconds of interruption.
- Problem after deploy? `make rollback` returns to the previous code (migrations are not undone; for a bad data migration restore the backup).
- Add features in small releases; never edit files directly on the server.
- Safe migration habit: add new columns/tables first (nullable), deploy; remove old ones in a later release.

**Backups** (set once): `crontab -e` as `deploy`, add
`15 3 * * * cd /home/deploy/looprewards && ./deploy/backup.sh >> backups/backup.log 2>&1`
It keeps 14 days locally. **Local backups die with the server** – also copy offsite: install `rclone`, configure Contabo Object Storage (S3) or any cloud, set `RCLONE_REMOTE=remote:bucket` in `.env`.
Restore DB: `./deploy/restore.sh backups/db-DATE.dump`. Restore uploads: `docker run --rm -v looprewards_media:/m -v $PWD/backups:/b alpine tar xzf /b/media-DATE.tgz -C /m`. **Test a restore once a month.**

## 9. Monitoring (free)
- UptimeRobot/BetterStack: monitor `https://yourdomain.com/healthz`, alert to your phone.
- Errors: create a free Sentry project, put the DSN in `SENTRY_DSN`.
- Look: `make ps`, `make logs`, `docker stats`, `df -h` (disk), `free -h`.
- Weekly: check `/api/admin/stats/` (staff token) – shops, subscription states, 30-day revenue; check Payments "pending" UPI approvals and Payouts due on the 1st.

## 10. Growing to a large market (in this order)
1. **Cloudflare in front** (DDoS/caching): switch DNS proxy on, SSL mode *Full (strict)*, set `NUM_PROXIES=2` in `.env`.
2. **Bigger server** (resize in Contabo) – cheapest first step; raise `WEB_WORKERS` (≈ vCPU) and Postgres memory settings.
3. **Move the database off the app server** (second VPS or managed Postgres); point `POSTGRES_HOST` to it; keep nightly dumps.
4. **Uploaded files to object storage** (S3-compatible) before running more than one app server (add `django-storages`).
5. **Several app servers** behind a load balancer (Caddy/HAProxy or Contabo LB); run the `cron` container on **one** server only.
6. **Queue for messages and heavy jobs** (Celery/RQ with the Redis you have): SMS currently goes via a background thread that is lost if the container restarts; reports are computed live and should be cached/pre-computed for shops with very large histories.
7. Postgres read replica for reports; consider partitioning `PurchaseEntry` when it passes hundreds of millions of rows.
Before each step: load-test (k6/Locust) the scan → login → "I purchased" → approve flow.

## 11. Security checklist
- [ ] `DEBUG=0`, long random `SECRET_KEY`, strong DB password (app refuses to start otherwise)
- [ ] Firewall: only 22/80/443 (Postgres/Redis are not exposed); SSH keys only
- [ ] `.env` never in git; Razorpay keys only in `.env`
- [ ] Admin: strong password, create only the staff you need; log in at `/admin` only over HTTPS
- [ ] Rate limits on login/OTP are on (need Redis – already in compose)
- [ ] Contabo snapshot before big changes; offsite backups on
- [ ] Privacy policy + consent wording reviewed by a lawyer (DPDP); GST invoice format by your CA; agent commission/TDS by your CA

## 12. Launching to many shops – practical plan
1. **Pilot** 10–20 shops in one area (PRD open question 4): free trial, visit weekly, fix friction.
2. **Agents** drive growth: approve them, set commission, give each their link `https://yourdomain.com/app/?ref=CODE`; agents can register a shop for an owner on the spot and print the counter card.
3. Per area: aim for density (many shops in one market) so customers see QR everywhere – then repeat in the next area.
4. Weekly: read the report numbers (repeat rate, rewards redeemed), talk to the 3 worst and best shops.
5. Keep a support WhatsApp number on the print card/app (add to the card text) – owners are low-tech.

## 13. Troubleshooting
| Symptom | Check |
|---|---|
| Site not loading / no HTTPS | DNS A record correct? ports 80/443 open? `docker compose logs caddy` |
| `core/migrations is missing` | do section 3 (migrations), push, `make deploy` |
| 400 "Bad Request" | `ALLOWED_HOSTS` / `CSRF_TRUSTED_ORIGINS` in `.env` match your domain |
| Payments not activating | Razorpay webhook URL/secret/events; `docker compose logs web | grep billing` |
| Everyone gets "throttled" | `NUM_PROXIES` wrong (1 without Cloudflare, 2 with) |
| Disk filling | `docker system df`, `backups/` size, old images: `docker image prune -a` |
| Restart everything | `docker compose up -d` (data is safe in volumes) |

## 14. File map
`docker-compose.yml` services · `Dockerfile` app image · `deploy/Caddyfile` HTTPS/proxy · `deploy/*.sh` setup, deploy, rollback, backup, restore · `Makefile` shortcuts · `.env.example` all settings · `.github/workflows/test.yml` automatic tests · `core/` the app (models, services, billing, vendors, reports, web/app.html PWA) · `config/` Django settings.

## 15. Subscription lifecycle – a shop pays 1 month, stops, returns after 3–4 months
| When | What the system does | What the owner / customers see |
|---|---|---|
| Day 0–14 | Free trial (once per owner) | Everything works |
| Pays Monthly | Active for 30 days, invoice created, agent commission on hold 30 days | Everything works |
| Day 30, not renewed | **Pause period (30 days):** shop page + QR show "paused", nobody can earn. **Nothing is deleted.** Owner can still log in, print card, see reports, and **redeem rewards already earned** | Owner gets reminders at expiry, day 7, day 25 |
| Day 60 | **Expired:** QR + print kit disabled; data kept for `RETENTION_MONTHS` (default 12) | Win-back messages at ~2 and ~5 months after pause, final notice 30 days before deletion |
| **Returns at month 3–4** and pays any plan | Active again **immediately**: same shop code (old printed QRs work), programs, customers, progress and rewards all back. Period starts from the payment day (no back-charge). Customers' unredeemed rewards get their expiry **extended by the paused time**. No second free trial. Owner gets a "Welcome back" notice | Everything as before |
| Returns after 12+ months | Data was permanently deleted by `purge_lapsed`; the owner starts a new shop with a new QR | Told in advance by the final-notice message |

How to run it professionally:
- **Win-back calls:** `/admin → Subscriptions`, sort by `paid_until` – lapsed shops are your warmest leads for agents.
- **Agent commission after a return:** the shop stays attributed to the original agent and commission is paid on the new payment (set `COMMISSION_FIRST_YEAR_ONLY=1` if you want only year one).
- **Auto-renew failures:** if Razorpay stops charging (card/UPI limit), the owner gets "auto-renew failed" and the plan lapses as above; they can renew in one tap.
- **Deletion is safe by default:** `purge_lapsed` only *prints* what it would delete. Review the daily log (`docker compose logs cron`), and when you are comfortable set `AUTO_PURGE=1` in `.env` (then `docker compose up -d`). Your Privacy Policy promises this deletion, so enable it before you have shops older than 13+ months.
- Change the numbers in `.env` (`RETENTION_MONTHS`) and `config/settings.py` (`TRIAL_DAYS`, `GRACE_DAYS`, `PLANS`); the legal and pricing pages update automatically.

## 16. Legal pages (Razorpay + DPDP)
- Pages: `/privacy/`, `/terms/`, `/refund/`, `/pricing/`, `/contact/` – linked in the app footer; registration requires ticking agreement (the time is stored per user); owners created by an agent are asked to accept at first login; marketing offers need a separate opt-in.
- Set in `.env`: `SELLER_NAME`, `SELLER_ADDRESS`, `SUPPORT_EMAIL`, `SUPPORT_PHONE`, `GRIEVANCE_NAME/EMAIL`, `JURISDICTION`, `HOSTING_REGION`, `LEGAL_UPDATED`.
- These are **templates written to match what the app really does** (data it stores, retention, deletion, the refund rules). I am not a lawyer: have a lawyer check them and adjust the refund rules (the 7-day yearly refund and liability cap are suggestions, edit `core/templates/legal/`), and update `LEGAL_UPDATED` when you change them. If you add a new data type or third party, update the privacy page first.
- Razorpay account review usually wants: business details, contact page, pricing, Terms, Privacy, Refund/Cancellation – all present at the URLs above.
