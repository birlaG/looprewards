/* Firaao v2 owner screens, part 2: bookings, offers (campaigns), insights, my shop (QR, branding, rules, services, team), billing. */
(function (FX) {
  'use strict';
  const { h, api, S, field, inp, sel, pill, empty, kpi, toast, modal, busy, confirmBox } = FX;
  const t = FX.t, R = FX.routes.owner;
  const code = () => S.biz.shop_code;

  /* ---------- bookings (owner + staff) ---------- */
  async function bookingsPage() {
    const tab = (location.hash.split('/')[1]) || 'open';
    const q = tab === 'today' ? '?when=today' : tab === 'history' ? '?status=completed' : '?status=open';
    const list = await api('b/' + code() + '/bookings/' + q);
    const done = () => FX.render(true);
    return h('div.stack.l', h('h1', t('Bookings')),
      h('div.seg', [['open', 'Upcoming'], ['today', 'Today'], ['history', 'Completed']].map(([k, l]) => h('button', { 'aria-selected': String(k === tab), onclick: () => FX.go('bookings/' + k) }, t(l)))),
      h('div.card', list.length ? (tab === 'history' ? list.map(b => h('div.li', h('div.grow', h('b', b.customer + ' · ' + b.service_name), h('div.small.muted', FX.fmtDT(b.starts_at))), b.rated ? pill('★', 'ok') : null)) : FX.bookingQueue(list, done)) : empty('Nothing here', 'Booking requests from customers appear here.')));
  }
  R.bookings = FX.routes.staff.bookings = bookingsPage;

  /* ---------- offers / campaigns ---------- */
  R.campaigns = async function (args) {
    let seg = FX.SEG.some(s => s[0] === args[0]) && args[0] !== 'never' ? args[0] : 'all';
    const text = h('textarea', { maxlength: 200, placeholder: t('e.g. We miss you! Show this message for double stamps this week.') });
    const info = h('p.muted'), count = h('small.muted', '0/200');
    text.addEventListener('input', () => { count.textContent = text.value.length + '/200'; });
    const SAMPLES = { at_risk: 'We miss you! Visit this week and earn double stamps.', lapsed: 'It has been a while. Come back and we will add a welcome-back gift.', new: 'Thanks for joining! Visit again this week to earn your next stamp faster.', regular: 'You are one of our best customers. A thank-you treat is waiting for you.', all: 'Double stamps this weekend. See you soon!' };
    const chipsBox = h('div'), go = h('button.btn.lg', { onclick: () => busy(go, async () => { if (!text.value.trim()) throw new Error(t('Write the offer text.')); const r = await api('b/' + code() + '/campaign/', 'POST', { text: text.value, segment: seg }); toast(t('Sent to {n} customers', { n: r.sent })); text.value = ''; }) }, t('Send offer'));
    const draw = async () => {
      chipsBox.replaceChildren(h('div.chips', FX.SEG.filter(s => s[0] !== 'never').map(([k, l]) => h('button.chip', { 'aria-pressed': String(k === seg), onclick: () => { seg = k; if (!text.value) text.value = ''; draw(); } }, t(l)))));
      try { const r = await api('b/' + code() + '/campaign/?segment=' + seg); info.textContent = t('{n} customers will receive this (only those who agreed to offers).', { n: r.audience }); go.disabled = !r.audience; } catch (e) { info.textContent = e.message; }
    };
    await draw();
    return h('div.stack.l', { style: 'max-width:680px' }, h('div', h('h1', t('Offers')), h('p.muted', t('Message customers who agreed to receive offers. Win-back messages bring lapsed customers back.'))),
      h('div.card.stack', h('h3', t('Who should get it?')), chipsBox, info, field('Message', text), h('div.row.between', count, h('button.btn.ghost.sm', { onclick: () => { text.value = t(SAMPLES[seg]); text.dispatchEvent(new Event('input')); } }, t('Use a sample'))), go),
      h('p.small.muted', t('To protect customers, each audience can get one offer a day and you can send up to 3 a day.')));
  };

  /* ---------- insights ---------- */
  R.insights = async function () {
    const days = +(location.hash.split('/')[1]) || 30;
    const [d, fb] = await Promise.all([api('b/' + code() + '/insights/?days=' + days), api('b/' + code() + '/feedback/')]);
    const k = d.kpis, segName = Object.fromEntries(FX.SEG);
    const maxHour = Math.max(1, ...d.hours.map(x => x.count));
    return h('div.stack.l', h('div.hd', h('div', h('h1', t('Insights')), h('p.muted', t('See who comes back and when'))),
      h('div.seg', [7, 30, 90].map(n => h('button', { 'aria-selected': String(n === days), onclick: () => FX.go('insights/' + n) }, t('{n} days', { n }))))),
      h('div.g4', kpi('Customers', k.customers), kpi('New customers', k.new_in_period), kpi('Come back rate', k.repeat_rate + '%'), kpi('Returning visits', k.returning_share + '%', t('of {n} visits', { n: k.visits_in_period }))),
      h('div.g4', kpi('Tracked sales', FX.rupee(k.tracked_sales), t('Spend-type tasks only')), kpi('Rewards used', k.redeem_rate + '%', t('{a} of {b} issued', { a: k.rewards_redeemed, b: k.rewards_issued })), kpi('Average rating', k.rating_avg ? k.rating_avg + ' ★' : '-', t('{n} reviews', { n: k.rating_count })), kpi('Upcoming bookings', k.bookings_upcoming)),
      h('div.card', h('h3', t('Visits per day')), FX.barChart(d.series, 'visits')),
      h('div.g2', h('div.card', h('h3', t('Busiest days')), FX.hbars(d.weekday.map((n, i) => [FX.wd(i), n]))),
        h('div.card', h('h3', t('Customer groups')), FX.hbars(Object.entries(d.segments).map(([s, n]) => [t(segName[s] || s), n])))),
      d.hours.length ? h('div.card', h('h3', t('Busiest hours')), FX.hbars(d.hours.map(x => [(x.hour % 12 || 12) + (x.hour < 12 ? ' am' : ' pm'), x.count]))) : null,
      h('div.card', h('h3', t('Recent feedback')), fb.length ? fb.slice(0, 10).map(f => h('div.li', h('div.grow', FX.stars(f.rating), f.comment ? h('p.small', f.comment) : null, h('small.muted', f.customer + ' · ' + FX.ago(f.created_at))))) : empty('No feedback yet', 'Customers can rate a visit after it is approved.')));
  };

  /* ---------- my shop ---------- */
  function printKit() {
    let bw = false;
    const links = h('div.row.wrap');
    const draw = () => links.replaceChildren(...[['a6', 'Counter card A6'], ['a5', 'A5 poster'], ['a4', 'A4 poster'], ['tent', 'Table tent']].map(([s, l]) => h('a.btn.ghost.sm', { href: '/print/' + code() + '/?size=' + s + (bw ? '&bw=1' : ''), target: '_blank', rel: 'noopener' }, t(l))));
    draw();
    return h('div.stack.s', links, h('label.check', h('input', { type: 'checkbox', onchange: e => { bw = e.target.checked; draw(); } }), h('span', t('Black and white (cheaper to print)'))));
  }
  function servicesCard(biz) {
    const box = h('div.stack.s');
    const edit = (s) => {
      const name = inp({ value: s ? s.name : '', maxlength: 80 }), price = inp({ type: 'number', min: '0', value: s ? s.price : 0 }), dur = inp({ type: 'number', min: '5', max: '600', value: s ? s.duration_min : 30 });
      const m = modal(t(s ? 'Edit service' : 'New service'), h('div.stack', field('Name', name), h('div.g2', field('Price (₹)', price), field('Minutes', dur)), h('div.row',
        s ? h('button.btn.danger', { onclick: e => busy(e.target, async () => { await api('services/' + s.id + '/', 'DELETE'); m.close(); load(); }) }, t('Delete')) : null,
        h('button.btn.grow', { onclick: e => busy(e.target, async () => { const b = { name: name.value, price: price.value, duration_min: dur.value }; await api(s ? 'services/' + s.id + '/' : 'b/' + code() + '/services/', s ? 'PATCH' : 'POST', b); m.close(); load(); }) }, t('Save')))));
    };
    const load = async () => { const l = await api('b/' + code() + '/services/'); box.replaceChildren(...(l.length ? l.map(s => h('div.li.click', { onclick: () => edit(s) }, h('span.grow', s.name + (s.active ? '' : ' (' + t('hidden') + ')')), h('small.muted', s.duration_min + ' min'), h('b.num', FX.rupee(s.price)))) : [h('p.muted', t('Add the services customers can book.'))])); };
    load();
    const on = h('input', { type: 'checkbox', checked: biz.bookings_enabled, onchange: e => busy(e.target, async () => { await api('b/' + code() + '/settings/', 'PATCH', { bookings_enabled: e.target.checked }); await FX.reloadShops(); toast(t('Saved')); }) });
    return h('div.card.stack', h('div.hd', h('h3', t('Services and bookings')), h('button.btn.soft.sm', { onclick: () => edit(null) }, '+ ' + t('Add service'))),
      h('label.check', on, h('span', t('Let customers request appointments online'))), box,
      h('small.muted', t('When you mark a booking completed, the visit is added to your reward programs automatically.')));
  }
  function teamCard() {
    const box = h('div.stack.s');
    const load = async () => { const l = await api('b/' + code() + '/staff/'); box.replaceChildren(...(l.length ? l.map(s => h('div.li', h('span.grow', s.name || s.mobile, h('small.muted', ' ' + s.mobile)), h('button.btn.danger.sm', { onclick: async () => { if (await confirmBox(t('Remove this team member?'), t('Remove'), true)) { await api('b/' + code() + '/staff/', 'DELETE', { mobile: s.mobile }); load(); } } }, t('Remove')))) : [h('p.muted', t('Add a cashier so they can approve purchases and redeem rewards.'))])); };
    load();
    const add = () => { const n = inp({ maxlength: 60 }), mo = inp({ type: 'tel' }), pw = inp({ type: 'password', autocomplete: 'new-password' });
      const m = modal(t('Add team member'), h('div.stack', field('Name', n), field('Mobile number', mo), field('Password', pw, 'They log in with their mobile number and this password.'), h('button.btn', { onclick: e => busy(e.target, async () => { await api('b/' + code() + '/staff/', 'POST', { name: n.value, mobile: mo.value.trim(), password: pw.value }); m.close(); load(); }) }, t('Add')))); };
    return h('div.card.stack', h('div.hd', h('h3', t('Team')), h('button.btn.soft.sm', { onclick: add }, '+ ' + t('Add'))), box);
  }
  R.shop = async function () {
    const b = S.biz, url = location.origin + '/b/' + b.shop_code + '/';
    const f = { name: inp({ value: b.name, maxlength: 120 }), tagline: inp({ value: b.tagline, maxlength: 140 }), about: h('textarea', { maxlength: 600, value: b.about }), address: inp({ value: b.address }), hours: inp({ value: b.hours, ph: 'e.g. Mon-Sat 9am-9pm' }),
      phone: inp({ type: 'tel', value: b.phone }), whatsapp: inp({ type: 'tel', value: b.whatsapp, ph: 'with country code, e.g. 919876543210' }), maps_url: inp({ type: 'url', value: b.maps_url, ph: 'https://maps.google.com/...' }), pay_upi_id: inp({ value: b.pay_upi_id || '' }),
      brand_color: h('input', { type: 'color', value: b.brand_color || '#126b5c' }), language: sel([['en', 'English'], ['hi', 'हिन्दी']], b.language) };
    const logo = h('input', { type: 'file', accept: 'image/*' });
    const rules = { approval_mode: sel([['manual', 'I approve each purchase'], ['auto', 'Approve automatically']], b.approval_mode), cooldown_minutes: inp({ type: 'number', min: '0', value: b.cooldown_minutes }), daily_cap: inp({ type: 'number', min: '1', value: b.daily_cap }), max_distance_m: inp({ type: 'number', min: '0', value: b.max_distance_m || 0 }), require_bill_photo: h('input', { type: 'checkbox', checked: b.require_bill_photo }) };
    let pos = null;
    const save = (fields, extra) => async e => busy(e.target, async () => {
      let body;
      if (extra && extra.logo && extra.logo.files[0]) { body = new FormData(); body.append('logo', extra.logo.files[0]); for (const [k, v] of Object.entries(fields)) body.append(k, v.type === 'checkbox' ? v.checked : v.value); }
      else { body = {}; for (const [k, v] of Object.entries(fields)) body[k] = v.type === 'checkbox' ? v.checked : v.value; if (pos && extra && extra.geo) { body.lat = pos.latitude; body.lng = pos.longitude; } }
      if (body instanceof FormData && pos && extra.geo) { body.append('lat', pos.latitude); body.append('lng', pos.longitude); }
      await api('b/' + code() + '/settings/', 'PATCH', body); await FX.reloadShops(); toast(t('Saved')); FX.render(true);
    });
    return h('div.stack.l', { style: 'max-width:820px' }, h('h1', t('My shop')),
      h('div.card.stack', h('h3', t('Your QR code')), h('div.row.wrap', { style: 'align-items:flex-start;gap:20px' }, h('div.qrbox', h('img', { src: '/api/b/' + b.shop_code + '/qr.png', alt: 'QR', width: 196, height: 196 })),
        h('div.stack.s.grow', h('p.muted', t('Customers scan this to join and collect rewards.')), h('code', { style: 'word-break:break-all' }, url),
          h('div.row.wrap', h('button.btn.sm', { onclick: () => FX.share(t('Collect rewards at {shop}', { shop: b.name }), url) }, t('Share link')), h('button.btn.ghost.sm', { onclick: () => FX.copy(url) }, t('Copy link')), h('a.btn.ghost.sm', { href: '#/counter' }, t('Counter code screen'))), printKit()))),
      h('div.card.stack', h('h3', t('Shop page')), h('div.g2', field('Shop name', f.name), field('Tagline', f.tagline)), field('About', f.about), h('div.g2', field('Address', f.address), field('Opening hours', f.hours)),
        h('div.g2', field('Phone', f.phone), field('WhatsApp', f.whatsapp)), field('Google Maps link', f.maps_url), h('div.g2', field('UPI ID', f.pay_upi_id), field('Language', f.language)),
        h('div.row', field('Brand colour', f.brand_color), field('Logo', logo)), h('button.btn', { style: 'justify-self:start', onclick: save(f, { logo }) }, t('Save shop page'))),
      h('div.card.stack', h('h3', t('Purchase rules')), field('Approval', rules.approval_mode), h('div.g2', field('Minutes between purchases', rules.cooldown_minutes), field('Purchases per day', rules.daily_cap)),
        h('label.check', rules.require_bill_photo, h('span', t('Ask customers for a bill photo'))), field('Shop radius (metres, 0 = off)', rules.max_distance_m, 'Purchases from farther away are flagged for your review.'),
        h('button.btn.ghost.sm', { style: 'justify-self:start', onclick: async e => { pos = await FX.getPos(); toast(pos ? t('Shop location captured. Press Save.') : t('Location unavailable.'), !pos); } }, t('Use my current location as the shop location')),
        h('button.btn', { style: 'justify-self:start', onclick: save(rules, { geo: true }) }, t('Save rules'))),
      servicesCard(b), teamCard(),
      h('div.card.stack', h('h3', t('Danger zone')), h('p.muted.small', t('Making a new QR code stops the old printed QR from working.')),
        h('button.btn.danger', { style: 'justify-self:start', onclick: async () => { if (await confirmBox(t('Make a new QR code? Printed QR codes will stop working.'), t('Make new QR'), true)) { const r = await api('b/' + code() + '/regenerate-qr/', 'POST'); localStorage.fx_biz = r.shop_code; await FX.reloadShops(); FX.render(); } } }, t('Make a new QR code'))));
  };

  /* ---------- billing ---------- */
  const loadRz = () => new Promise((res, rej) => { if (window.Razorpay) return res(); const s = h('script', { src: 'https://checkout.razorpay.com/v1/checkout.js', onload: res, onerror: () => rej(new Error(t('Could not load the payment window. Check your connection.'))) }); document.head.appendChild(s); });
  R.billing = async function () {
    const s = await FX.loadSub();
    const plan = k => s.plans[k];
    const checkout = k => async e => busy(e.target, async () => {
      const order = await api('billing/order/', 'POST', { plan: k }); await loadRz();
      const widget = new window.Razorpay({ key: order.key, order_id: order.order_id, amount: order.amount,
        currency: order.currency, name: 'Firaao', description: plan(k).label, theme: { color: '#0f6b5c' },
        handler: async resp => { try { await api('billing/verify/', 'POST', resp); toast(t('Payment received. Thank you!')); await FX.loadSub(); FX.render(); } catch (x) { toast(x.message, true); } } });
      widget.on('payment.failed', resp => toast(resp.error?.description || t('Payment failed. Please try again.'), true));
      widget.open();
    });
    const subscribe = k => async e => busy(e.target, async () => {
      const r = await api('billing/autopay/', 'POST', { plan: k }); await loadRz();
      new window.Razorpay({ key: r.key, subscription_id: r.subscription_id, name: 'Firaao', description: plan(k).label, theme: { color: '#0f6b5c' },
        handler: async resp => { try { await api('billing/autopay/verify/', 'POST', { razorpay_payment_id: resp.razorpay_payment_id, razorpay_subscription_id: resp.razorpay_subscription_id, razorpay_signature: resp.razorpay_signature }); toast(t('Payment received. Thank you!')); await FX.loadSub(); FX.render(); } catch (x) { toast(x.message, true); } } }).open();
    });
    const payUpi = k => {
      const utr = inp({ maxlength: 20, autocomplete: 'off', required: true });
      const proof = inp({ type: 'file', accept: 'image/*', required: true });
      const error = h('div.err', { role: 'alert' });
      const form = h('form.stack', { onsubmit: async e => {
        e.preventDefault();
        if (!utr.value.trim() || !proof.files.length) { error.textContent = t('Enter the transaction reference and attach a payment screenshot.'); return; }
        const data = new FormData(); data.append('plan', k); data.append('utr', utr.value.trim()); data.append('proof', proof.files[0]);
        try {
          await api('billing/upi/', 'POST', data); dialog.close(); toast(t('UPI payment submitted for admin verification.'));
          await FX.loadSub(); FX.render();
        } catch (x) { error.textContent = x.message; }
      } },
        h('p.muted', t('Pay exactly {a} to the platform UPI ID, then upload the completed-payment screenshot and UTR.', { a: FX.rupee(plan(k).amount / 100) })),
        h('p', h('b', t('Platform UPI ID: {upi}', { upi: s.upi_id }))),
        h('img', { src: '/api/billing/upi-qr.png?plan=' + encodeURIComponent(k) + '&ref=' + encodeURIComponent(s.owner_ref),
          alt: t('UPI payment QR code'), width: 220, height: 220, style: 'justify-self:center;background:#fff' }),
        h('a.btn.ghost', { href: s.upi_links[k] }, t('Open UPI app')),
        field('UPI transaction reference / UTR', utr),
        field('Payment screenshot (image, up to 5 MB)', proof),
        error, h('button.btn', { type: 'submit' }, t('Submit for admin verification')));
      const dialog = modal(t('Pay by UPI'), form);
    };
    const stateTxt = { trial: t('Free trial: {n} days left', { n: s.days_until_end }), active: t('Active until {d}', { d: FX.fmtDate(s.ends) }), grace: t('Ended. Renew within {n} days to keep everything.', { n: Math.max(0, Math.ceil((new Date(s.data_until) - Date.now()) / 864e5)) }), expired: t('Plan ended') };
    const methods = s.payment_methods || {};
    const pending = s.pending_payment ? h('div.card', h('b', t('UPI payment verification pending')), h('p.small.muted', t('Transaction reference: {utr}. Your plan activates after an admin verifies the payment.', { utr: s.pending_payment.utr || '—' }))) : null;
    return h('div.stack.l', { style: 'max-width:820px' }, h('h1', t('Billing')),
      h('div.card.row.between.wrap', h('div', h('h3', stateTxt[s.state] || s.state), s.autorenew ? h('small.muted', t('AutoPay is on')) : null),
        pill(t(s.state), s.state === 'active' ? 'ok' : s.state === 'trial' ? 'info' : 'bad')),
      pending,
      s.payment_mode === 'test' ? h('p.card.small.muted', t('Razorpay test mode: payments are simulated and will not charge a real account.')) : null,
      h('div.g2', Object.keys(s.plans).map(k => h('div.card.stack', h('h3', t(plan(k).label)), h('div.num', { style: 'font-size:34px;font-weight:700' }, FX.rupee(plan(k).amount / 100)), h('small.muted', t('Includes GST. {n} days.', { n: plan(k).days })),
        methods.online ? h('button.btn' + (k === 'yearly' ? '.gold' : ''), { onclick: checkout(k) }, t('Pay securely with Razorpay')) : null,
        methods.upi ? h('button.btn.ghost', { onclick: () => payUpi(k) }, t('Pay by UPI and upload screenshot')) : null,
        s.autopay ? h('button.btn.ghost', { onclick: subscribe(k) }, t('Enable AutoPay')) : null,
        !methods.online && !methods.upi && !s.autopay ? h('p.small.muted', t('Online payments are not set up yet. Please contact support.')) : null))),
      s.autorenew ? h('button.btn.danger', { style: 'justify-self:start', onclick: async () => { if (await confirmBox(t('Turn off AutoPay? Your plan stays active until it ends.'), t('Turn off'), true)) { await api('billing/autopay/cancel/', 'POST'); toast(t('AutoPay turned off')); FX.render(); } } }, t('Turn off AutoPay')) : null,
      s.invoices && s.invoices.length ? h('div.card', h('h3', t('Invoices')), s.invoices.map(i => h('div.li', h('span.grow', i.no), h('a.btn.ghost.sm', { href: i.url, target: '_blank', rel: 'noopener' }, t('Open'))))) : null,
      h('p.small.muted', t('If payments stop, your data is kept for {m} months before deletion.', { m: s.retention_months })));
  };
})(window.FX);
