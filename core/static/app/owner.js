/* Firaao v2 owner screens, part 1: onboarding, Today (action queue), Customers CRM, Rewards studio. Also staff queue. */
(function (FX) {
  'use strict';
  const { h, api, S, field, inp, sel, pill, empty, kpi, toast, modal, busy, confirmBox } = FX;
  const t = FX.t, R = FX.routes.owner;
  const loc = () => (FX.lang === 'hi' ? 'hi-IN' : 'en-IN');
  const wd = i => new Date(2024, 0, 1 + i).toLocaleDateString(loc(), { weekday: 'short' });
  const code = () => S.biz.shop_code;
  const SEG = [['all', 'All'], ['new', 'New'], ['regular', 'Regular'], ['at_risk', 'Slipping away'], ['lapsed', 'Lapsed'], ['never', 'Not yet bought']];
  FX.SEG = SEG; FX.wd = wd;

  /* ---------- onboarding wizard: pick a business type, get a complete setup ---------- */
  R.start = async function () {
    const types = await api('blueprints/');
    let pick = 'cafe', step = 1;
    const name = inp({ maxlength: 120, ph: 'Business name' }), upi = inp({ ph: 'yourname@upi (optional)' }), addr = inp({ ph: 'Area or address (optional)' });
    const box = h('div.stack.l', { style: 'max-width:720px;margin:0 auto' });
    const draw = () => {
      const bp = types.find(x => x.key === pick), err = h('div.err');
      box.replaceChildren(h('div.steps', [1, 2].map(i => h('i' + (i <= step ? '.on' : '')))),
        step === 1 ? h('div.stack.l', h('div', h('h1', t('Set up your rewards in a minute')), h('p.muted', t('Tell us about your business. We create a ready-made program you can edit later.'))),
          h('div.card.stack', field('Business name', name), field('UPI ID', upi, 'Customers can pay you directly.'), field('Address', addr)),
          h('div.stack', h('h3', t('What kind of business is it?')), h('div.g2', { role: 'radiogroup' }, types.map(x => h('button.blueprint', { role: 'radio', 'aria-checked': String(x.key === pick), onclick: () => { pick = x.key; draw(); } },
            h('span.em', x.emoji), h('b', FX.lang === 'hi' ? x.hi : x.label), h('small.muted', x.tasks.map(k => k.reward).join(', ')))))),
          err, h('button.btn.lg', { onclick: () => { if (!name.value.trim()) { err.textContent = t('Enter your business name.'); return; } step = 2; draw(); } }, t('Next'))) :
          h('div.stack.l', h('div', h('h1', t('Here is what you get')), h('p.muted', t('Everything is editable after launch.'))),
            h('div.card.stack', h('h3', bp.program), bp.tasks.map(k => h('div.li', h('span', k.type === 'amount' ? '₹' : '✦'), h('div.grow', h('b', k.title), h('div.small.muted', '🎁 ' + k.reward)))),
              bp.boosts.length ? h('div.li', h('span', '⚡'), h('div.grow', h('b', bp.boosts[0]), h('div.small.muted', t('Fills your quiet hours')))) : null,
              bp.services.length ? h('div.li', h('span', '📅'), h('div.grow', h('b', t('Online booking')), h('div.small.muted', bp.services.join(', ')))) : null,
              h('div.li', h('span', '🎁'), h('div.grow', h('b', t('Welcome gift')), h('div.small.muted', bp.welcome))),
              h('div.li', h('span', '🤝'), h('div.grow', h('b', t('Friend referral reward')), h('div.small.muted', bp.referral)))),
            err, h('div.row', h('button.btn.ghost', { onclick: () => { step = 1; draw(); } }, t('Back')),
              h('button.btn.lg.grow', { onclick: e => busy(e.target, async () => {
                try {
                  const b = await api('businesses/', 'POST', { name: name.value.trim(), category: pick, pay_upi_id: upi.value.trim() || undefined, address: addr.value.trim(), language: FX.lang });
                  await api('b/' + b.shop_code + '/blueprint/', 'POST', { key: pick });
                  localStorage.fx_biz = b.shop_code; await FX.reloadShops(); await FX.loadSub().catch(() => {});
                  toast(t('Your program is live! Print your QR code next.')); FX.go('shop');
                } catch (x) { err.textContent = x.message; }
              }) }, t('Launch my rewards')))));
    };
    draw();
    return box;
  };

  /* ---------- Today: the action queue ---------- */
  const typeVal = e => (e.task_type === 'amount' ? FX.rupee(e.value) : e.task_type === 'count' ? '×' + FX.num(e.value) : t('Visit'));
  function queueRow(e, onDone) {
    const act = a => b => busy(b.target, async () => {
      await api('entries/' + e.id + '/review/', 'POST', { action: a });
      onDone();
      if (a === 'approve') toast(t('Approved: {c}', { c: e.customer || '…' }), false, { label: t('Undo'), fn: async () => { try { await api('entries/' + e.id + '/reverse/', 'POST'); toast(t('Undone')); onDone(); } catch (x) { toast(x.message, true); } } });
    });
    return h('div.li', FX.avatar(e.customer, e.customer_image_url), h('div.grow', h('b', e.customer || t('Customer')), h('div.small.muted', e.task_title + ' · ' + typeVal(e) + ' · ' + FX.ago(e.created_at)),
      e.far ? h('div', pill(t('Far from shop ({m} m)', { m: Math.round(e.distance_m || 0) }), 'warn')) : null,
      e.bill_url ? h('a.small', { href: e.bill_url, target: '_blank', rel: 'noopener' }, t('View bill')) : null),
      h('button.btn.ghost.sm', { onclick: act('reject') }, t('Decline')), h('button.btn.sm', { onclick: act('approve') }, t('Approve')));
  }
  function redeemBox() {
    const c = inp({ ph: 'Reward code', maxlength: 12, autocapitalize: 'characters', 'aria-label': t('Reward code') });
    return h('div.card.stack', h('h3', t('Redeem a reward')), h('div.row', c, h('button.btn', { onclick: e => busy(e.target, async () => { const r = await api('rewards/redeem/', 'POST', { code: c.value.trim() }); toast(t('Redeemed: {r}', { r: r.reward })); c.value = ''; }) }, t('Redeem'))));
  }
  async function queueData() {
    const [pend, recent] = await Promise.all([api('owner/pending/'), api('owner/recent/')]);
    return [pend.filter(e => e.shop_code === code()), recent.filter(e => e.shop_code === code())];
  }
  function bookingQueue(list, onDone) {
    return list.map(b => h('div.li', h('div.grow', h('b', b.customer + ' · ' + b.service_name), h('div.small.muted', FX.fmtDT(b.starts_at)), b.note ? h('div.small', '“' + b.note + '”') : null),
      b.status === 'requested' ? [h('button.btn.ghost.sm', { onclick: e => busy(e.target, async () => { await api('bookings/' + b.id + '/action/', 'POST', { action: 'decline' }); onDone(); }) }, t('Decline')), h('button.btn.sm', { onclick: e => busy(e.target, async () => { await api('bookings/' + b.id + '/action/', 'POST', { action: 'confirm' }); onDone(); }) }, t('Confirm'))] :
        [h('button.btn.ghost.sm', { onclick: e => busy(e.target, async () => { await api('bookings/' + b.id + '/action/', 'POST', { action: 'no_show' }); onDone(); }) }, t('No-show')), h('button.btn.sm', { onclick: e => busy(e.target, async () => { await api('bookings/' + b.id + '/action/', 'POST', { action: 'complete' }); toast(t('Visit recorded')); onDone(); }) }, t('Completed'))]));
  }
  FX.bookingQueue = bookingQueue;
  const refresh = () => { FX.render(true); };
  const TIPS = {
    winback: (x) => [t('{n} customers have not visited in over 30 days.', { n: x.n }), t('Send a win-back offer'), () => FX.go('campaigns/at_risk')],
    boost: (x) => [t('{d} is your quietest day. Double stamps can fill it.', { d: wd(x.weekday) }), t('Create a boost'), () => FX.go('rewards')],
    reviews: (x) => [t('Your average rating is {a}. Read recent feedback.', { a: x.avg }), t('See feedback'), () => FX.go('insights')],
    referral: () => [t('Turn happy customers into your best marketing: add a referral reward.'), t('Set up referrals'), () => FX.go('rewards')],
    redeem: (x) => [t('Only {n}% of rewards get used. Shorter expiry or reminders can help.', { n: x.rate }), t('Review rewards'), () => FX.go('rewards')]
  };
  function subBanner() {
    const s = S.sub; if (!s) return null;
    if (s.state === 'trial') return h('div.banner', h('span.grow', t('Free trial: {n} days left.', { n: s.days_until_end })), h('a.btn.sm.gold', { href: '#/billing' }, t('Choose a plan')));
    if (s.state === 'grace' || s.state === 'expired') return h('div.banner.red', h('span.grow', t('Your plan has ended. Customers cannot earn until you renew.')), h('a.btn.sm', { href: '#/billing' }, t('Renew now')));
    return null;
  }
  R[''] = async function () {
    const [[pend, recent], ins, bk] = await Promise.all([queueData(), api('b/' + code() + '/insights/?days=30'), S.biz.bookings_enabled ? api('b/' + code() + '/bookings/?status=open') : []]);
    S.pending = pend.length;
    const k = ins.kpis, reqs = bk.filter(b => b.status === 'requested'), todays = bk.filter(b => b.status === 'confirmed' && new Date(b.starts_at).toDateString() === new Date().toDateString());
    return h('div.stack.l', subBanner(),
      h('div.hd', h('div', h('h1', S.biz.name), h('p.muted', t('What needs you right now'))), h('div.row', h('a.btn.ghost', { href: '#/counter' }, t('Counter code')))),
      h('div.card', h('div.hd', h('h3', t('Waiting for approval')), pend.length ? pill(pend.length, 'warn') : null),
        pend.length ? pend.map(e => queueRow(e, refresh)) : empty('All caught up', 'New purchases from customers show up here.')),
      reqs.length || todays.length ? h('div.card', h('h3', t('Bookings')), bookingQueue(reqs.concat(todays), refresh)) : null,
      redeemBox(),
      k.rating_count || k.customers ? h('div.g4', kpi('Customers', k.customers), kpi('Active this month', k.active_30d), kpi('Come back rate', k.repeat_rate + '%', t('customers with 2+ visits')), kpi('Visits in 30 days', k.visits_in_period, t('{n}% from returning customers', { n: k.returning_share }))) : null,
      k.customers ? h('div.card', h('h3', t('Visits, last 30 days')), FX.barChart(ins.series, 'visits')) : h('div.card.stack', h('h3', t('Get your first customers')), h('p.muted', t('Print your QR code and place it at the counter.')), h('a.btn', { href: '#/shop' }, t('Get my QR code'))),
      ins.tips.length ? h('div.stack', ins.tips.map(x => { const [msg, label, fn] = TIPS[x.key](x); return h('div.card.row', h('span', { style: 'font-size:22px' }, '💡'), h('p.grow', msg), h('button.btn.soft.sm', { onclick: fn }, label)); })) : null,
      recent.length ? h('div.card', h('h3', t('Recently approved')), recent.slice(0, 5).map(e => h('div.li', FX.avatar(e.customer, e.customer_image_url), h('div.grow', h('b', e.customer || t('Customer')), h('div.small.muted', e.task_title + ' · ' + FX.ago(e.reviewed_at || e.created_at))),
        h('button.btn.ghost.sm', { onclick: async b => { if (await confirmBox(t('Undo this approval?'), t('Undo'), true)) busy(b.target, async () => { await api('entries/' + e.id + '/reverse/', 'POST'); refresh(); }); } }, t('Undo'))))) : null);
  };
  /* staff: same queue, nothing else */
  FX.routes.staff[''] = async function () {
    const [pend] = await queueData(); S.pending = pend.length;
    return h('div.stack.l', h('h1', S.biz ? S.biz.name : ''), h('div.card', h('div.hd', h('h3', t('Waiting for approval')), pend.length ? pill(pend.length, 'warn') : null), pend.length ? pend.map(e => queueRow(e, refresh)) : empty('All caught up', 'New purchases from customers show up here.')), redeemBox());
  };

  /* ---------- Customers CRM ---------- */
  function customerDrawer(id, onChange) {
    const body = h('div.stack', h('div.spin'));
    const m = modal(t('Customer'), body, { drawer: true });
    api('b/' + code() + '/customers/' + id + '/').then(c => {
      const note = h('textarea', { maxlength: 300, value: c.note, placeholder: t('Private note, only you can see this') });
      body.replaceChildren(
        h('div.row', FX.avatar(c.name), h('div.grow', h('h3', c.name), h('div.small.muted', c.mobile)), FX.tierPill(c.tier.tier)),
        h('div.row.wrap', h('a.btn.ghost.sm', { href: 'tel:' + c.mobile }, t('Call')), h('a.btn.ghost.sm', { href: 'https://wa.me/91' + c.mobile.slice(-10), target: '_blank', rel: 'noopener' }, 'WhatsApp'),
          h('button.btn.danger.sm', { onclick: async () => { const block = c.status === 'active'; if (await confirmBox(block ? t('Block this customer? They stop earning here.') : t('Unblock this customer?'), block ? t('Block') : t('Unblock'), block)) { await api('b/' + code() + '/customers/' + id + '/block/', 'POST', { blocked: block }); m.close(); onChange(); } } }, t(c.status === 'active' ? 'Block' : 'Unblock'))),
        h('div.g2', kpi('Visits', c.visits), kpi('Last visit', FX.ago(c.last_visit)), kpi('Streak', c.streak ? c.streak + ' ' + t('weeks') : '0'), kpi('Friends invited', c.referred)),
        field('Note', note), h('button.btn.sm', { onclick: e => busy(e.target, async () => { await api('b/' + code() + '/customers/' + id + '/', 'PATCH', { note: note.value }); toast(t('Saved')); onChange(); }) }, t('Save note')),
        c.rewards.length ? h('div.stack.s', h('h4', t('Rewards')), c.rewards.map(g => h('div.li', h('span.grow', g.title), pill(t(g.status === 'active' ? 'Ready' : g.status === 'used' ? 'Used' : g.status), g.status === 'active' ? 'ok' : '')))) : null,
        c.ratings.length ? h('div.stack.s', h('h4', t('Feedback')), c.ratings.map(r => h('div', FX.stars(r.rating), r.comment ? h('p.small', r.comment) : null))) : null,
        h('div.stack.s', h('h4', t('Recent activity')), c.entries.length ? c.entries.map(e => h('div.li', h('div.grow', h('b', e.task_title), h('div.small.muted', FX.fmtDT(e.created_at))), e.multiplier > 1 ? pill(e.multiplier + 'x', 'warn') : null, pill(t(e.status), e.status === 'approved' ? 'ok' : ''))) : h('p.muted', t('No activity yet'))));
    }).catch(e => body.replaceChildren(h('p.err', e.message)));
  }
  R.customers = async function () {
    let seg = 'all', q = '', sort = 'recent';
    const box = h('div.stack');
    const load = async () => {
      box.replaceChildren(h('div.spin'));
      const d = await api('b/' + code() + '/customers/?segment=' + seg + '&q=' + encodeURIComponent(q) + '&sort=' + sort);
      const search = inp({ type: 'search', value: q, ph: 'Search name or mobile', 'aria-label': t('Search') });
      search.addEventListener('change', () => { q = search.value.trim(); load(); });
      box.replaceChildren(
        h('div.chips', SEG.map(([k, l]) => h('button.chip', { 'aria-pressed': String(k === seg), onclick: () => { seg = k; load(); } }, t(l), h('b', k === 'all' ? Object.values(d.segments).reduce((a, b) => a + b, 0) : d.segments[k])))),
        h('div.row.wrap', h('div.grow', search), FX.sel([['recent', 'Recently active'], ['visits', 'Most visits'], ['spend', 'Highest spend']], sort, { onchange: e => { sort = e.target.value; load(); }, style: 'width:auto' }),
          seg !== 'all' && seg !== 'never' ? h('button.btn.soft', { onclick: () => FX.go('campaigns/' + seg) }, t('Send offer')) : null),
        h('div.card', d.results.length ? d.results.map(c => h('div.li.click', { tabindex: 0, onclick: () => customerDrawer(c.id, load), onkeydown: e => { if (e.key === 'Enter') customerDrawer(c.id, load); } },
          FX.avatar(c.name, c.image), h('div.grow', h('b', c.name), h('div.small.muted', t('{n} visits', { n: c.visits }) + ' · ' + FX.ago(c.last_visit))),
          c.active_rewards ? pill('🎁 ' + c.active_rewards, 'ok') : null, FX.tierPill(c.tier), c.status === 'blocked' ? pill(t('Blocked'), 'bad') : null)) :
          empty('No customers here yet', seg === 'all' ? 'Share your QR code to get your first customers.' : 'Nobody matches this filter.')));
    };
    await load();
    return h('div.stack.l', h('div.hd', h('div', h('h1', t('Customers')), h('p.muted', t('Everyone who joined your rewards program'))),
      h('button.btn.ghost', { onclick: async () => { const r = await api('b/' + code() + '/report/'); window.open(r.csv_url, '_blank'); } }, t('Export CSV'))), box);
  };

  /* ---------- Rewards studio ---------- */
  const REWARD_TYPES = [['free_item', 'Free item'], ['percent_off', 'Percent off'], ['flat_off', 'Flat amount off'], ['gift', 'Gift'], ['custom', 'Other']];
  const TASK_TYPES = [['visit', 'Number of visits'], ['count', 'Number of items'], ['amount', 'Total spend (₹)']];
  function programBuilder(onDone) {
    const title = inp({ value: 'Loyalty Rewards', maxlength: 120 });
    const rows = h('div.stack');
    const addRow = () => { const r = { title: inp({ ph: 'e.g. Buy 5 coffees' }), type: sel(TASK_TYPES, 'count'), target: inp({ type: 'number', min: '1', value: '5' }), item: inp({ ph: 'Item name (optional)' }), rt: inp({ ph: 'Reward, e.g. Free coffee' }), rtype: sel(REWARD_TYPES, 'free_item'), rv: inp({ type: 'number', min: '0', value: '0' }) };
      r.el = h('div.card.stack', field('Task', r.title), h('div.g2', field('Counts', r.type), field('Target', r.target)), field('Item name', r.item), field('Reward', r.rt), h('div.g2', field('Reward type', r.rtype), field('Value (₹ or %)', r.rv)), h('button.btn.ghost.sm', { onclick: () => { list.splice(list.indexOf(r), 1); r.el.remove(); } }, t('Remove')));
      list.push(r); rows.appendChild(r.el); };
    const list = []; addRow();
    const err = h('div.err');
    const m = modal(t('New program'), h('div.stack', field('Program name', title), rows, h('button.btn.ghost', { onclick: addRow }, '+ ' + t('Add another task')), err,
      h('button.btn.lg', { onclick: e => busy(e.target, async () => {
        try {
          const tasks = list.map(r => ({ title: r.title.value.trim(), type: r.type.value, target: r.target.value, item_name: r.item.value.trim(), repeatable: true, rewards: [{ title: r.rt.value.trim(), type: r.rtype.value, value: r.rv.value || 0, expiry_days: 30 }] }));
          if (!tasks.length || tasks.some(x => !x.title || !x.rewards[0].title)) throw new Error(t('Give every task a name and a reward.'));
          await api('b/' + code() + '/programs/', 'POST', { title: title.value, tasks }); m.close(); await FX.reloadShops(); onDone();
        } catch (x) { err.textContent = x.message; }
      }) }, t('Create program'))));
  }
  function blueprintPicker(onDone) {
    api('blueprints/').then(types => {
      let pick = null; const body = h('div.stack'); const draw = () => body.replaceChildren(h('div.g2', types.map(x => h('button.blueprint', { 'aria-checked': String(x.key === pick), onclick: () => { pick = x.key; draw(); } }, h('span.em', x.emoji), h('b', FX.lang === 'hi' ? x.hi : x.label)))),
        h('button.btn.lg', { disabled: !pick, onclick: e => busy(e.target, async () => { await api('b/' + code() + '/blueprint/', 'POST', { key: pick }); m.close(); await FX.reloadShops(); toast(t('Template added')); onDone(); }) }, t('Add this template')));
      const m = modal(t('Start from a template'), body); draw();
    });
  }
  function programCard(p, onDone) {
    const pill1 = p.archived ? pill(t('Archived')) : p.active ? pill(t('Active'), 'ok') : pill(t('Paused'), 'warn');
    return h('div.card.stack', h('div.hd', h('h3', p.title), pill1),
      p.tasks.map(tk => h('div.li', h('div.grow', h('b', tk.title), h('div.small.muted', tk.rewards.map(r => '🎁 ' + r.title).join(', '))),
        h('button.btn.ghost.sm', { onclick: () => { const tg = inp({ type: 'number', min: '1', value: tk.target }); const m = modal(tk.title, h('div.stack', field('Target', tg, 'Customers already in progress keep their old target.'), h('button.btn', { onclick: e => busy(e.target, async () => { await api('tasks/' + tk.id + '/', 'PATCH', { target: tg.value }); m.close(); await FX.reloadShops(); onDone(); }) }, t('Save')))); } }, t('Edit')))),
      p.archived ? null : h('div.row.wrap', h('button.btn.ghost.sm', { onclick: e => busy(e.target, async () => { await api('programs/' + p.id + '/', 'PATCH', { active: !p.active }); await FX.reloadShops(); onDone(); }) }, t(p.active ? 'Pause' : 'Resume')),
        h('button.btn.danger.sm', { onclick: async () => { if (await confirmBox(t('Delete this program? If customers already have progress it is archived instead.'), t('Delete'), true)) { await api('programs/' + p.id + '/', 'DELETE'); await FX.reloadShops(); onDone(); } } }, t('Delete'))));
  }
  function boostEditor(b, onDone) {
    const title = inp({ value: b ? b.title : '', maxlength: 80, ph: 'e.g. Tuesday double stamps' }), mult = sel([[2, '2x'], [3, '3x']], b ? b.multiplier : 2);
    const days = new Set(b && b.weekdays ? b.weekdays.split(',').map(Number) : []);
    const st = inp({ type: 'time', value: b && b.start_time ? b.start_time.slice(0, 5) : '' }), en = inp({ type: 'time', value: b && b.end_time ? b.end_time.slice(0, 5) : '' });
    const dayRow = h('div.chips', [0, 1, 2, 3, 4, 5, 6].map(i => h('button.chip', { type: 'button', 'aria-pressed': String(days.has(i)), onclick: e => { days.has(i) ? days.delete(i) : days.add(i); e.currentTarget.setAttribute('aria-pressed', String(days.has(i))); } }, wd(i))));
    const err = h('div.err');
    const m = modal(t(b ? 'Edit boost' : 'New boost'), h('div.stack', field('Name', title), field('Multiplier', mult), h('div.field', h('span', t('Days')), dayRow, h('small', t('Leave empty for every day.'))), h('div.g2', field('From', st), field('Until', en)), h('small.muted', t('Boosts apply to visit and item stamps, not to spend totals.')), err,
      h('button.btn', { onclick: e => busy(e.target, async () => {
        try { const body = { title: title.value.trim(), multiplier: +mult.value, weekdays: [...days].sort().join(','), start_time: st.value || null, end_time: en.value || null };
          await api(b ? 'boosts/' + b.id + '/' : 'b/' + code() + '/boosts/', b ? 'PATCH' : 'POST', body); m.close(); onDone(); } catch (x) { err.textContent = x.message; }
      }) }, t('Save boost'))));
  }
  function perkEditor(trig, cur, onDone) {
    const title = inp({ value: cur ? cur.title : '', maxlength: 120, ph: 'e.g. Free cookie' }), type = sel(REWARD_TYPES, cur ? cur.type : 'gift'), val = inp({ type: 'number', min: '0', value: cur ? cur.value : 0 }), days = inp({ type: 'number', min: '1', max: '365', value: cur ? cur.expiry_days : 30 });
    const m = modal(t(trig === 'welcome' ? 'Welcome gift' : 'Referral reward'), h('div.stack', h('p.muted', t(trig === 'welcome' ? 'Given after a new customer\'s first approved purchase.' : 'Given to the customer who invited a friend, after the friend\'s first purchase.')),
      field('Reward', title), h('div.g2', field('Type', type), field('Value (₹ or %)', val)), field('Valid for (days)', days),
      h('div.row', cur ? h('button.btn.danger', { onclick: e => busy(e.target, async () => { await api('b/' + code() + '/perks/', 'PUT', { [trig]: null }); m.close(); onDone(); }) }, t('Turn off')) : null,
        h('button.btn.grow', { onclick: e => busy(e.target, async () => { await api('b/' + code() + '/perks/', 'PUT', { [trig]: { title: title.value, type: type.value, value: val.value, expiry_days: days.value } }); m.close(); onDone(); }) }, t('Save')))));
  }
  R.rewards = async function () {
    const [boosts, perks] = await Promise.all([api('b/' + code() + '/boosts/'), api('b/' + code() + '/perks/')]);
    const biz = S.biz, done = () => FX.render(true);
    const silver = inp({ type: 'number', min: '0', value: biz.tier_silver_visits }), gold = inp({ type: 'number', min: '0', value: biz.tier_gold_visits }), sp = inp({ value: biz.silver_perk, maxlength: 120, ph: 'e.g. Free size upgrade' }), gp = inp({ value: biz.gold_perk, maxlength: 120, ph: 'e.g. Priority service' });
    const perkCard = (trig, label, hint) => h('div.card.stack', h('b', t(label)), perks[trig] ? h('p', '🎁 ' + perks[trig].title) : h('p.muted', t(hint)), h('button.btn.soft.sm', { onclick: () => perkEditor(trig, perks[trig], done) }, t(perks[trig] ? 'Edit' : 'Set up')));
    return h('div.stack.l', h('div.hd', h('div', h('h1', t('Rewards')), h('p.muted', t('Give customers a reason to come back'))), h('div.row.wrap', h('button.btn.ghost', { onclick: () => blueprintPicker(done) }, t('Use a template')), h('button.btn', { onclick: () => programBuilder(done) }, '+ ' + t('New program')))),
      biz.programs.length ? h('div.g2', biz.programs.map(p => programCard(p, done))) : empty('No programs yet', 'Start from a template or build your own.'),
      h('div.section', h('div.hd', h('h2', t('Boosts')), h('button.btn.soft.sm', { onclick: () => boostEditor(null, done) }, '+ ' + t('Add boost'))), h('p.muted.small', t('Double stamps on slow days or hours bring customers in when you need them.')),
        h('div.card', boosts.length ? boosts.map(b => h('div.li', h('div.grow', h('b', b.title + ' (' + b.multiplier + 'x)'), h('div.small.muted', (b.weekdays ? b.weekdays.split(',').map(i => wd(+i)).join(', ') : t('Every day')) + (b.start_time ? ' · ' + b.start_time.slice(0, 5) + '-' + b.end_time.slice(0, 5) : ''))),
          h('button.btn.ghost.sm', { onclick: e => busy(e.target, async () => { await api('boosts/' + b.id + '/', 'PATCH', { active: !b.active }); done(); }) }, t(b.active ? 'Pause' : 'Resume')),
          h('button.btn.ghost.sm', { onclick: () => boostEditor(b, done) }, t('Edit')),
          h('button.btn.danger.sm', { onclick: e => busy(e.target, async () => { await api('boosts/' + b.id + '/', 'DELETE'); done(); }) }, t('Delete')))) : empty('No boosts yet'))),
      h('div.section', h('h2', { style: 'margin-bottom:12px' }, t('Welcome and referral gifts')), h('div.g2', perkCard('welcome', 'Welcome gift', 'Make new customers feel welcome on their first purchase.'), perkCard('referral', 'Referral reward', 'Reward customers who bring friends.'))),
      h('div.section', h('h2', { style: 'margin-bottom:12px' }, t('Membership tiers')), h('div.card.stack', h('p.muted.small', t('Tiers are based on total visits. Perks are things you honour at the counter.')),
        h('div.g2', field('Silver after (visits)', silver), field('Gold after (visits)', gold)), h('div.g2', field('Silver perk', sp), field('Gold perk', gp)),
        h('button.btn.sm', { style: 'justify-self:start', onclick: e => busy(e.target, async () => { await api('b/' + code() + '/settings/', 'PATCH', { tier_silver_visits: +silver.value, tier_gold_visits: +gold.value, silver_perk: sp.value, gold_perk: gp.value }); await FX.reloadShops(); toast(t('Saved')); }) }, t('Save tiers')))));
  };
})(window.FX);
