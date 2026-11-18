(function () {
  'use strict';

  // Catalog shown on the menu. Prices here are for display only: the server
  // (Supabase create_order) recalculates every price, discount and total.
  var PRODUCTS = [
    { id: 'cu1', cat: 'cupcakes', name: 'Oreo cupcake', desc: 'Topped with crushed Oreo and drizzle.', price: 60, emoji: '🧁', img: '/assets/img/cu1.jpg' },
    { id: 'cu2', cat: 'cupcakes', name: 'Vanilla cupcake', desc: 'Classic vanilla with a golden drizzle.', price: 60, emoji: '🧁', img: '/assets/img/cu2.jpg' },
    { id: 'cu3', cat: 'cupcakes', name: 'Chocolate cupcake', desc: 'Rich chocolate with chocolate drizzle.', price: 60, emoji: '🧁', img: '/assets/img/cu3.jpg' },
    { id: 'cu4', cat: 'cupcakes', name: 'Red velvet cupcake', desc: 'Classic red velvet with white drizzle.', price: 60, emoji: '🧁', img: '/assets/img/cu4.jpg' },
    { id: 'cu5', cat: 'cupcakes', name: 'Coffee cupcake', desc: 'Coffee-infused, topped with chocolate pearls.', price: 60, emoji: '🧁', img: '/assets/img/cu5.jpg' },
    { id: 'co1', cat: 'cookies', name: 'Oreo cookie', desc: 'Loaded with Oreo chunks and drizzle.', price: 70, emoji: '🍪', img: '/assets/img/co1.jpg' },
    { id: 'co2', cat: 'cookies', name: 'Chocolate chip cookie', desc: 'Classic, loaded with chocolate chips.', price: 70, emoji: '🍪', img: '/assets/img/co2.jpg' },
    { id: 'co3', cat: 'cookies', name: 'Milk and white chocolate cookie', desc: 'Double chocolate, milk and white chunks.', price: 70, emoji: '🍪', img: '/assets/img/co3.jpg' },
    { id: 'co4', cat: 'cookies', name: 'M&M cookie', desc: 'Colorful M&Ms baked right in.', price: 70, emoji: '🍪', img: '/assets/img/co4.jpg' },
    { id: 'co5', cat: 'cookies', name: 'Twix cookie', desc: 'Loaded with Twix pieces and caramel drizzle.', price: 70, emoji: '🍪', img: '/assets/img/co5.jpg' }
  ];
  var IG = 'ivanalicioustreats';
  var IG_URL = 'https://ig.me/m/' + IG;
  var CATS = [
    { cat: 'cupcakes', title: 'ᑕᑌᑭᑕᗩKᗴ', label: 'Cupcakes', sub: 'Made fresh to order, quality ingredients always.' },
    { cat: 'cookies', title: 'ᑕOOKIᗴ', label: 'Cookies', sub: 'Loaded, drizzled, and baked to make you smile.' }
  ];
  var STORAGE_KEY = 'itt.ticket.v1';

  function blankForm() { return { name: '', phone: '', fulfil: 'Pickup', addr: '', notes: '', code: '' }; }
  function newKey() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  var state = {
    cart: {}, showForm: false, sent: false, submitting: false,
    codeApplied: false, codeMsg: '', codeOk: false, checkingCode: false,
    errors: {}, formError: '', orderText: '', order: null, copied: false,
    form: blankForm(), idempotencyKey: newKey()
  };

  // ---------- helpers ----------
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(n) { return 'KES ' + Number(n).toLocaleString('en-KE'); }
  function byId(id) { return document.getElementById(id); }
  function product(id) { for (var i = 0; i < PRODUCTS.length; i++) if (PRODUCTS[i].id === id) return PRODUCTS[i]; return null; }
  function lines() {
    var r = [];
    PRODUCTS.forEach(function (p) { if (state.cart[p.id] > 0) r.push({ product: p, qty: state.cart[p.id] }); });
    return r;
  }
  function totals() {
    var count = 0, total = 0;
    lines().forEach(function (l) { count += l.qty; total += l.product.price * l.qty; });
    return { count: count, total: total };
  }
  function cupcakeSubtotal() {
    var s = 0;
    lines().forEach(function (l) { if (l.product.cat === 'cupcakes') s += l.product.price * l.qty; });
    return s;
  }
  function discountPreview() { return state.codeApplied ? Math.min(10, cupcakeSubtotal()) : 0; }
  function normPhone(v) { return String(v || '').replace(/[\s\-()]/g, ''); }
  function validPhone(v) { return /^(?:\+?254|0)[17]\d{8}$/.test(normPhone(v)); }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ cart: state.cart, form: state.form, key: state.idempotencyKey }));
    } catch (e) { /* storage unavailable: ticket simply won't persist */ }
  }
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (data && data.cart) {
        Object.keys(data.cart).forEach(function (id) {
          var q = parseInt(data.cart[id], 10);
          if (product(id) && q > 0 && q <= 100) state.cart[id] = q;
        });
      }
      if (data && data.form) {
        var f = blankForm();
        Object.keys(f).forEach(function (k) { if (typeof data.form[k] === 'string') f[k] = data.form[k].slice(0, 500); });
        if (f.fulfil !== 'Delivery') f.fulfil = 'Pickup';
        f.code = '';
        state.form = f;
      }
      if (data && typeof data.key === 'string' && /^[0-9a-f-]{36}$/i.test(data.key)) state.idempotencyKey = data.key;
    } catch (e) { /* ignore corrupt storage */ }
  }

  // Any change to the ticket after a failed/unsent attempt gets a fresh key,
  // so a genuinely different order is never mistaken for a duplicate.
  function ticketChanged() { state.idempotencyKey = newKey(); }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }
  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.top = '-9999px';
      document.body.appendChild(ta); ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta); return ok;
    } catch (e) { return false; }
  }

  // ---------- menu ----------
  function renderMenu() {
    var el = byId('menu');
    var html = '';
    CATS.forEach(function (c) {
      html += '<section class="itt-cat" aria-labelledby="cat-' + c.cat + '">' +
        '<h3 id="cat-' + c.cat + '"><span aria-hidden="true">' + esc(c.title) + '</span><span class="sr-only">' + esc(c.label) + '</span></h3>' +
        '<p>' + esc(c.sub) + '</p><div class="itt-grid">';
      PRODUCTS.filter(function (x) { return x.cat === c.cat; }).forEach(function (p) {
        var media = p.img
          ? '<img src="' + esc(p.img) + '" alt="' + esc(p.name) + '" width="300" height="300" loading="lazy" decoding="async">'
          : '<span role="img" aria-label="' + esc(p.name) + '">' + p.emoji + '</span>';
        html += '<article class="itt-card"><div class="itt-emoji">' + media + '</div>' +
          '<div class="itt-cbody"><h4 class="itt-cname" style="margin:0;">' + esc(p.name) + '</h4><div class="itt-cdesc">' + esc(p.desc) + '</div>' +
          '<div class="itt-crow"><span class="itt-price">' + fmt(p.price) + '</span>' +
          '<button type="button" class="itt-add" aria-label="Add ' + esc(p.name) + ' to order" data-id="' + p.id + '">+</button></div></div></article>';
      });
      html += '</div></section>';
    });
    el.innerHTML = html;
  }

  function announce(msg) { var live = byId('liveRegion'); if (live) { live.textContent = ''; setTimeout(function () { live.textContent = msg; }, 30); } }

  function bumpCount() {
    var btn = byId('openCart'); if (!btn) return;
    btn.classList.add('bump'); setTimeout(function () { btn.classList.remove('bump'); }, 200);
  }

  // ---------- drawer ----------
  function head() {
    return '<div class="itt-dhead"><h2 id="drawerTitle" tabindex="-1">Your order</h2><div class="sub">ORDER TICKET</div>' +
      '<button type="button" class="itt-close" id="closeX" aria-label="Close order ticket">✕</button></div>';
  }

  function field(id, label, control, key, required) {
    var err = state.errors[key];
    return '<div class="itt-field' + (err ? ' has-error' : '') + '"><label for="' + id + '">' + label +
      (required ? ' <span class="req" aria-hidden="true">*</span>' : '') + '</label>' + control +
      (err ? '<div class="itt-err" id="' + id + '-err">' + esc(err) + '</div>' : '') + '</div>';
  }
  function aria(id, key) { return state.errors[key] ? ' aria-invalid="true" aria-describedby="' + id + '-err"' : ''; }

  function renderSent() {
    var o = state.order || {};
    return head() + '<div class="itt-sent" role="status">' +
      '<div class="itt-check" aria-hidden="true">✓</div>' +
      '<div style="font-family:\'Caveat\',cursive;font-size:26px;font-weight:700;">Order received</div>' +
      (o.orderNumber ? '<div>Reference <span class="itt-ref">' + esc(o.orderNumber) + '</span></div>' : '') +
      '<p style="color:var(--muted);font-size:13px;margin-top:10px;">' +
      (state.copied ? 'Your order has been copied. ' : '') +
      'To confirm it, send it to <b>@' + esc(IG) + '</b> on Instagram.</p>' +
      '<ol class="itt-steps"><li>' + (state.copied ? 'Order copied ✓' : 'Tap <b>Copy order</b>') + '</li>' +
      '<li>Tap <b>Open Instagram</b> and paste it into the chat</li>' +
      '<li>Pay by M-Pesa on pickup/delivery</li></ol>' +
      '<pre>' + esc(state.orderText) + '</pre>' +
      '<button type="button" class="itt-btn2" id="copyAgain" style="background:var(--primary-ink);color:#fff;">📋 Copy order</button>' +
      '<a class="itt-btn2" href="' + IG_URL + '" target="_blank" rel="noopener noreferrer" style="background:var(--fg);color:var(--bg);">💬 Open Instagram</a>' +
      '<button type="button" class="itt-btn2" id="doneBtn" style="background:none;color:var(--muted);text-decoration:underline;">Done — start a new order</button></div>';
  }

  function renderDrawer() {
    var inner = byId('drawerInner');
    if (state.sent) {
      inner.innerHTML = renderSent();
      byId('closeX').onclick = closeDrawer;
      byId('copyAgain').onclick = function () {
        copyText(state.orderText).then(function (ok) {
          state.copied = ok; renderDrawer(); announce(ok ? 'Order copied' : 'Copy failed — select the text and copy it manually');
        });
      };
      byId('doneBtn').onclick = resetAll;
      return;
    }

    var t = totals();
    var discount = discountPreview();
    var final = t.total - discount;
    var f = state.form;
    var itemsHtml = '';

    if (!t.count) {
      itemsHtml = '<div class="itt-empty">Your ticket is empty — add something delicious.</div>';
    } else {
      itemsHtml += '<ul style="list-style:none;margin:0;padding:0;">';
      lines().forEach(function (l) {
        itemsHtml += '<li class="itt-line"><div style="flex:1;"><div class="itt-lname">' + esc(l.product.name) + '</div>' +
          '<div class="itt-lprice">' + fmt(l.product.price) + ' each</div></div>' +
          '<div class="itt-qty"><button type="button" data-id="' + l.product.id + '" data-d="-1" aria-label="Remove one ' + esc(l.product.name) + '">−</button>' +
          '<span style="min-width:20px;text-align:center;font-size:14px;" aria-label="Quantity">' + l.qty + '</span>' +
          '<button type="button" data-id="' + l.product.id + '" data-d="1" aria-label="Add one ' + esc(l.product.name) + '">+</button></div></li>';
      });
      itemsHtml += '</ul>';
    }

    if (state.showForm && t.count) {
      itemsHtml += '<form id="orderForm" novalidate>' +
        field('fName', 'Full name', '<input id="fName" name="name" autocomplete="name" maxlength="100" required value="' + esc(f.name) + '" placeholder="Your name"' + aria('fName', 'name') + '/>', 'name', true) +
        field('fPhone', 'Phone number', '<input id="fPhone" name="phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="16" required value="' + esc(f.phone) + '" placeholder="07XX XXX XXX"' + aria('fPhone', 'phone') + '/>', 'phone', true) +
        field('fFulfil', 'Fulfilment', '<select id="fFulfil" name="fulfil"><option value="Pickup"' + (f.fulfil === 'Pickup' ? ' selected' : '') + '>Pickup</option><option value="Delivery"' + (f.fulfil === 'Delivery' ? ' selected' : '') + '>Delivery</option></select>', 'fulfil', false) +
        (f.fulfil === 'Delivery' ? field('fAddr', 'Delivery address', '<textarea id="fAddr" name="addr" rows="2" maxlength="300" autocomplete="street-address" required placeholder="Estate, building, landmark"' + aria('fAddr', 'addr') + '>' + esc(f.addr) + '</textarea>', 'addr', true) : '') +
        field('fNotes', 'Notes (optional)', '<textarea id="fNotes" name="notes" rows="2" maxlength="500" placeholder="Any allergies, timing requests, etc."' + aria('fNotes', 'notes') + '>' + esc(f.notes) + '</textarea>', 'notes', false) +
        '</form>';
    }

    var foot = '';
    if (t.count) {
      foot += '<div class="itt-field" style="margin-top:0;"><label for="fCode">Discount code</label><div class="itt-code">' +
        '<input id="fCode" value="' + esc(f.code) + '" placeholder="Enter code" autocomplete="off" autocapitalize="characters" maxlength="40"/>' +
        '<button type="button" id="applyCode"' + (state.checkingCode ? ' disabled' : '') + '>' + (state.checkingCode ? 'Checking…' : 'Apply') + '</button></div>' +
        '<div aria-live="polite">' +
        (state.codeApplied ? '<div class="itt-msg ok">✓ Code applied — ' + fmt(discount) + ' off cupcakes.</div>' : '') +
        (state.codeMsg && !state.codeApplied ? '<div class="itt-msg bad">' + esc(state.codeMsg) + '</div>' : '') +
        '</div></div>';
    }
    if (discount > 0) {
      foot += '<div class="itt-drow"><span>Subtotal</span><span>' + fmt(t.total) + '</span></div>' +
        '<div class="itt-drow" style="color:var(--accent-ink);font-weight:700;"><span>Discount (cupcakes)</span><span>-' + fmt(discount) + '</span></div>';
    }
    foot += '<div class="itt-total"><span>Total</span><span>' + fmt(final) + '</span></div>';
    if (state.formError) foot += '<div class="itt-alert" role="alert">' + esc(state.formError) + '</div>';
    var label = !t.count ? 'Add items to order' : (state.showForm ? 'Place order and open Instagram' : 'Checkout');
    if (state.submitting) label = '<span class="itt-spin" aria-hidden="true"></span>Saving your order…';
    foot += '<button type="button" class="itt-checkout" id="checkoutBtn"' + (!t.count || state.submitting ? ' disabled' : '') +
      (state.submitting ? ' aria-busy="true"' : '') + '>' + label + '</button>';
    if (state.showForm && t.count) {
      foot += '<p style="text-align:center;font-size:12px;color:var(--muted);margin-top:10px;">We\'ll save your order, copy it and open Instagram — just paste it in the message box. Pay by M-Pesa on pickup/delivery.</p>';
    }

    inner.innerHTML = head() + '<div class="itt-ditems">' + itemsHtml + '</div><div class="itt-dfoot">' + foot + '</div>';
    wireDrawer();
  }

  function wireDrawer() {
    byId('closeX').onclick = closeDrawer;
    var inner = byId('drawerInner');
    inner.querySelectorAll('.itt-qty button').forEach(function (b) {
      b.onclick = function () {
        var id = b.dataset.id, d = parseInt(b.dataset.d, 10);
        state.cart[id] = Math.min(100, (state.cart[id] || 0) + d);
        if (state.cart[id] <= 0) delete state.cart[id];
        if (state.codeApplied && cupcakeSubtotal() <= 0) { state.codeApplied = false; state.codeMsg = 'This code only works on cupcakes — add a cupcake to use it.'; }
        ticketChanged(); save(); renderAll();
        var again = inner.querySelector('.itt-qty button[data-id="' + id + '"][data-d="' + d + '"]');
        if (again) again.focus();
      };
    });
    var bind = function (id, key, rerender) {
      var el = byId(id); if (!el) return;
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', function (e) {
        state.form[key] = e.target.value;
        if (state.errors[key]) { delete state.errors[key]; }
        ticketChanged(); save();
        if (rerender) { renderDrawer(); var n = byId(id); if (n) n.focus(); }
      });
    };
    bind('fName', 'name'); bind('fPhone', 'phone'); bind('fFulfil', 'fulfil', true); bind('fAddr', 'addr'); bind('fNotes', 'notes');
    var form = byId('orderForm');
    if (form) form.addEventListener('submit', function (e) { e.preventDefault(); submitOrder(); });

    var fCode = byId('fCode');
    if (fCode) {
      fCode.addEventListener('input', function (e) { state.form.code = e.target.value; if (state.codeApplied || state.codeMsg) { state.codeApplied = false; state.codeMsg = ''; } });
      fCode.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); applyCode(); } });
    }
    var applyBtn = byId('applyCode'); if (applyBtn) applyBtn.onclick = applyCode;
    var checkoutBtn = byId('checkoutBtn');
    if (checkoutBtn) checkoutBtn.onclick = function () {
      if (!state.showForm) { state.showForm = true; renderDrawer(); var n = byId('fName'); if (n) n.focus(); return; }
      submitOrder();
    };
  }

  function applyCode() {
    var code = state.form.code.trim();
    state.codeApplied = false;
    if (!code) { state.codeMsg = 'Enter a code first.'; renderDrawer(); return; }
    if (cupcakeSubtotal() <= 0) { state.codeMsg = 'This code only works on cupcakes — add a cupcake to use it.'; renderDrawer(); return; }
    state.checkingCode = true; state.codeMsg = ''; renderDrawer();
    fetch('/api/check-discount', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: code }) })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (data) {
        state.codeApplied = !!data.valid;
        state.codeMsg = data.valid ? '' : (data.error || "That code isn't valid.");
      })
      .catch(function () { state.codeMsg = 'Could not check the code — check your connection and try again.'; })
      .then(function () { state.checkingCode = false; ticketChanged(); renderDrawer(); var c = byId('applyCode'); if (c) c.focus(); });
  }

  function validate() {
    var f = state.form, e = {};
    if (f.name.trim().length < 2) e.name = 'Please add your name so we can confirm your order.';
    if (!f.phone.trim()) e.phone = 'Please add your phone number so we can confirm your order.';
    else if (!validPhone(f.phone)) e.phone = 'Enter a valid Kenyan mobile number, e.g. 0712 345 678.';
    if (f.fulfil === 'Delivery' && f.addr.trim().length < 5) e.addr = 'Please add a delivery address (estate, building, landmark).';
    return e;
  }

  function buildOrderText(o) {
    var msg = 'New order — ivanalicioustreats\n';
    if (o.orderNumber) msg += 'Ref: ' + o.orderNumber + '\n';
    msg += '\n';
    (o.items || []).forEach(function (it) { msg += it.quantity + 'x ' + it.name + ' — ' + fmt(it.lineTotalCents / 100) + '\n'; });
    if (o.discountCents > 0) {
      msg += '\nSubtotal: ' + fmt(o.subtotalCents / 100) + '\nDiscount (' + (state.form.code.trim().toUpperCase() || 'code') + '): -' + fmt(o.discountCents / 100) + '\nTotal: ' + fmt(o.totalCents / 100) + '\n\n';
    } else {
      msg += '\nTotal: ' + fmt(o.totalCents / 100) + '\n\n';
    }
    var f = state.form;
    msg += 'Name: ' + f.name.trim() + '\nPhone: ' + f.phone.trim() + '\nFulfilment: ' + f.fulfil;
    if (f.fulfil === 'Delivery') msg += '\nAddress: ' + f.addr.trim();
    if (f.notes.trim()) msg += '\nNotes: ' + f.notes.trim();
    msg += '\nPayment: M-Pesa on ' + (f.fulfil === 'Delivery' ? 'delivery' : 'pickup');
    return msg;
  }

  function submitOrder() {
    if (state.submitting) return;
    state.errors = validate(); state.formError = '';
    if (Object.keys(state.errors).length) {
      renderDrawer();
      var first = ['name', 'phone', 'addr'].filter(function (k) { return state.errors[k]; })[0];
      var map = { name: 'fName', phone: 'fPhone', addr: 'fAddr' };
      var el = byId(map[first]); if (el) el.focus();
      announce('Please fix the highlighted fields');
      return;
    }
    var f = state.form;
    var payload = {
      idempotencyKey: state.idempotencyKey,
      fullName: f.name.trim(), phone: normPhone(f.phone),
      deliveryMethod: f.fulfil.toLowerCase(),
      deliveryAddress: f.fulfil === 'Delivery' ? f.addr.trim() : '',
      notes: f.notes.trim(),
      discountCode: state.codeApplied ? f.code.trim() : '',
      items: lines().map(function (l) { return { sku: l.product.id, quantity: l.qty }; })
    };
    state.submitting = true; renderDrawer();

    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 15000);

    fetch('/api/create-order', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload), signal: ctrl ? ctrl.signal : undefined
    })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, data: d }; }); })
      .then(function (res) {
        clearTimeout(timer);
        state.submitting = false;
        if (!res.ok || !res.data || !res.data.orderNumber) {
          if (res.data && res.data.fieldErrors) state.errors = res.data.fieldErrors;
          state.formError = (res.data && res.data.error) || 'We could not save your order. Please try again.';
          if (res.data && /discount code/i.test(state.formError)) { state.codeApplied = false; }
          renderDrawer(); announce(state.formError);
          return;
        }
        state.order = res.data;
        state.orderText = buildOrderText(res.data);
        state.sent = true;
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) { }
        // Try to copy and open Instagram; if the browser blocks either after the
        // network wait, the confirmation screen keeps buttons for both.
        copyText(state.orderText).then(function (ok) { state.copied = ok; renderDrawer(); var h = byId('drawerTitle'); if (h) h.focus(); });
        var w = null;
        try { w = window.open(IG_URL, '_blank', 'noopener,noreferrer'); } catch (e) { }
        renderDrawer();
        var h = byId('drawerTitle'); if (h) h.focus();
        announce('Order ' + res.data.orderNumber + ' received');
      })
      .catch(function (err) {
        clearTimeout(timer);
        state.submitting = false;
        state.formError = err && err.name === 'AbortError'
          ? 'This is taking too long. Check your connection and tap the button again — you won\'t be charged twice.'
          : 'We couldn\'t reach our order service. Check your connection and try again.';
        renderDrawer(); announce(state.formError);
      });
  }

  function resetAll() {
    state.cart = {}; state.sent = false; state.showForm = false; state.codeApplied = false; state.codeMsg = '';
    state.orderText = ''; state.order = null; state.copied = false; state.errors = {}; state.formError = '';
    state.form = blankForm(); state.idempotencyKey = newKey();
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { }
    closeDrawer(); renderAll();
  }

  function renderAll() {
    byId('cartCount').textContent = totals().count;
    byId('openCart').setAttribute('aria-label', 'Open order ticket, ' + totals().count + ' items');
    if (byId('drawer').classList.contains('on')) renderDrawer();
  }

  var lastFocus = null;
  function openDrawer() {
    lastFocus = document.activeElement;
    byId('menuPage').style.display = 'none';
    byId('drawer').classList.add('on');
    renderDrawer(); window.scrollTo(0, 0);
    var h = byId('drawerTitle'); if (h) h.focus();
  }
  function closeDrawer() {
    byId('drawer').classList.remove('on');
    byId('menuPage').style.display = 'block';
    window.scrollTo(0, 0);
    var b = byId('openCart'); if (b) b.focus();
  }

  // ---------- boot ----------
  load();
  renderMenu();
  byId('menu').addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.itt-add') : null;
    if (!btn) return;
    var id = btn.dataset.id;
    state.cart[id] = Math.min(100, (state.cart[id] || 0) + 1);
    ticketChanged(); save(); renderAll(); bumpCount();
    announce(product(id).name + ' added. ' + totals().count + ' items in your order.');
  });
  byId('openCart').addEventListener('click', openDrawer);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && byId('drawer').classList.contains('on') && !state.submitting) closeDrawer();
  });
  renderAll();
})();
