/* Firaao v2 customer screens: wallet home, shop page (earn / rewards / book / history / invite), rewards, bookings. */
(function (FX) {
  'use strict';
  const { h, t, api, S, field, inp, sel, pill, empty, avatar, stampRow, tierPill, toast, modal, busy } = Object.assign({}, FX, { t: FX.t, S: FX.S });
  const R = FX.routes.customer;
  const TYPE_HINT = { count: 'How many?', amount: 'Bill amount (₹)', visit: 'Visit' };

  /* ---------- home: one punch card per shop ---------- */
  function shopCard(s) {
    const b = s.best, tier = s.tier;
    return h('a.shopcard', { href: '/b/' + s.shop_code + '/', style: FX.shopVars(s.brand_color), 'aria-label': s.shop },
      h('div.row', h('div.logo-s', s.logo_url ? h('img', { src: s.logo_url, alt: '' }) : FX.initial(s.shop)), h('div.grow', h('h3', s.shop), h('small', t(s.category === 'other' ? 'Shop' : s.category.charAt(0).toUpperCase() + s.category.slice(1)))),
        tierPill(tier.tier)),
      b ? h('div.stack.s', h('div.row.between', h('small', b.title), h('small.num', FX.fmtVal(b.type, b.current) + ' / ' + FX.fmtVal(b.type, b.target))),
        stampRow(b.current, b.target, b.type) || h('div.meter', h('i', { style: { width: b.pct + '%' } })),
        b.rewards[0] ? h('small', t('Reward: {r}', { r: b.rewards[0].title })) : null) : h('small', t('Make your first purchase to start collecting.')),
      h('div.meta', s.active_rewards ? h('span.pill', '🎁 ' + t('{n} reward ready', { n: s.active_rewards })) : null,
        s.streak ? h('span.pill', '🔥 ' + t('{n}-week streak', { n: s.streak })) : null,
        s.boosts_now[0] ? h('span.pill', '⚡ ' + s.boosts_now[0].multiplier + 'x ' + t('today')) : null,
        s.next_booking ? h('span.pill', '📅 ' + FX.fmtDT(s.next_booking.starts_at)) : null,
        tier.next ? h('small', t('{n} more visits to {tier}', { n: tier.to_next, tier: t(tier.next === 'gold' ? 'Gold' : 'Silver') })) : null));
  }
  R[''] = async function () {
    const w = await api('me/wallet/');
    const code = inp({ ph: 'Shop code', maxlength: 12, 'aria-label': t('Shop code') });
    return h('div.stack.l',
      h('div', h('h1', t('Hi {name}', { name: (S.user && S.user.name) || '' })), h('p.muted', w.shops.length ? t('{n} rewards ready to use', { n: w.total_rewards }) : t('Scan a shop QR code to get your first stamp.'))),
      w.shops.length ? h('div.g2', w.shops.map(shopCard)) : empty('No shops yet', 'Scan the QR code at your favourite shop, or enter its code below.'),
      h('div.card.stack', h('h3', t('Add a shop by code')), h('div.row', code, h('button.btn', { onclick: () => { const c = code.value.trim(); if (c) location.href = '/b/' + encodeURIComponent(c) + '/'; } }, t('Open')))));
  };

  /* ---------- logged-out shop page (QR landing) ---------- */
  FX.publicShop = async function (code) {
    let biz;
    try { biz = await api('b/' + code + '/'); } catch (e) { return h('div.page', empty('Shop not found', 'Check the code and try again.', h('a.btn', { href: '/app/' }, t('Go to Firaao')))); }
    if (biz.paused) return h('div.page', empty(biz.name, 'This shop is not taking rewards right now.'));
    const perk = biz.perks && biz.perks.welcome;
    return h('div.page', { style: 'max-width:720px' }, head(biz),
      h('div.card.stack', { style: 'margin-top:16px' }, h('h2', t('Collect rewards at {shop}', { shop: biz.name })),
        h('p.muted', t('Join in 10 seconds with your mobile number. No app to install.')),
        perk ? h('div.banner.green', '🎁 ' + t('Welcome gift: {r}', { r: perk.title })) : null,
        biz.boosts_now.length ? h('div.boost', '⚡ ' + biz.boosts_now[0].title + ' (' + biz.boosts_now[0].multiplier + 'x)') : null,
        biz.programs.slice(0, 1).map(p => h('div.stack.s', p.tasks.map(tk => h('div.li', h('span', '✦'), h('div.grow', h('b', tk.title), tk.rewards[0] ? h('div.small.muted', t('Reward: {r}', { r: tk.rewards[0].title })) : null))))),
        h('button.btn.lg', { onclick: () => { const m = modal(t('Join {shop}', { shop: biz.name }), FX.authScreen({ mode: 'register', role: 'customer' }).querySelector('.form')); } }, t('Join and start earning')),
        h('button.btn.ghost', { onclick: () => { const m = modal(t('Log in'), FX.authScreen({ mode: 'login' }).querySelector('.form')); } }, t('I already have an account'))),
      biz.services.length ? h('div.card', h('h3', t('Services')), biz.services.map(s => h('div.li', h('span.grow', s.name), h('b.num', FX.rupee(s.price))))) : null);
  };

  function head(biz) {
    const c = FX.shopVars(biz.brand_color);
    const links = [biz.phone && h('a.btn.ghost.sm', { href: 'tel:' + biz.phone }, t('Call')), biz.whatsapp && h('a.btn.ghost.sm', { href: 'https://wa.me/' + biz.whatsapp.replace(/\D/g, ''), target: '_blank', rel: 'noopener' }, 'WhatsApp'), biz.maps_url && h('a.btn.ghost.sm', { href: biz.maps_url, target: '_blank', rel: 'noopener' }, t('Directions'))].filter(Boolean);
    return h('div.stack', h('div.shophead', { style: c }, h('div.logo-s', biz.logo_url ? h('img', { src: biz.logo_url, alt: '' }) : FX.initial(biz.name)),
      h('div.grow', h('h1', biz.name), h('div.small', biz.tagline || biz.address || ''))),
      biz.about ? h('p.muted', biz.about) : null, biz.hours ? h('p.small.muted', t('Open: {h}', { h: biz.hours })) : null, links.length ? h('div.row.wrap', links) : null);
  }

  /* ---------- logged-in shop page ---------- */
  FX.shopPage = async function (code, tab) {
    let biz = await api('b/' + code + '/'), me;
    if (biz.paused) return empty(biz.name, 'This shop is not taking rewards right now.');
    try { me = await api('me/shop/' + code + '/'); } catch (e) { me = null; }
    if (!me) return joinView(biz);
    tab = tab || sessionStorage['tab_' + code] || 'earn';
    const body = h('div.stack');
    const tabs = [['earn', 'Earn'], ['rewards', 'Rewards' + (me.active_rewards ? ' (' + me.active_rewards + ')' : '')]];
    if (biz.bookings_enabled && biz.services.length) tabs.push(['book', 'Book']);
    tabs.push(['history', 'History'], ['invite', 'Invite']);
    const bar = h('div.seg', { role: 'tablist', style: 'overflow:auto;max-width:100%' });
    const draw = () => {
      sessionStorage['tab_' + code] = tab;
      bar.replaceChildren(...tabs.map(([k, l]) => h('button', { role: 'tab', 'aria-selected': String(k === tab), onclick: () => { tab = k; draw(); } }, t(l.split(' (')[0]) + (l.includes('(') ? ' (' + me.active_rewards + ')' : ''))));
      body.replaceChildren(({ earn: earnTab, rewards: rewardsTab, book: bookTab, history: historyTab, invite: inviteTab })[tab](biz, me));
    };
    draw();
    const ti = me.tier;
    return h('div.stack.l', { style: Object.assign({ maxWidth: '760px', margin: '0 auto', width: '100%' }, FX.shopVars(biz.brand_color)) }, head(biz),
      h('div.card.row.between.wrap', h('div.row', tierPill(ti.tier), h('div', h('div.bold', t('{n} visits', { n: ti.visits })), ti.perk ? h('small.muted', ti.perk) : null)),
        ti.next ? h('small.muted', t('{n} more visits to {tier}', { n: ti.to_next, tier: t(ti.next === 'gold' ? 'Gold' : 'Silver') }) + (ti.next_perk ? ': ' + ti.next_perk : '')) : h('small.muted', t('Top tier reached')),
        me.streak ? h('span.flame', '🔥 ' + t('{n}-week streak', { n: me.streak })) : h('small.muted', t('Visit this week to start a streak'))),
      me.boosts_now[0] ? h('div.boost', '⚡ ' + t('{t}: earn {n}x stamps right now', { t: me.boosts_now[0].title, n: me.boosts_now[0].multiplier })) : null,
      bar, body);
  };

  function joinView(biz) {
    const consent = h('input', { type: 'checkbox', checked: true });
    const ref = new URLSearchParams(location.search).get('ref') || '';
    const perk = biz.perks && biz.perks.welcome;
    return h('div.stack.l', { style: 'max-width:720px;margin:0 auto' }, head(biz), h('div.card.stack', h('h2', t('Join {shop}', { shop: biz.name })),
      perk ? h('div.banner.green', '🎁 ' + t('Welcome gift: {r}', { r: perk.title })) : null,
      biz.tiers.length ? h('p.muted', biz.tiers.map(x => t(x.tier === 'gold' ? 'Gold' : 'Silver') + ' = ' + x.visits + ' ' + t('visits')).join('  ·  ')) : null,
      h('label.check', consent, h('span', t('Send me offers from this shop (you can turn this off any time)'))),
      h('button.btn.lg', { onclick: e => busy(e.target, async () => { await api('b/' + biz.shop_code + '/join/', 'POST', { consent: consent.checked, ref }); FX.start(true); }) }, t('Join now'))));
  }

  /* ---------- earn ---------- */
  function earnTab(biz, me) {
    const live = me.live && me.status === 'active';
    const list = me.tasks.map(tk => h('div.task', h('div.row.between', h('b', tk.title), tk.repeatable && tk.completed ? pill(t('Earned {n}x', { n: tk.completed }), 'ok') : null),
      stampRow(tk.current, tk.target, tk.type, true) || null,
      h('div.bar', h('i', { style: { width: tk.pct + '%' } })),
      h('div.row.between', h('small.muted', FX.fmtVal(tk.type, tk.current) + ' / ' + FX.fmtVal(tk.type, tk.target)), tk.rewards[0] ? h('small', '🎁 ' + tk.rewards[0].title) : null),
      live ? h('button.btn.soft', { onclick: () => submitModal(biz, me, tk) }, t('I made a purchase')) : null));
    const pend = me.entries.filter(e => e.status === 'pending');
    return h('div.stack', me.status === 'blocked' ? h('div.banner.red', t('This shop has paused your account.')) : null,
      pend.length ? h('div.banner.blue', '⏳ ' + t('{n} purchase waiting for the shop to confirm', { n: pend.length })) : null,
      list.length ? list : empty('No rewards running right now', 'Check back soon.'),
      biz.pay_link ? h('a.btn.ghost', { href: biz.pay_link }, t('Pay with UPI')) : null);
  }
  async function submitModal(biz, me, tk) {
    const q = new URLSearchParams(location.search);
    const val = tk.type === 'visit' ? null : inp({ type: 'number', inputmode: 'decimal', min: '1', step: tk.type === 'amount' ? '0.01' : '1', value: tk.type === 'count' ? '1' : '' });
    const cc = inp({ inputmode: 'numeric', maxlength: 6, value: q.get('c') || '', ph: '6-digit counter code' });
    const bill = biz.require_bill_photo ? h('input', { type: 'file', accept: 'image/*', capture: 'environment' }) : null;
    const err = h('div.err');
    const go = h('button.btn.lg', { onclick: () => busy(go, async () => {
      err.textContent = '';
      const fd = new FormData();
      fd.append('task', tk.task_id); fd.append('value', val ? val.value : '1');
      if (cc.value.trim()) fd.append('counter_code', cc.value.trim());
      if (bill && bill.files[0]) fd.append('bill_photo', bill.files[0]);
      const pos = await FX.getPos(); if (pos) { fd.append('lat', pos.latitude); fd.append('lng', pos.longitude); }
      try {
        const r = await api('entries/', 'POST', fd); m.close();
        toast(r.status === 'approved' ? t('Stamp added!') : t('Sent to the shop for confirmation.'));
        FX.start(true);
      } catch (x) { err.textContent = x.message; }
    }) }, t('Submit'));
    const m = modal(tk.title, h('div.stack', val ? field(TYPE_HINT[tk.type], val) : h('p.muted', t('Records one visit.')),
      field('Counter code', cc, 'Optional. Scan the QR at the counter for instant approval.'), bill ? field('Bill photo', bill) : null, err, go));
  }

  /* ---------- rewards ---------- */
  const ticket = (g, shop) => h('div.ticket.' + g.status, h('div.main', h('b', g.title), shop ? h('small.muted', shop) : null,
    g.terms ? h('small.muted', g.terms) : null, h('small', g.status === 'active' ? FX.until(g.expires_at) : t(g.status === 'used' ? 'Used' : g.status === 'expired' ? 'Expired' : 'Cancelled')),
    g.trigger === 'welcome' ? pill(t('Welcome gift'), 'ok') : g.trigger === 'referral' ? pill(t('Referral reward'), 'info') : null),
    h('div.stub', h('small.muted', t('Show this code')), h('div.code', g.code), g.status === 'active' ? h('button.btn.ghost.sm', { onclick: () => FX.copy(g.code) }, t('Copy')) : null));
  function rewardsTab(biz, me) {
    const act = me.rewards.filter(g => g.status === 'active'), old = me.rewards.filter(g => g.status !== 'active');
    return h('div.stack', act.length ? act.map(g => ticket(g)) : empty('No rewards ready', 'Keep collecting stamps. Your rewards appear here.'),
      old.length ? h('details', h('summary.muted', t('Past rewards ({n})', { n: old.length })), h('div.stack', { style: 'margin-top:10px' }, old.map(g => ticket(g)))) : null);
  }
  R.rewards = async function () {
    const w = await api('me/wallet/'), groups = [];
    for (const s of w.shops) { if (!s.active_rewards) continue; const me = await api('me/shop/' + s.shop_code + '/'); groups.push([s, me.rewards.filter(g => g.status === 'active')]); }
    return h('div.stack.l', h('h1', t('My rewards')), groups.length ? groups.map(([s, gs]) => h('div.stack', h('h3', s.shop), gs.map(g => ticket(g)))) : empty('No rewards ready', 'Keep collecting stamps. Your rewards appear here.'));
  };

  /* ---------- history + rating ---------- */
  function rateModal(entry) {
    let v = 0; const c = inp({ maxlength: 300, ph: 'Tell the shop how it went (optional)' });
    const m = modal(t('Rate your visit'), h('div.stack', FX.stars(0, n => { v = n; }), c, h('button.btn', { onclick: e => busy(e.target, async () => { if (!v) throw new Error(t('Choose a rating from 1 to 5.')); await api('feedback/', 'POST', Object.assign({ rating: v, comment: c.value }, entry)); m.close(); toast(t('Thanks for your feedback!')); FX.start(true); }) }, t('Send'))));
  }
  function historyTab(biz, me) {
    return h('div.card', me.entries.length ? me.entries.map(e => h('div.li', h('div.grow', h('b', e.task_title), h('div.small.muted', FX.fmtDT(e.created_at))),
      e.multiplier > 1 ? pill(e.multiplier + 'x', 'warn') : null,
      e.status === 'approved' && !e.rated ? h('button.btn.ghost.sm', { onclick: () => rateModal({ entry: e.id }) }, '★ ' + t('Rate')) : null,
      pill(t(e.status === 'approved' ? 'Approved' : e.status === 'pending' ? 'Waiting' : e.status === 'rejected' ? 'Declined' : 'Reversed'), e.status === 'approved' ? 'ok' : e.status === 'pending' ? 'warn' : 'bad'))) : empty('No activity yet'));
  }

  /* ---------- invite ---------- */
  function inviteTab(biz, me) {
    const text = t('Join me at {shop} and earn rewards!', { shop: biz.name });
    return h('div.card.stack', h('h3', t('Invite friends')), h('p.muted', me.referral_reward ? t('When a friend makes their first purchase, you get: {r}', { r: me.referral_reward }) : t('Share this shop with friends.')),
      h('div.row.between', h('div', h('small.muted', t('Your code')), h('div.num.bold', { style: 'font-size:26px;letter-spacing:.1em' }, me.referral_code)), h('small.muted', t('{n} friends joined', { n: me.friends_referred }))),
      h('div.row.wrap', h('button.btn', { onclick: () => FX.share(text, me.referral_url) }, t('Share on WhatsApp')), h('button.btn.ghost', { onclick: () => FX.copy(me.referral_url) }, t('Copy link'))));
  }

  /* ---------- booking ---------- */
  function bookTab(biz, me) {
    const svc = sel(biz.services.map(s => [s.id, s.name + ' (' + FX.rupee(s.price) + ', ' + s.duration_min + ' min)']), biz.services[0].id);
    const d = new Date(Date.now() + 36e5); d.setMinutes(0, 0, 0);
    const iso = new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
    const when = inp({ type: 'datetime-local', value: iso, min: iso }), note = inp({ maxlength: 200, ph: 'Note for the shop (optional)' });
    const mine = me.bookings.filter(b => ['requested', 'confirmed'].includes(b.status));
    return h('div.stack', h('div.card.stack', h('h3', t('Book a service')), field('Service', svc), field('Date and time', when), field('Note', note),
      h('button.btn.lg', { onclick: e => busy(e.target, async () => { await api('b/' + biz.shop_code + '/bookings/', 'POST', { service: svc.value, starts_at: new Date(when.value).toISOString(), note: note.value }); toast(t('Booking requested. The shop will confirm.')); FX.start(true); }) }, t('Request booking'))),
      mine.length ? h('div.card', h('h3', t('Upcoming')), mine.map(bookingRow)) : null);
  }
  const bookingRow = b => h('div.li', h('div.grow', h('b', b.service_name), h('div.small.muted', FX.fmtDT(b.starts_at) + (b.shop ? ' · ' + b.shop : ''))),
    pill(t(b.status.replace('_', ' ')), b.status === 'confirmed' ? 'ok' : b.status === 'requested' ? 'warn' : b.status === 'completed' ? 'info' : 'bad'),
    ['requested', 'confirmed'].includes(b.status) ? h('button.btn.ghost.sm', { onclick: async () => { if (await FX.confirmBox(t('Cancel this booking?'), t('Cancel booking'), true)) { await api('bookings/' + b.id + '/action/', 'POST', { action: 'cancel' }); FX.render(true); FX.start(true); } } }, t('Cancel')) : null,
    b.status === 'completed' && !b.rated ? h('button.btn.ghost.sm', { onclick: () => rateModal({ booking: b.id }) }, '★ ' + t('Rate')) : null);
  R.bookings = async function () {
    const list = await api('me/bookings/');
    return h('div.stack.l', h('h1', t('My bookings')), h('div.card', list.length ? list.map(bookingRow) : empty('No bookings yet', 'Open a shop that takes bookings to book a service.')));
  };
})(window.FX);
