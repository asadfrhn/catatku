/* ==========================================================
   CATATKU — Logika aplikasi
   ========================================================== */
(() => {
  'use strict';

  const CFG = window.CATATKU_CONFIG || {};
  const params = new URLSearchParams(location.search);
  const DEMO = params.has('demo');
  const VERSION = '1.1.0';
  const K = DEMO
    ? { session: 'ckd_session', cache: 'ckd_cache', outbox: 'ckd_outbox' }
    : { session: 'ck_session', cache: 'ck_cache_v1', outbox: 'ck_outbox_v1' };

  // ---------------- Penyimpanan lokal ----------------
  const store = {
    get(k, d = null) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* penuh / mode privat */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* abaikan */ } },
  };

  // ---------------- State ----------------
  const S = {
    session: store.get(K.session),
    txs: [],
    categories: { pemasukan: [], pengeluaran: [] },
    meta: null,
    outbox: store.get(K.outbox, []),
    loaded: false,
    lastSync: 0,
    syncing: false,
    syncError: '',
    tab: 'home',
    period: { key: 'month', from: '', to: '' },
    trendType: 'pengeluaran',
    hist: { q: '', type: 'all', cat: '', from: '', to: '', limit: 60 },
    lastType: 'pengeluaran',
  };

  // ---------------- Utilitas ----------------
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const nf = new Intl.NumberFormat('id-ID');
  const rp = n => 'Rp ' + nf.format(Math.round(n || 0));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
  function rpCompact(n) {
    const a = Math.abs(n);
    const f = (v, u) => (Math.round(v * 10) / 10).toString().replace('.', ',') + u;
    if (a >= 1e9) return f(n / 1e9, ' M');
    if (a >= 1e6) return f(n / 1e6, ' jt');
    if (a >= 1e3) return Math.round(n / 1e3) + ' rb';
    return String(Math.round(n));
  }
  const newId = () => 'c' + (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 15)
    : Math.random().toString(16).slice(2, 10) + Date.now().toString(16));

  // Tanggal (zona waktu lokal HP, format ISO yyyy-mm-dd)
  const pad = n => String(n).padStart(2, '0');
  const toISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const todayD = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const todayISO = () => toISO(todayD());
  const diffDays = (a, b) => {
    const A = fromISO(a), B = fromISO(b);
    return Math.round((Date.UTC(B.getFullYear(), B.getMonth(), B.getDate()) - Date.UTC(A.getFullYear(), A.getMonth(), A.getDate())) / 864e5);
  };
  const startOfWeek = d => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
  const fmtD = (iso, opt) => fromISO(iso).toLocaleDateString('id-ID', opt);
  const fmtLong = iso => fmtD(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const fmtShort = iso => fmtD(iso, { day: 'numeric', month: 'short' });
  const fmtShortY = iso => fmtD(iso, { day: 'numeric', month: 'short', year: 'numeric' });
  function fmtDayHead(iso) {
    const t = todayISO();
    if (iso === t) return 'Hari ini';
    if (iso === toISO(addDays(todayD(), -1))) return 'Kemarin';
    return fmtD(iso, { weekday: 'long', day: 'numeric', month: 'short', year: iso.slice(0, 4) === t.slice(0, 4) ? undefined : 'numeric' });
  }
  const fmtRange = (a, b) => (a === b ? fmtShortY(a) : `${fmtShort(a)} – ${fmtShortY(b)}`);

  // Ikon kategori (dari nama kategori)
  const CAT_ICONS = [
    [/makan|minum|kuliner|food|jajan|kopi|resto|snack/, '🍜'],
    [/transport|bensin|bbm|ojek|ojol|grab|gojek|parkir|tol|kendaraan|motor|mobil|servis/, '🛵'],
    [/belanja|shopping|grocer|sembako|pasar|supermarket|dapur|kebutuhan/, '🛒'],
    [/listrik|air|pln|pdam|tagihan|utilitas|internet|wifi|pulsa|kuota|telepon|token/, '💡'],
    [/kos|sewa|rumah|kontrakan|kpr|tempat tinggal/, '🏠'],
    [/kesehatan|obat|dokter|klinik|sakit|bpjs|asuransi|medis/, '💊'],
    [/pendidikan|sekolah|kuliah|kursus|buku|les|spp/, '📚'],
    [/hiburan|nonton|game|langganan|netflix|spotify|liburan|wisata|travel|rekreasi/, '🎬'],
    [/pakaian|baju|fashion|sepatu|tas/, '👕'],
    [/zakat|sedekah|infak|infaq|donasi|amal|sumbangan|perpuluhan|persembahan|sosial/, '🤲'],
    [/gaji|salary|upah|honor|payroll/, '💼'],
    [/bonus|thr|insentif|komisi/, '🎁'],
    [/investasi|saham|reksa|deposito|emas|dividen|bunga|crypto|kripto/, '📈'],
    [/tabungan|menabung|saving|dana darurat/, '🏦'],
    [/usaha|bisnis|jualan|penjualan|dagang|freelance|proyek|project|sampingan/, '🧾'],
    [/hadiah|kado|gift|angpao/, '🎀'],
    [/keluarga|anak|orang tua|ortu|istri|suami|bayi/, '👨‍👩‍👧'],
    [/hutang|utang|pinjaman|cicilan|kredit|paylater/, '💳'],
    [/perawatan|salon|kecantikan|skincare|cukur|pribadi/, '💇'],
    [/olahraga|gym|fitness|sport/, '🏋️'],
    [/hewan|kucing|anjing|pet/, '🐾'],
    [/qurban|kurban/, '🐐'],
    [/acara|event|kegiatan|pengajian/, '🎉'],
    [/koin|ppg/, '🪙'],
    [/tour|wisata|jalan-jalan/, '🚌'],
    [/ukhro|ukhrowi/, '🤲'],
    [/lemparan|setoran|iuran|kas masuk/, '📥'],
    [/transfer|penarikan|tarik tunai/, '🔁'],
    [/lain|other|dll|misc/, '✨'],
  ];
  function catIcon(name, type) {
    const n = String(name || '').toLowerCase();
    const hit = CAT_ICONS.find(([re]) => re.test(n));
    const cls = type === 'pemasukan' ? 'in' : 'out';
    return hit
      ? `<span class="cat-ic ${cls}" aria-hidden="true">${hit[1]}</span>`
      : `<span class="cat-ic ${cls}" aria-hidden="true"><span class="ltr">${esc((n.trim()[0] || '•').toUpperCase())}</span></span>`;
  }
  const catEmoji = name => { const h = CAT_ICONS.find(([re]) => re.test(String(name).toLowerCase())); return h ? h[1] : '🏷️'; };

  const ICON = {
    in: '<svg viewBox="0 0 24 24"><path d="M17 7 7 17M7 8v9h9"/></svg>',
    out: '<svg viewBox="0 0 24 24"><path d="M7 17 17 7M8 7h9v9"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  };
  const EMPTY_ART = `<svg viewBox="0 0 120 96" fill="none" aria-hidden="true"><defs><linearGradient id="eg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f6bed"/><stop offset="1" stop-color="#9b5cf6"/></linearGradient></defs><rect x="16" y="22" width="88" height="60" rx="14" fill="#eef1fb"/><rect x="28" y="10" width="64" height="70" rx="12" fill="#fff" stroke="url(#eg)" stroke-width="2"/><path d="M40 30h40M40 42h28M40 54h34" stroke="#dfe3ef" stroke-width="5" stroke-linecap="round"/><circle cx="92" cy="72" r="14" fill="url(#eg)"/><path d="M92 66v12M86 72h12" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/></svg>`;

  // ---------------- Data helpers ----------------
  const inRange = (list, from, to) => list.filter(t => t.date >= from && t.date <= to);
  const sortTxs = list => list.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.seq || 0) - (a.seq || 0)));

  function summarize(list) {
    const s = { inc: 0, exp: 0, net: 0, count: list.length, cats: new Map(), days: new Map(), biggest: null };
    list.forEach(t => {
      if (t.type === 'pemasukan') s.inc += t.amount;
      else {
        s.exp += t.amount;
        const c = t.category || 'Tanpa kategori';
        s.cats.set(c, (s.cats.get(c) || 0) + t.amount);
        s.days.set(t.date, (s.days.get(t.date) || 0) + t.amount);
        if (!s.biggest || t.amount > s.biggest.amount) s.biggest = t;
      }
    });
    s.net = s.inc - s.exp;
    s.catList = Array.from(s.cats, ([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
    return s;
  }

  function periodRange(p = S.period) {
    const t = todayD();
    if (p.key === 'today') { const d = toISO(t); return { from: d, to: d, label: 'Hari ini' }; }
    if (p.key === 'week') { const s = startOfWeek(t); return { from: toISO(s), to: toISO(addDays(s, 6)), label: 'Minggu ini' }; }
    if (p.key === 'custom' && p.from && p.to) return { from: p.from, to: p.to, label: fmtRange(p.from, p.to) };
    const s = new Date(t.getFullYear(), t.getMonth(), 1), e = new Date(t.getFullYear(), t.getMonth() + 1, 0);
    return { from: toISO(s), to: toISO(e), label: 'Bulan ini' };
  }

  function computeInsights(r, cur) {
    const t = todayISO();
    let end = r.to;
    if (r.from <= t && t < r.to) end = t; // periode berjalan: hitung sampai hari ini
    const elapsed = diffDays(r.from, end) + 1;
    let prev;
    const key = S.period.key;
    if (key === 'today') { const y = toISO(addDays(todayD(), -1)); prev = { from: y, to: y, label: 'kemarin' }; }
    else if (key === 'week') { const f = addDays(fromISO(r.from), -7); prev = { from: toISO(f), to: toISO(addDays(f, elapsed - 1)), label: 'minggu lalu (hari yang sama)' }; }
    else if (key === 'month') {
      const s = fromISO(r.from); const f = new Date(s.getFullYear(), s.getMonth() - 1, 1);
      const last = new Date(s.getFullYear(), s.getMonth(), 0);
      const e = addDays(f, elapsed - 1);
      prev = { from: toISO(f), to: toISO(e > last ? last : e), label: 'bulan lalu (tanggal yang sama)' };
    } else {
      const len = diffDays(r.from, r.to) + 1;
      prev = { from: toISO(addDays(fromISO(r.from), -len)), to: toISO(addDays(fromISO(r.from), -1)), label: 'periode sebelumnya' };
    }
    const p = summarize(inRange(S.txs, prev.from, prev.to));
    let busiest = null;
    cur.days.forEach((v, d) => { if (!busiest || v > busiest.amount) busiest = { date: d, amount: v }; });
    return {
      elapsed, prev, prevExp: p.exp,
      top: cur.catList[0] || null,
      avgDaily: cur.exp / Math.max(elapsed, 1),
      change: p.exp > 0 ? (cur.exp - p.exp) / p.exp : null,
      saveRate: cur.inc > 0 ? cur.net / cur.inc : null,
      biggest: cur.biggest, busiest,
    };
  }

  // Urutan chip kategori: paling sering dipakai di jenis ini → belum pernah dipakai di jenis lain → sisanya
  const INCOME_RE = /gaji|bonus|thr|freelance|investasi|dividen|bunga|honor|komisi|upah|penjualan|usaha|bisnis|hadiah|pemasukan|cashback|refund|pendapatan|lemparan|setoran|iuran/i;
  function categoriesFor(type) {
    const base = (S.categories && S.categories[type]) || [];
    const count = new Map(), other = new Set();
    S.txs.forEach(t => {
      if (!t.category) return;
      if (t.type === type) count.set(t.category, (count.get(t.category) || 0) + 1); else other.add(t.category);
    });
    const all = base.slice();
    count.forEach((_, c) => { if (!all.some(x => x.toLowerCase() === c.toLowerCase())) all.push(c); });
    const misfit = name => (INCOME_RE.test(name) ? type !== 'pemasukan' : type === 'pemasukan') && !/lain/i.test(name);
    return all.map((name, i) => ({ name, n: count.get(name) || 0, o: !count.has(name) && other.has(name) ? 1 : 0, m: misfit(name) ? 1 : 0, i }))
      .sort((a, b) => b.n - a.n || a.o - b.o || a.m - b.m || a.i - b.i).map(x => x.name);
  }
  const colInfo = type => (S.meta && S.meta.columns && S.meta.columns[type]) || { kategori: 'Kategori', catatan: 'Catatan' };

  // ---------------- Cache & outbox ----------------
  function loadCache() {
    const c = store.get(K.cache);
    if (c && Array.isArray(c.txs)) {
      S.txs = c.txs; S.categories = c.categories || S.categories; S.meta = c.meta || null;
      S.lastSync = c.savedAt || 0; S.loaded = true;
    }
    mergePending();
  }
  function saveCache() {
    store.set(K.cache, { txs: S.txs.filter(t => !t.pending), categories: S.categories, meta: S.meta, savedAt: S.lastSync });
  }
  const saveOutbox = () => store.set(K.outbox, S.outbox);
  function mergePending() {
    S.txs = S.txs.filter(t => !t.pending);
    S.outbox.forEach(o => { if (!S.txs.some(t => t.id === o.id)) S.txs.push(Object.assign({}, o, { pending: true, seq: o.seq || 1e12 })); });
  }
  const cleanTx = t => ({ id: t.id, type: t.type, date: t.date, amount: t.amount, category: t.category, note: t.note, akun: t.akun || '', metode: t.metode || '' });

  // Pilihan akun / pembayaran: yang pernah dipakai (paling sering dulu) + saran umum
  function choicesFor(key) {
    const fromServer = (S.meta && S.meta.options && S.meta.options[key]) || [];
    const local = []; sortTxs(S.txs).forEach(t => { if (t[key] && !local.includes(t[key])) local.push(t[key]); });
    const extra = key === 'metode' ? ['Tunai', 'Transfer', 'QRIS'] : [];
    const all = [];
    fromServer.concat(local, extra).forEach(v => { if (v && !all.some(x => x.toLowerCase() === v.toLowerCase())) all.push(v); });
    return all;
  }
  const lastUsed = key => { const t = sortTxs(S.txs).find(x => x[key]); return t ? t[key] : (choicesFor(key)[0] || ''); };

  // ---------------- API ----------------
  class ApiError extends Error {
    constructor(msg, code, network) { super(msg); this.code = code; this.network = !!network; }
  }
  async function api(action, payload, extra) {
    if (DEMO) return Demo.call(action, payload || {}, extra || {});
    const body = Object.assign({ action, token: S.session && S.session.token, payload }, extra || {});
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    let res;
    try {
      res = await fetch(CFG.API_URL, {
        method: 'POST', redirect: 'follow', signal: ctrl.signal,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new ApiError(e.name === 'AbortError' ? 'Koneksi lambat, waktu habis.' : 'Tidak ada koneksi internet.', 0, true);
    } finally { clearTimeout(timer); }
    let data;
    try { data = await res.json(); } catch {
      throw new ApiError('Server tidak merespons dengan benar. Cek API_URL di config.js dan pastikan akses Web App "Siapa saja".', 500);
    }
    if (!data.ok) {
      const err = new ApiError(data.error || 'Terjadi kesalahan.', data.code || 400);
      if (data.code === 401 && action !== 'login' && action !== 'loginKode') onUnauthorized();
      throw err;
    }
    return data.data;
  }

  function applyData(d) {
    S.txs = (d.transactions || []).map(t => Object.assign(t, { seq: t.row || 0 }));
    S.categories = d.categories || S.categories;
    S.meta = d.meta || null;
    S.loaded = true;
    S.lastSync = Date.now();
    mergePending();
    saveCache();
  }

  let flushing = null;
  function flushOutbox() {
    if (flushing) return flushing;
    flushing = (async () => {
      while (S.outbox.length) {
        const tx = S.outbox[0];
        try {
          const res = await api('add', cleanTx(tx));
          S.outbox = S.outbox.filter(o => o.id !== tx.id); saveOutbox();
          const local = S.txs.find(t => t.id === tx.id);
          if (local) { local.pending = false; local.row = res.row; }
        } catch (e) {
          if (e.network || e.code === 401 || e.code === 429 || e.code >= 500) throw e; // simpan untuk dicoba lagi
          S.outbox = S.outbox.filter(o => o.id !== tx.id); saveOutbox(); // ditolak permanen
          S.txs = S.txs.filter(t => t.id !== tx.id);
          toast('Transaksi ' + rp(tx.amount) + ' ditolak: ' + e.message, { type: 'error', duration: 6000 });
        }
      }
      saveCache();
    })().finally(() => { flushing = null; updateSyncPill(); });
    return flushing;
  }

  async function refresh({ silent = false } = {}) {
    if (S.syncing || !S.session) return;
    S.syncing = true; updateSyncPill();
    try {
      if (S.outbox.length) await flushOutbox().catch(e => { if (!e.network) throw e; });
      const d = await api('getAll');
      applyData(d);
      S.syncError = '';
    } catch (e) {
      S.syncError = e.message;
      if (!silent && e.code !== 401) toast(e.message, { type: 'error', duration: 4500 });
    } finally {
      S.syncing = false;
      updateSyncPill();
      renderView();
    }
  }

  function updateSyncPill() {
    const el = $('#sync-pill'); if (!el) return;
    const n = S.outbox.length;
    el.className = 'sync-pill' + (S.syncing || flushing ? ' busy' : n ? ' pending' : S.syncError ? ' error' : '');
    $('.txt', el).textContent = S.syncing || flushing ? 'Sinkron…' : n ? n + ' menunggu' : S.syncError ? 'Gagal sinkron' : 'Tersinkron';
  }

  // ---------------- Transaksi: tambah / ubah / hapus ----------------
  async function submitNew(tx) {
    tx.pending = true; tx.seq = 1e12 + Date.now();
    S.txs.push(tx);
    S.outbox.push(Object.assign(cleanTx(tx), { seq: tx.seq })); saveOutbox();
    S.lastType = tx.type;
    renderView(); updateSyncPill();
    const t = toast('Menyimpan ke spreadsheet…', { type: 'info', duration: 0 });
    try {
      await flushOutbox();
      if (S.outbox.some(o => o.id === tx.id)) throw new ApiError('Belum terkirim', 0, true);
      t.update(`${rp(tx.amount)} tersimpan ke spreadsheet`, 'success');
    } catch (e) {
      if (e.network) t.update('Offline: transaksi disimpan di HP & dikirim otomatis saat online', 'info-static', 5000);
      else t.update('Belum tersimpan: ' + e.message, 'error', 6000, { label: 'Coba lagi', fn: () => refresh() });
    } finally { renderView(); }
  }

  async function submitEdit(orig, upd) {
    if (orig.pending) { // belum terkirim: ubah di antrean saja
      const o = S.outbox.find(x => x.id === orig.id);
      if (o) Object.assign(o, cleanTx(upd)); saveOutbox();
      Object.assign(orig, cleanTx(upd));
      toast('Perubahan disimpan', { type: 'success' });
      flushOutbox().catch(() => {});
      return;
    }
    await api('update', cleanTx(upd));
    Object.assign(orig, cleanTx(upd));
    saveCache();
    toast('Perubahan tersimpan di spreadsheet', { type: 'success' });
  }

  async function removeTx(tx) {
    if (tx.pending) {
      S.outbox = S.outbox.filter(o => o.id !== tx.id); saveOutbox();
    } else {
      await api('delete', { id: tx.id });
    }
    S.txs = S.txs.filter(t => t.id !== tx.id);
    saveCache(); updateSyncPill();
    toast('Transaksi dihapus', { type: 'success' });
  }

  // ================= RENDER =================
  function renderView() {
    const v = S.tab;
    if (v === 'home') renderHome();
    else if (v === 'history') renderHistoryList();
    else if (v === 'stats') renderStats();
    else if (v === 'account') renderAccount();
  }

  function setTab(tab) {
    if (tab === S.tab) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    S.tab = tab;
    $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $$('.view').forEach(v => { v.hidden = v.dataset.view !== tab; });
    window.scrollTo(0, 0);
    const el = $('#view-' + tab);
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    if (tab === 'history') renderHistory(); else renderView();
  }

  const periodChips = () => {
    const p = S.period;
    const items = [['today', 'Hari ini'], ['week', 'Minggu ini'], ['month', 'Bulan ini']];
    return `<div class="chips" role="tablist" aria-label="Periode">
      ${items.map(([k, l]) => `<button class="chip ${p.key === k ? 'on' : ''}" data-action="period" data-k="${k}">${l}</button>`).join('')}
      <button class="chip ${p.key === 'custom' ? 'on' : ''}" data-action="period-custom">${p.key === 'custom' ? '📅 ' + esc(fmtRange(p.from, p.to)) : '📅 Custom'}</button>
    </div>`;
  };

  const emptyBlock = (title, text, cta = true) => `<div class="empty">${EMPTY_ART}<h3>${title}</h3><p>${text}</p>
    ${cta ? '<button class="btn btn-primary" data-action="add">+ Tambah transaksi</button>' : ''}</div>`;

  function txRow(t) {
    const isIn = t.type === 'pemasukan';
    const sub = t.note ? esc(t.note) : (isIn ? 'Pemasukan' : 'Pengeluaran');
    return `<button class="tx" data-action="tx-open" data-id="${esc(t.id)}">
      ${catIcon(t.category, t.type)}
      <div class="tx-main">
        <div class="tx-title">${esc(t.category || (isIn ? 'Pemasukan' : 'Pengeluaran'))}</div>
        <div class="tx-sub">${t.pending ? '<span class="badge-pending">⏱ menunggu</span>' : ''}<span>${sub}</span></div>
      </div>
      <div class="tx-amt num ${isIn ? 'in' : ''}">${isIn ? '+' : '−'}${rp(t.amount)}</div>
    </button>`;
  }

  function rankList(cur, limit) {
    const list = cur.catList;
    if (!list.length) return '';
    let rows = list;
    if (limit && list.length > limit) {
      const rest = list.slice(limit).reduce((s, c) => s + c.amount, 0);
      rows = list.slice(0, limit).concat([{ name: 'Lainnya', amount: rest, other: true }]);
    }
    const max = Math.max(...rows.map(r => r.amount));
    return `<div class="rank">${rows.map(r => `
      <div class="rank-row">
        ${r.other ? '<span class="cat-ic" aria-hidden="true">⋯</span>' : catIcon(r.name, 'pengeluaran')}
        <div style="min-width:0">
          <div class="rank-top"><span>${esc(r.name)}</span><span>${pct(r.amount, cur.exp)}%</span></div>
          <div class="rank-bar"><i style="width:${Math.max(2, (r.amount / max) * 100)}%;background:${r.other ? '#b8bfcc' : 'var(--a1)'}"></i></div>
        </div>
        <div class="rank-val num">${rp(r.amount)}</div>
      </div>`).join('')}</div>`;
  }

  function skeletonHome() {
    return `<div class="chips">${'<span class="sk" style="width:90px;height:38px;border-radius:99px"></span>'.repeat(3)}</div>
      <div class="sk" style="height:178px;border-radius:24px"></div>
      <div class="grid-2"><div class="sk" style="height:84px"></div><div class="sk" style="height:84px"></div></div>
      <div class="sk" style="height:220px;border-radius:18px"></div>`;
  }

  function loadErrorBlock() {
    return `<section class="card"><div class="empty">${EMPTY_ART}<h3>Gagal memuat data</h3><p>${esc(S.syncError)}</p>
      <button class="btn btn-primary" data-action="sync">Coba lagi</button></div></section>`;
  }

  // ---------- Beranda ----------
  function renderHome() {
    const el = $('#view-home');
    if (!S.loaded) { el.innerHTML = S.syncError && !S.syncing ? loadErrorBlock() : skeletonHome(); return; }
    const r = periodRange();
    const cur = summarize(inRange(S.txs, r.from, r.to));
    const ins = computeInsights(r, cur);
    const recent = sortTxs(S.txs).slice(0, 6);
    const allTime = summarize(S.txs);

    const ch = ins.change;
    const deltaHtml = ch === null ? '<span class="tile-value">—</span>'
      : `<div class="tile-value"><span class="delta ${ch > 0.005 ? 'bad' : ch < -0.005 ? 'good' : ''}">${ch > 0.005 ? '▲' : ch < -0.005 ? '▼' : '='} ${Math.abs(Math.round(ch * 100))}%</span></div>`;

    el.innerHTML = `
      ${periodChips()}
      <section class="hero" aria-label="Ringkasan">
        <div class="hero-label">Saldo bersih · ${esc(r.label)}</div>
        <div class="hero-value num">${cur.net < 0 ? '−' : ''}${rp(Math.abs(cur.net))}</div>
        <div class="hero-total">Saldo kas keseluruhan <b class="num">${allTime.net < 0 ? '−' : ''}${rp(Math.abs(allTime.net))}</b></div>
        <div class="hero-split">
          <div class="hero-pill"><small><span class="ic">${ICON.in}</span>Pemasukan</small><b class="num">${rp(cur.inc)}</b></div>
          <div class="hero-pill"><small><span class="ic">${ICON.out}</span>Pengeluaran</small><b class="num">${rp(cur.exp)}</b></div>
        </div>
      </section>
      ${cur.count ? `
      <section class="grid-2" aria-label="Insight">
        <div class="tile"><div class="tile-label">🏆 Kategori terbesar</div>
          <div class="tile-value">${ins.top ? esc(ins.top.name) : '—'}</div>
          <div class="tile-sub">${ins.top ? rp(ins.top.amount) + ' · ' + pct(ins.top.amount, cur.exp) + '%' : 'belum ada pengeluaran'}</div></div>
        <div class="tile"><div class="tile-label">📅 Rata-rata / hari</div>
          <div class="tile-value num">${rp(ins.avgDaily)}</div>
          <div class="tile-sub">selama ${ins.elapsed} hari</div></div>
        <div class="tile"><div class="tile-label">↕️ Pengeluaran vs lalu</div>
          ${deltaHtml}
          <div class="tile-sub">${ch === null ? 'belum ada pembanding' : 'vs ' + esc(ins.prev.label.split(' (')[0]) + ' ' + rpCompact(ins.prevExp)}</div></div>
        <div class="tile"><div class="tile-label">💰 Sisa pemasukan</div>
          <div class="tile-value num">${ins.saveRate === null ? '—' : ins.saveRate < 0 ? '−' + rp(-cur.net) : Math.round(ins.saveRate * 100) + '%'}</div>
          <div class="tile-sub">${ins.saveRate === null ? 'belum ada pemasukan' : ins.saveRate < 0 ? 'pengeluaran melebihi pemasukan' : 'dari pemasukan tersisa'}</div></div>
      </section>` : ''}
      <section class="card">
        <div class="card-head"><h2>Pengeluaran per kategori</h2><button class="link" data-action="go" data-tab="stats">Detail</button></div>
        ${cur.exp ? rankList(cur, 4) : `<p style="margin:0;color:var(--text-3);font-size:14px">Belum ada pengeluaran di periode ini.</p>`}
      </section>
      <section class="card">
        <div class="card-head"><h2>Transaksi terbaru</h2>${recent.length ? '<button class="link" data-action="go" data-tab="history">Lihat semua</button>' : ''}</div>
        ${recent.length ? `<div class="tx-list">${recent.map(txRow).join('')}</div>`
          : emptyBlock('Belum ada transaksi', 'Catat transaksi pertamamu, hanya butuh beberapa detik.')}
      </section>`;
    revealActiveChip(el);
  }

  function revealActiveChip(el) {
    const c = $('.chips .chip.on', el); if (!c) return;
    const box = c.parentElement;
    if (c.offsetLeft + c.offsetWidth > box.scrollLeft + box.clientWidth) box.scrollLeft = c.offsetLeft + c.offsetWidth - box.clientWidth + 4;
  }

  // ---------- Riwayat ----------
  function renderHistory() {
    const el = $('#view-history');
    const h = S.hist;
    const cats = Array.from(new Set(categoriesFor('pengeluaran').concat(categoriesFor('pemasukan')))).sort((a, b) => a.localeCompare(b, 'id'));
    el.innerHTML = `
      <label class="search">${ICON.search}<input id="h-q" type="search" placeholder="Cari catatan, kategori, nominal…" value="${esc(h.q)}" autocomplete="off" enterkeyhint="search"></label>
      <div class="seg small" id="h-type">
        ${[['all', 'Semua'], ['pemasukan', 'Pemasukan'], ['pengeluaran', 'Pengeluaran']].map(([v, l]) => `<button data-v="${v}" class="${h.type === v ? 'on' : ''}">${l}</button>`).join('')}
      </div>
      <div class="filter-row">
        <select class="select ${h.cat ? 'on' : ''}" id="h-cat" aria-label="Filter kategori">
          <option value="">Semua kategori</option>
          ${cats.map(c => `<option ${c === h.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}
        </select>
        <button class="chip ${h.from ? 'on' : ''}" data-action="hist-date">📅 ${h.from ? esc(fmtRange(h.from, h.to)) : 'Semua tanggal'}</button>
        ${h.q || h.type !== 'all' || h.cat || h.from ? '<button class="link" data-action="hist-reset">Reset</button>' : ''}
      </div>
      <div id="h-list"></div>`;
    const q = $('#h-q', el);
    let deb;
    q.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(() => { S.hist.q = q.value; S.hist.limit = 60; renderHistoryList(); }, 120); });
    $('#h-type', el).addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      S.hist.type = b.dataset.v; S.hist.limit = 60; renderHistory();
    });
    $('#h-cat', el).addEventListener('change', e => { S.hist.cat = e.target.value; S.hist.limit = 60; renderHistory(); });
    renderHistoryList();
  }

  function filteredHistory() {
    const h = S.hist;
    const q = h.q.trim().toLowerCase();
    const qDigits = q.replace(/[^\d]/g, '');
    return sortTxs(S.txs).filter(t => {
      if (h.type !== 'all' && t.type !== h.type) return false;
      if (h.cat && t.category !== h.cat) return false;
      if (h.from && (t.date < h.from || t.date > h.to)) return false;
      if (q) {
        const hay = (t.category + ' ' + t.note + ' ' + (t.akun || '') + ' ' + (t.metode || '') + ' ' + fmtLong(t.date)).toLowerCase();
        const words = q.split(/\s+/).filter(Boolean);
        const textOk = words.every(w => hay.includes(w));
        const numOk = qDigits.length >= 3 && String(Math.round(t.amount)).includes(qDigits);
        if (!textOk && !numOk) return false;
      }
      return true;
    });
  }

  function renderHistoryList() {
    const box = $('#h-list'); if (!box) return;
    if (!S.loaded) { box.innerHTML = S.syncError ? loadErrorBlock() : '<div class="sk" style="height:300px;border-radius:18px"></div>'; return; }
    const list = filteredHistory();
    if (!list.length) {
      const filtered = S.hist.q || S.hist.type !== 'all' || S.hist.cat || S.hist.from;
      box.innerHTML = `<section class="card">${filtered
        ? emptyBlock('Tidak ada yang cocok', 'Coba kata kunci lain atau reset filter.', false)
        : emptyBlock('Belum ada transaksi', 'Transaksi yang kamu catat akan muncul di sini.')}</section>`;
      return;
    }
    const sum = summarize(list);
    const shown = list.slice(0, S.hist.limit);
    let html = `<div class="summary-line"><span><b>${list.length}</b> transaksi</span>
      ${sum.inc ? `<span style="color:var(--inc-text)">+${rp(sum.inc)}</span>` : ''}
      ${sum.exp ? `<span>−${rp(sum.exp)}</span>` : ''}</div><section class="card" style="padding:4px 14px 10px">`;
    let lastDate = '';
    let group = [];
    const flush = () => {
      if (!group.length) return;
      const s = summarize(group);
      html += `<div class="day-head"><span>${esc(fmtDayHead(lastDate))}</span><span class="num">${s.net >= 0 ? '+' : '−'}${rp(Math.abs(s.net))}</span></div>
        <div class="tx-list">${group.map(txRow).join('')}</div>`;
      group = [];
    };
    shown.forEach(t => { if (t.date !== lastDate) { flush(); lastDate = t.date; } group.push(t); });
    flush();
    html += '</section>';
    if (list.length > shown.length) html += `<button class="more-btn" data-action="more">Tampilkan lebih banyak (${list.length - shown.length} lagi)</button>`;
    box.innerHTML = html;
  }

  // ---------- Statistik ----------
  const charts = new Map();

  function renderStats() {
    const el = $('#view-stats');
    if (!S.loaded) { el.innerHTML = S.syncError ? loadErrorBlock() : skeletonHome(); return; }
    const r = periodRange();
    const cur = summarize(inRange(S.txs, r.from, r.to));
    const ins = computeInsights(r, cur);
    const tr = trendSpec(r, S.trendType, cur, ins);
    const ie = incExpSpec(r);
    charts.set('trend', tr); charts.set('incexp', ie);

    const insights = [];
    if (ins.top) insights.push(['🏆', `Pengeluaran terbesar ada di <b>${esc(ins.top.name)}</b>: ${rp(ins.top.amount)} (${pct(ins.top.amount, cur.exp)}% dari total).`]);
    if (cur.exp) insights.push(['📅', `Rata-rata pengeluaranmu <b>${rp(ins.avgDaily)} per hari</b> selama ${ins.elapsed} hari.`]);
    if (ins.change !== null) {
      const c = Math.round(ins.change * 100);
      insights.push([c > 0 ? '📈' : c < 0 ? '📉' : '⚖️', c === 0
        ? `Pengeluaran <b>sama</b> dengan ${esc(ins.prev.label)}.`
        : `Pengeluaran <b>${c > 0 ? 'naik' : 'turun'} ${Math.abs(c)}%</b> dibanding ${esc(ins.prev.label)} (${rp(ins.prevExp)}).`]);
    } else if (cur.exp) insights.push(['🕰️', `Belum ada data pembanding untuk ${esc(ins.prev.label)}.`]);
    if (ins.saveRate !== null) {
      insights.push(['💰', ins.saveRate >= 0
        ? `Kamu menyisihkan <b>${Math.round(ins.saveRate * 100)}%</b> dari pemasukan (${rp(cur.net)}).`
        : `Pengeluaran melebihi pemasukan sebesar <b>${rp(-cur.net)}</b>.`]);
    }
    if (ins.biggest) insights.push(['🧾', `Transaksi terbesar: <b>${rp(ins.biggest.amount)}</b> untuk ${esc(ins.biggest.category || 'pengeluaran')}${ins.biggest.note ? ' (' + esc(ins.biggest.note) + ')' : ''}, ${esc(fmtShort(ins.biggest.date))}.`]);
    if (ins.busiest && cur.days.size > 1) insights.push(['🔥', `Hari paling boros: <b>${esc(fmtD(ins.busiest.date, { weekday: 'long', day: 'numeric', month: 'short' }))}</b> (${rp(ins.busiest.amount)}).`]);

    el.innerHTML = `
      ${periodChips()}
      <section class="card">
        <div class="card-head"><div><h2>Pengeluaran per kategori</h2><div class="sub">${esc(r.label)} · total ${rp(cur.exp)}</div></div></div>
        ${cur.exp ? rankList(cur) : emptyBlock('Belum ada pengeluaran', 'Belum ada pengeluaran di periode ini.', false)}
      </section>
      <section class="card">
        <div class="card-head"><div><h2>Tren ${S.trendType === 'pengeluaran' ? 'pengeluaran' : 'pemasukan'}</h2><div class="sub">${esc(tr.caption)}</div></div>
          <div class="seg small" style="width:132px;flex:none"><button data-action="trend-type" data-v="pengeluaran" class="${S.trendType === 'pengeluaran' ? 'on' : ''}">Keluar</button><button data-action="trend-type" data-v="pemasukan" class="${S.trendType === 'pemasukan' ? 'on' : ''}">Masuk</button></div></div>
        <div class="chart" data-chart="trend" style="height:${tr.height}px"></div>
      </section>
      <section class="card">
        <div class="card-head"><div><h2>Pemasukan vs pengeluaran</h2><div class="sub">${esc(ie.caption)}</div></div></div>
        <div class="chart" data-chart="incexp" style="height:${ie.height}px"></div>
        <div class="legend"><span><i style="background:var(--inc)"></i>Pemasukan</span><span><i style="background:var(--exp)"></i>Pengeluaran</span></div>
      </section>
      <section class="card">
        <div class="card-head"><h2>Insight</h2></div>
        ${insights.length ? `<div class="insight-list">${insights.map(([i, t]) => `<div class="insight"><span class="ic">${i}</span><p>${t}</p></div>`).join('')}</div>`
          : `<p style="margin:0;color:var(--text-3);font-size:14px">Insight akan muncul setelah ada transaksi di periode ini.</p>`}
      </section>`;
    drawCharts(el);
    revealActiveChip(el);
  }

  function trendSpec(r, type, cur, ins) {
    let from = r.from; const to = r.to;
    if (S.period.key === 'today') from = toISO(addDays(fromISO(to), -6));
    const days = diffDays(from, to) + 1;
    const list = inRange(S.txs, from, to).filter(t => t.type === type);
    const buckets = [];
    if (days <= 31) {
      for (let i = 0; i < days; i++) {
        const d = toISO(addDays(fromISO(from), i));
        buckets.push({ key: d, label: days <= 7 ? fmtD(d, { weekday: 'short' }) : String(fromISO(d).getDate()), tip: fmtD(d, { weekday: 'long', day: 'numeric', month: 'long' }), v: [0], from: d, to: d });
      }
    } else if (days <= 120) {
      for (let i = 0; i < days; i += 7) {
        const a = toISO(addDays(fromISO(from), i)); const b0 = toISO(addDays(fromISO(from), i + 6)); const b = b0 > to ? to : b0;
        buckets.push({ label: fmtShort(a), tip: fmtRange(a, b), v: [0], from: a, to: b });
      }
    } else {
      let d = new Date(fromISO(from).getFullYear(), fromISO(from).getMonth(), 1);
      while (toISO(d) <= to) {
        const a = toISO(d), e = toISO(new Date(d.getFullYear(), d.getMonth() + 1, 0));
        buckets.push({ label: d.toLocaleDateString('id-ID', { month: 'short' }), tip: d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }), v: [0], from: a, to: e });
        d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      }
    }
    list.forEach(t => { const b = buckets.find(x => t.date >= x.from && t.date <= x.to); if (b) b.v[0] += t.amount; });
    const daily = days <= 31;
    const total = list.reduce((s, t) => s + t.amount, 0);
    const avg = daily && S.period.key !== 'today' ? (type === 'pengeluaran' ? ins.avgDaily : total / Math.max(ins.elapsed, 1)) : null;
    return {
      buckets, height: 190, avg,
      series: [{ name: type === 'pengeluaran' ? 'Pengeluaran' : 'Pemasukan', color: type === 'pengeluaran' ? '#e8673c' : '#0e9f8c' }],
      caption: (S.period.key === 'today' ? '7 hari terakhir' : r.label) + (daily ? ' · per hari' : days <= 120 ? ' · per minggu' : ' · per bulan'),
    };
  }

  function incExpSpec(r) {
    const end = fromISO(r.to);
    const buckets = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(end.getFullYear(), end.getMonth() - i, 1);
      const a = toISO(d), b = toISO(new Date(d.getFullYear(), d.getMonth() + 1, 0));
      const s = summarize(inRange(S.txs, a, b));
      buckets.push({ label: d.toLocaleDateString('id-ID', { month: 'short' }), tip: d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }), v: [s.inc, s.exp] });
    }
    return {
      buckets, height: 200, avg: null,
      series: [{ name: 'Pemasukan', color: '#0e9f8c' }, { name: 'Pengeluaran', color: '#e8673c' }],
      caption: '6 bulan sampai ' + end.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }),
      net: true,
    };
  }

  function niceMax(v) {
    if (v <= 0) return 1000;
    const e = Math.pow(10, Math.floor(Math.log10(v)));
    const f = v / e;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
  }

  function barPath(x, y, w, h) {
    if (h <= 0) return '';
    const r = Math.min(4, h, w / 2);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }

  function drawCharts(root) {
    $$('[data-chart]', root).forEach(host => {
      const spec = charts.get(host.dataset.chart);
      if (spec) drawColumns(host, spec);
    });
  }

  function drawColumns(host, spec) {
    const W = Math.max(host.clientWidth, 240), H = spec.height;
    const padL = 44, padR = 6, padT = 14, padB = 24;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const n = spec.buckets.length, sc = spec.series.length;
    const maxV = niceMax(Math.max(0, ...spec.buckets.flatMap(b => b.v), spec.avg || 0));
    const band = plotW / n, gap = 2;
    const barW = Math.max(2, Math.min(24, (band * 0.7 - gap * (sc - 1)) / sc));
    const groupW = barW * sc + gap * (sc - 1);
    const y = v => padT + plotH - (v / maxV) * plotH;
    let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(spec.caption)}">`;
    [0, 0.5, 1].forEach(f => {
      const yy = Math.round(y(maxV * f)) + 0.5;
      svg += `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}"/><text x="${padL - 8}" y="${yy + 4}" text-anchor="end">${f === 0 ? '0' : rpCompact(maxV * f)}</text>`;
    });
    const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 34))));
    spec.buckets.forEach((b, i) => {
      const gx = padL + i * band + (band - groupW) / 2;
      b.v.forEach((v, j) => {
        const h = (v / maxV) * plotH;
        if (v > 0) svg += `<path class="mark" data-i="${i}" d="${barPath(gx + j * (barW + gap), padT + plotH - Math.max(h, 1.5), barW, Math.max(h, 1.5))}" fill="${spec.series[j].color}"/>`;
      });
      if (i % every === 0) {
        svg += `<text x="${padL + i * band + band / 2}" y="${H - 6}" text-anchor="middle">${esc(b.label)}</text>`;
      }
      svg += `<rect class="hit" data-i="${i}" x="${padL + i * band}" y="${padT}" width="${band}" height="${plotH}"/>`;
    });
    if (spec.avg) {
      const ay = Math.round(y(spec.avg)) + 0.5;
      svg += `<line x1="${padL}" x2="${W - padR}" y1="${ay}" y2="${ay}" stroke="#475569" stroke-width="1" opacity=".55"/>
        <text x="${W - padR}" y="${ay - 5}" text-anchor="end" style="fill:#475569;font-weight:600;stroke:#fff;stroke-width:3px;paint-order:stroke">rata-rata ${rpCompact(spec.avg)}</text>`;
    }
    svg += '</svg><div class="tip"></div>';
    host.innerHTML = svg;

    const tip = $('.tip', host);
    const show = i => {
      const b = spec.buckets[i]; if (!b) return;
      host.classList.add('hovering');
      $$('.mark', host).forEach(m => m.classList.toggle('hl', m.dataset.i === String(i)));
      let html = `<div style="opacity:.75;margin-bottom:2px">${esc(b.tip)}</div>`;
      b.v.forEach((v, j) => { html += `<div><span class="k" style="background:${spec.series[j].color}"></span>${esc(spec.series[j].name)}: <b>${rp(v)}</b></div>`; });
      if (spec.net) html += `<div style="opacity:.75;margin-top:2px">Selisih: ${b.v[0] - b.v[1] < 0 ? '−' : ''}${rp(Math.abs(b.v[0] - b.v[1]))}</div>`;
      tip.innerHTML = html;
      const cx = padL + i * band + band / 2;
      const top = y(Math.max(...b.v));
      tip.style.left = Math.min(Math.max(cx, 80), W - 80) + 'px';
      tip.style.top = Math.max(top, 40) + 'px';
      tip.classList.add('show');
    };
    const hide = () => { host.classList.remove('hovering'); tip.classList.remove('show'); };
    host.onpointermove = host.onpointerdown = e => { const r = e.target.closest('.hit'); if (r) show(+r.dataset.i); };
    host.onpointerleave = e => { if (e.pointerType === 'mouse') hide(); };
    host._hide = hide;
  }
  document.addEventListener('pointerdown', e => {
    if (!e.target.closest('.chart')) $$('.chart').forEach(c => c._hide && c._hide());
  });
  let rsz;
  window.addEventListener('resize', () => { clearTimeout(rsz); rsz = setTimeout(() => { if (S.tab === 'stats') drawCharts($('#view-stats')); }, 150); });

  // ---------- Akun ----------
  function renderAccount() {
    const el = $('#view-account');
    const u = (S.session && S.session.user) || {};
    const initial = (u.name || u.email || '?').trim()[0].toUpperCase();
    const cols = S.meta && S.meta.columns;
    const colLine = (label, c) => c ? `<div><b>${label}:</b> ${['tanggal', 'akun', 'kategori', 'nominal', 'tipe', 'metode', 'catatan'].map(f => c[f] ? `<code>${esc(c[f])}</code>` : '').filter(Boolean).join(' ')} ${c.id ? '· ID <code>' + esc(c.id) + '</code>' : ''}</div>` : '';
    el.innerHTML = `
      <section class="card profile">
        <div class="avatar">${u.picture ? `<img src="${esc(u.picture)}" alt="" referrerpolicy="no-referrer">` : esc(initial)}</div>
        <div style="min-width:0"><div style="font-weight:700;font-size:16px">${esc(u.name || 'Pemilik')}</div>
          <div style="color:var(--text-3);font-size:13.5px;overflow:hidden;text-overflow:ellipsis">${esc(u.email || '')}${DEMO ? ' · mode demo' : ''}</div></div>
      </section>
      <section class="card menu">
        <button class="menu-item" data-action="sync"><span class="mi">🔄</span><span class="grow">Sinkronkan sekarang
          <small>${S.lastSync ? 'Terakhir: ' + new Date(S.lastSync).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Belum pernah'}${S.outbox.length ? ' · ' + S.outbox.length + ' menunggu dikirim' : ''}</small></span></button>
        ${S.meta && S.meta.sheetUrl ? `<a class="menu-item" href="${esc(S.meta.sheetUrl)}" target="_blank" rel="noopener"><span class="mi">📊</span><span class="grow">Buka spreadsheet<small>Laporan Keuangan di Google Sheets</small></span></a>` : ''}
        <div class="menu-item" style="align-items:flex-start"><span class="mi">🧩</span><span class="grow">Kolom yang terhubung
          <div class="colmap">${cols ? colLine('Pemasukan', cols.pemasukan) + colLine('Pengeluaran', cols.pengeluaran) : '<small>Muncul setelah data dimuat</small>'}
          ${S.meta && S.meta.skipped ? `<div style="color:#b45309">⚠️ ${S.meta.skipped} baris dilewati karena tanggalnya tidak terbaca.</div>` : ''}</div></span></div>
      </section>
      <section class="card menu">
        <button class="menu-item" data-action="logout"><span class="mi">🚪</span><span class="grow">Keluar dari HP ini</span></button>
        ${DEMO ? '' : '<button class="menu-item danger" data-action="logout-all"><span class="mi">🔒</span><span class="grow">Keluar dari semua perangkat<small>Gunakan jika HP hilang</small></span></button>'}
      </section>
      <p style="text-align:center;color:var(--text-3);font-size:12.5px">Catatku v${VERSION}</p>`;
  }

  // ================= LAYER (sheet & dialog) =================
  const layers = [];
  let histEntry = false, skipPop = 0;
  function pushLayer(entry) {
    layers.push(entry);
    if (!histEntry) { history.pushState({ ckLayer: 1 }, ''); histEntry = true; }
  }
  function closeLayer(entry, viaPop = false) {
    const i = layers.indexOf(entry); if (i < 0) return;
    layers.splice(i, 1);
    entry.parts.forEach(p => p.classList.add('out'));
    setTimeout(() => entry.parts.forEach(p => p.remove()), 260);
    if (entry.onClose) entry.onClose();
    if (!viaPop) setTimeout(() => { if (!layers.length && histEntry) { histEntry = false; skipPop++; history.back(); } }, 0);
  }
  window.addEventListener('popstate', () => {
    if (skipPop > 0) { skipPop--; return; }
    histEntry = false;
    const top = layers[layers.length - 1];
    if (top) {
      closeLayer(top, true);
      if (layers.length) { history.pushState({ ckLayer: 1 }, ''); histEntry = true; }
    }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && layers.length) closeLayer(layers[layers.length - 1]); });

  function openSheet(title, bodyHtml, footHtml, opts = {}) {
    const bd = document.createElement('div'); bd.className = 'backdrop';
    const sh = document.createElement('div'); sh.className = 'sheet';
    sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true'); sh.setAttribute('aria-label', title);
    sh.innerHTML = `<div class="sheet-grab"></div>
      <div class="sheet-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="Tutup">${ICON.close}</button></div>
      <div class="sheet-body">${bodyHtml}</div>${footHtml ? `<div class="sheet-foot">${footHtml}</div>` : ''}`;
    $('#layers').append(bd, sh);
    const entry = { parts: [bd, sh], el: sh, onClose: opts.onClose };
    bd.addEventListener('click', () => closeLayer(entry));
    $('[data-close]', sh).addEventListener('click', () => closeLayer(entry));
    // geser ke bawah untuk menutup
    let y0 = null, dy = 0;
    const head = [$('.sheet-grab', sh), $('.sheet-head', sh)];
    head.forEach(h => {
      h.addEventListener('touchstart', e => { y0 = e.touches[0].clientY; dy = 0; sh.style.transition = 'none'; }, { passive: true });
      h.addEventListener('touchmove', e => { if (y0 === null) return; dy = Math.max(0, e.touches[0].clientY - y0); sh.style.transform = `translateY(${dy}px)`; }, { passive: true });
      h.addEventListener('touchend', () => { sh.style.transition = 'transform .2s'; if (dy > 90) closeLayer(entry); else sh.style.transform = ''; y0 = null; });
    });
    pushLayer(entry);
    return entry;
  }

  function confirmDialog({ title, text, ok = 'Ya', danger = false }) {
    return new Promise(resolve => {
      const bd = document.createElement('div'); bd.className = 'backdrop top';
      const dg = document.createElement('div'); dg.className = 'dialog'; dg.setAttribute('role', 'alertdialog');
      dg.innerHTML = `${danger ? '<div class="ic-warn">🗑️</div>' : ''}<h3>${esc(title)}</h3><p>${text}</p>
        <div class="btns"><button class="btn btn-ghost" data-r="0">Batal</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-r="1">${esc(ok)}</button></div>`;
      $('#layers').append(bd, dg);
      let result = false;
      const entry = { parts: [bd, dg], onClose: () => resolve(result) };
      bd.addEventListener('click', () => closeLayer(entry));
      dg.addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (!b) return; result = b.dataset.r === '1'; closeLayer(entry); });
      pushLayer(entry);
      $('[data-r="1"]', dg).focus();
    });
  }

  // ================= FORM TRANSAKSI =================
  function openTxForm(existing) {
    const isEdit = !!existing;
    const f = {
      type: existing ? existing.type : 'pengeluaran',
      amount: existing ? existing.amount : 0,
      category: existing ? existing.category : '',
      date: existing ? existing.date : todayISO(),
      note: existing ? existing.note : '',
      akun: existing ? existing.akun || '' : lastUsed('akun'),
      metode: existing ? existing.metode || '' : lastUsed('metode'),
    };
    const body = `
      <div class="seg type" id="f-type" role="tablist">
        <button data-type="pengeluaran">↗ Pengeluaran</button>
        <button data-type="pemasukan">↙ Pemasukan</button>
      </div>
      <label class="amount-field" id="f-amount-wrap"><span>Rp</span>
        <input id="f-amount" inputmode="numeric" autocomplete="off" placeholder="0" enterkeyhint="done" aria-label="Nominal"></label>
      <div class="quick" id="f-quick">${[5000, 10000, 20000, 50000, 100000, 500000].map(v => `<button type="button" data-v="${v}">+${rpCompact(v).replace(' ', '')}</button>`).join('')}</div>
      <div class="err-msg" id="e-amount"></div>
      <div id="f-cat-box"><div class="field-label">Kategori</div>
        <div class="cat-grid" id="f-cats"></div>
        <input class="text-input" id="f-cat-new" placeholder="Nama kategori baru" maxlength="100" style="margin-top:10px" hidden>
        <div class="err-msg" id="e-cat"></div></div>
      <div class="field-label">Tanggal</div>
      <div class="date-row" id="f-date-row">
        <button type="button" class="chip" data-d="0">Hari ini</button>
        <button type="button" class="chip" data-d="-1">Kemarin</button>
        <input type="date" class="date-input" id="f-date" aria-label="Pilih tanggal" max="2100-12-31">
      </div>
      <div class="err-msg" id="e-date"></div>
      <div id="f-akun-box"><div class="field-label">Akun</div><div class="date-row" id="f-akun"></div>
        <input class="text-input" id="f-akun-new" placeholder="Nama akun lain" maxlength="100" style="margin-top:10px" hidden></div>
      <div id="f-metode-box"><div class="field-label">Pembayaran</div><div class="date-row" id="f-metode"></div>
        <input class="text-input" id="f-metode-new" placeholder="Cara bayar lain" maxlength="100" style="margin-top:10px" hidden></div>
      <div id="f-note-box"><div class="field-label">Catatan <span>opsional</span></div>
        <input class="text-input" id="f-note" maxlength="500" placeholder="mis. makan siang dengan tim" enterkeyhint="done"></div>`;
    const foot = `<button class="btn btn-primary" id="f-save">${isEdit ? 'Simpan perubahan' : 'Simpan'}</button>`;
    const sheet = openSheet(isEdit ? 'Edit transaksi' : 'Tambah transaksi', body, foot);
    const root = sheet.el;
    const amountEl = $('#f-amount', root), noteEl = $('#f-note', root), dateEl = $('#f-date', root), newCatEl = $('#f-cat-new', root);
    let customCat = false;

    const setAmount = v => {
      f.amount = Math.max(0, Math.min(v, 9999999999999));
      amountEl.value = f.amount ? nf.format(f.amount) : '';
      $('#e-amount', root).textContent = ''; $('#f-amount-wrap', root).classList.remove('err');
    };
    const renderType = () => {
      $$('#f-type button', root).forEach(b => b.classList.toggle('on', b.dataset.type === f.type));
      const ci = colInfo(f.type);
      $('#f-cat-box', root).hidden = ci.kategori === null;
      $('#f-note-box', root).hidden = ci.catatan === null;
      $('#f-akun-box', root).hidden = !ci.akun;
      $('#f-metode-box', root).hidden = !ci.metode;
      renderCats();
    };
    // Pilihan chip untuk akun & pembayaran (bawaan: yang terakhir dipakai)
    const custom = { akun: false, metode: false };
    const renderChoice = key => {
      const opts = choicesFor(key);
      if (f[key] && !opts.includes(f[key])) opts.unshift(f[key]);
      $('#f-' + key, root).innerHTML = opts.map(v => `<button type="button" class="chip ${!custom[key] && v === f[key] ? 'on' : ''}" data-v="${esc(v)}">${esc(v)}</button>`).join('')
        + `<button type="button" class="chip ${custom[key] ? 'on' : ''}" data-new="1">＋ Tambah</button>`;
      $('#f-' + key + '-new', root).hidden = !custom[key];
    };
    ['akun', 'metode'].forEach(key => {
      $('#f-' + key, root).addEventListener('click', e => {
        const b = e.target.closest('.chip'); if (!b) return;
        if (b.dataset.new) { custom[key] = true; f[key] = $('#f-' + key + '-new', root).value.trim(); renderChoice(key); $('#f-' + key + '-new', root).focus(); }
        else { custom[key] = false; f[key] = b.dataset.v; renderChoice(key); }
      });
      $('#f-' + key + '-new', root).addEventListener('input', e => { f[key] = e.target.value.trim(); });
      renderChoice(key);
    });
    const renderCats = () => {
      const cats = categoriesFor(f.type);
      if (f.category && !customCat && !cats.some(c => c === f.category)) cats.unshift(f.category);
      $('#f-cats', root).innerHTML = cats.map(c => `<button type="button" class="cat-chip ${!customCat && c === f.category ? 'on' : ''}" data-c="${esc(c)}"><span class="e">${catEmoji(c)}</span>${esc(c)}</button>`).join('')
        + `<button type="button" class="cat-chip ${customCat ? 'on' : ''}" data-new="1"><span class="e">＋</span>Kategori baru</button>`;
      newCatEl.hidden = !customCat;
    };
    const renderDate = () => {
      dateEl.value = f.date;
      const t = todayISO(), y = toISO(addDays(todayD(), -1));
      $$('#f-date-row .chip', root).forEach(c => c.classList.toggle('on', (c.dataset.d === '0' && f.date === t) || (c.dataset.d === '-1' && f.date === y)));
      dateEl.classList.toggle('on', f.date !== t && f.date !== y);
    };

    setAmount(f.amount); noteEl.value = f.note; renderType(); renderDate();

    $('#f-type', root).addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b || b.dataset.type === f.type) return;
      f.type = b.dataset.type;
      if (!customCat && !categoriesFor(f.type).includes(f.category)) f.category = '';
      renderType();
    });
    amountEl.addEventListener('input', () => {
      const digits = amountEl.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 13);
      setAmount(digits ? Number(digits) : 0);
    });
    amountEl.addEventListener('keydown', e => { if (e.key === 'Enter') amountEl.blur(); });
    $('#f-quick', root).addEventListener('click', e => { const b = e.target.closest('button'); if (b) setAmount(f.amount + Number(b.dataset.v)); });
    $('#f-cats', root).addEventListener('click', e => {
      const b = e.target.closest('.cat-chip'); if (!b) return;
      if (b.dataset.new) { customCat = true; f.category = newCatEl.value.trim(); renderCats(); newCatEl.focus(); }
      else { customCat = false; f.category = b.dataset.c; renderCats(); }
      $('#e-cat', root).textContent = '';
    });
    newCatEl.addEventListener('input', () => { f.category = newCatEl.value.trim(); $('#e-cat', root).textContent = ''; });
    $('#f-date-row', root).addEventListener('click', e => {
      const b = e.target.closest('.chip'); if (!b) return;
      f.date = toISO(addDays(todayD(), Number(b.dataset.d))); renderDate(); $('#e-date', root).textContent = '';
    });
    dateEl.addEventListener('change', () => { if (dateEl.value) { f.date = dateEl.value; renderDate(); $('#e-date', root).textContent = ''; } });
    noteEl.addEventListener('input', () => { f.note = noteEl.value; });
    noteEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(); } });

    const saveBtn = $('#f-save', root);
    async function save() {
      let ok = true;
      if (!f.amount) { $('#e-amount', root).textContent = amountEl.value ? 'Nominal harus lebih dari 0' : 'Nominal wajib diisi'; ok = false; }
      else if (!(f.amount > 0)) { $('#e-amount', root).textContent = 'Nominal tidak boleh negatif'; ok = false; }
      if (!ok) { const w = $('#f-amount-wrap', root); w.classList.remove('err'); void w.offsetWidth; w.classList.add('err'); amountEl.focus(); }
      const needCat = colInfo(f.type).kategori !== null;
      if (needCat && !f.category) {
        $('#e-cat', root).textContent = customCat ? 'Tulis nama kategori' : 'Pilih kategori';
        const g = $('#f-cats', root); g.classList.remove('err'); void g.offsetWidth; g.classList.add('err'); ok = false;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) { $('#e-date', root).textContent = 'Pilih tanggal yang valid'; ok = false; }
      if (!ok) return;

      const ci2 = colInfo(f.type);
      const tx = { id: isEdit ? existing.id : newId(), type: f.type, amount: f.amount, category: f.category.trim(), date: f.date, note: (f.note || '').trim(),
        akun: ci2.akun ? (f.akun || '').trim() : '', metode: ci2.metode ? (f.metode || '').trim() : '' };
      if (!isEdit) {
        closeLayer(sheet);
        submitNew(tx);
        return;
      }
      saveBtn.disabled = true; saveBtn.innerHTML = '<span class="spin"></span> Menyimpan…';
      try {
        await submitEdit(existing, tx);
        closeLayer(sheet); renderView();
      } catch (e) {
        toast(e.network ? 'Tidak ada koneksi. Edit butuh internet, coba lagi.' : 'Gagal menyimpan: ' + e.message, { type: 'error', duration: 5000 });
        saveBtn.disabled = false; saveBtn.textContent = 'Simpan perubahan';
      }
    }
    saveBtn.addEventListener('click', save);
    if (!isEdit) amountEl.focus({ preventScroll: true });
  }

  function openDetail(tx) {
    const isIn = tx.type === 'pemasukan';
    const ci = colInfo(tx.type);
    const body = `
      <div class="detail-amt">${catIcon(tx.category, tx.type)}
        <div class="v num ${isIn ? 'in' : ''}">${isIn ? '+' : '−'}${rp(tx.amount)}</div>
        <div style="color:var(--text-3);font-size:13.5px;margin-top:2px">${isIn ? 'Pemasukan' : 'Pengeluaran'}${tx.pending ? ' · <span class="badge-pending">⏱ menunggu sinkron</span>' : ''}</div>
      </div>
      <div class="kv">
        ${ci.kategori !== null ? `<div><span>Kategori</span><span>${esc(tx.category || '—')}</span></div>` : ''}
        <div><span>Tanggal</span><span>${esc(fmtLong(tx.date))}</span></div>
        ${ci.akun ? `<div><span>Akun</span><span>${esc(tx.akun || '—')}</span></div>` : ''}
        ${ci.metode ? `<div><span>Pembayaran</span><span>${esc(tx.metode || '—')}</span></div>` : ''}
        ${ci.catatan !== null ? `<div><span>Catatan</span><span>${esc(tx.note || '—')}</span></div>` : ''}
      </div>`;
    const foot = `<div class="btn-row"><button class="btn btn-danger-ghost" id="d-del">Hapus</button><button class="btn btn-primary" id="d-edit">Edit</button></div>`;
    const sheet = openSheet('Detail transaksi', body, foot);
    $('#d-edit', sheet.el).addEventListener('click', () => { closeLayer(sheet); openTxForm(tx); });
    $('#d-del', sheet.el).addEventListener('click', async () => {
      const yes = await confirmDialog({
        title: 'Hapus transaksi ini?', danger: true, ok: 'Hapus',
        text: `${isIn ? '+' : '−'}${esc(rp(tx.amount))} · ${esc(tx.category || '')}<br>Baris di spreadsheet juga akan dihapus. Tindakan ini tidak bisa dibatalkan.`,
      });
      if (!yes) return;
      const btn = $('#d-del', sheet.el);
      btn.disabled = true; btn.innerHTML = '<span class="spin" style="border-color:rgba(220,47,69,.3);border-top-color:var(--danger)"></span>';
      try { await removeTx(tx); closeLayer(sheet); renderView(); }
      catch (e) {
        toast(e.network ? 'Tidak ada koneksi. Hapus butuh internet.' : 'Gagal menghapus: ' + e.message, { type: 'error', duration: 5000 });
        btn.disabled = false; btn.textContent = 'Hapus';
      }
    });
  }

  function openRangeSheet({ title, from, to, onApply, onClear }) {
    const t = todayD();
    const presets = [
      ['7 hari terakhir', toISO(addDays(t, -6)), toISO(t)],
      ['30 hari terakhir', toISO(addDays(t, -29)), toISO(t)],
      ['Bulan lalu', toISO(new Date(t.getFullYear(), t.getMonth() - 1, 1)), toISO(new Date(t.getFullYear(), t.getMonth(), 0))],
      ['Tahun ini', `${t.getFullYear()}-01-01`, `${t.getFullYear()}-12-31`],
    ];
    const body = `
      <div class="chips" style="flex-wrap:wrap">${presets.map((p, i) => `<button class="chip" data-p="${i}">${p[0]}</button>`).join('')}</div>
      <div class="field-label">Dari tanggal</div><input type="date" class="text-input" id="r-from" value="${esc(from || '')}">
      <div class="field-label">Sampai tanggal</div><input type="date" class="text-input" id="r-to" value="${esc(to || '')}">
      <div class="err-msg" id="r-err"></div>`;
    const foot = `<div class="btn-row"><button class="btn btn-ghost" id="r-clear">${onClear ? 'Hapus filter' : 'Batal'}</button><button class="btn btn-primary" id="r-apply">Terapkan</button></div>`;
    const sheet = openSheet(title, body, foot);
    const r = sheet.el;
    $('.chips', r).addEventListener('click', e => {
      const b = e.target.closest('[data-p]'); if (!b) return;
      const p = presets[+b.dataset.p]; $('#r-from', r).value = p[1]; $('#r-to', r).value = p[2];
      $$('.chips .chip', r).forEach(c => c.classList.toggle('on', c === b));
    });
    $('#r-apply', r).addEventListener('click', () => {
      const a = $('#r-from', r).value, b = $('#r-to', r).value;
      if (!a || !b) { $('#r-err', r).textContent = 'Isi kedua tanggal.'; return; }
      if (a > b) { $('#r-err', r).textContent = 'Tanggal awal harus sebelum tanggal akhir.'; return; }
      closeLayer(sheet); onApply(a, b);
    });
    $('#r-clear', r).addEventListener('click', () => { closeLayer(sheet); if (onClear) onClear(); });
  }

  // ================= TOAST =================
  function toast(msg, { type = 'success', duration = 2600, action } = {}) {
    const box = $('#toasts');
    const el = document.createElement('div');
    let timer;
    const h = {
      close() { clearTimeout(timer); el.classList.add('out'); setTimeout(() => el.remove(), 260); },
      update(m, t, d = 2600, act) {
        const real = t === 'info-static' ? 'info' : t;
        el.className = 'toast ' + real;
        el.innerHTML = `<span class="ti">${real === 'success' ? '✓' : real === 'error' ? '!' : ''}</span><span>${esc(m)}</span>`;
        if (t === 'info-static') { const ti = $('.ti', el); ti.style.animation = 'none'; ti.style.border = '0'; ti.style.background = '#e5a50a'; ti.textContent = '⏱'; }
        if (act) { const b = document.createElement('button'); b.textContent = act.label; b.onclick = () => { h.close(); act.fn(); }; el.append(b); }
        clearTimeout(timer);
        if (d) timer = setTimeout(h.close, d);
      },
    };
    h.update(msg, type, duration, action);
    box.append(el);
    while (box.children.length > 3) box.firstElementChild.remove();
    return h;
  }

  // ================= AKSI (event delegation) =================
  const actions = {
    add: () => openTxForm(),
    sync: () => refresh(),
    go: a => setTab(a.dataset.tab),
    period: a => { S.period = { key: a.dataset.k, from: '', to: '' }; renderView(); },
    'period-custom': () => {
      const r = periodRange();
      openRangeSheet({ title: 'Pilih periode', from: r.from, to: r.to, onApply: (from, to) => { S.period = { key: 'custom', from, to }; renderView(); } });
    },
    'trend-type': a => { S.trendType = a.dataset.v; renderStats(); },
    'tx-open': a => { const tx = S.txs.find(t => t.id === a.dataset.id); if (tx) openDetail(tx); },
    'hist-date': () => openRangeSheet({
      title: 'Filter tanggal', from: S.hist.from, to: S.hist.to,
      onApply: (from, to) => { Object.assign(S.hist, { from, to, limit: 60 }); renderHistory(); },
      onClear: () => { Object.assign(S.hist, { from: '', to: '' }); renderHistory(); },
    }),
    'hist-reset': () => { S.hist = { q: '', type: 'all', cat: '', from: '', to: '', limit: 60 }; renderHistory(); },
    more: () => { S.hist.limit += 100; renderHistoryList(); },
    logout: async () => {
      const warn = S.outbox.length ? `<br><b>${S.outbox.length} transaksi belum terkirim akan hilang.</b>` : '';
      if (await confirmDialog({ title: 'Keluar dari HP ini?', text: 'Data yang tersimpan di HP ini akan dibersihkan. Data di spreadsheet tetap aman.' + warn, ok: 'Keluar' })) logout();
    },
    'logout-all': async () => {
      if (!await confirmDialog({ title: 'Keluar dari semua perangkat?', text: 'Semua HP/browser yang sedang masuk harus login ulang.', ok: 'Keluar semua', danger: false })) return;
      try { await api('logoutAll'); } catch (e) { if (e.code !== 401) { toast(e.message, { type: 'error' }); return; } }
      logout();
    },
  };
  document.addEventListener('click', e => {
    const tab = e.target.closest('.nav-btn[data-tab]');
    if (tab) { setTab(tab.dataset.tab); return; }
    const a = e.target.closest('[data-action]');
    if (a && actions[a.dataset.action]) actions[a.dataset.action](a, e);
  });

  // ================= LOGIN =================
  const isConfigured = () => DEMO || (CFG.API_URL && /^https:\/\//.test(CFG.API_URL) && CFG.GOOGLE_CLIENT_ID && !/^ISI_/.test(CFG.GOOGLE_CLIENT_ID));
  function setLoginMsg(m, info) { const el = $('#login-msg'); el.textContent = m || ''; el.className = 'login-msg' + (info ? ' info' : ''); }

  function showLogin(msg) {
    $('#main').hidden = true; $('#login').hidden = false;
    const body = $('#login-body');
    setLoginMsg(msg || '');
    if (!isConfigured()) {
      body.innerHTML = `<div class="setup-warn"><b>Satu langkah lagi.</b> Isi <code>API_URL</code> dan <code>GOOGLE_CLIENT_ID</code> di file <code>config.js</code> sesuai panduan setup.</div>
        <div class="login-alt"><a href="?demo=1" style="color:var(--a1);font-weight:600">Coba mode demo</a></div>`;
      return;
    }
    if (DEMO) {
      body.innerHTML = `<button class="btn btn-primary" id="demo-in">Masuk ke mode demo</button>
        <div class="login-alt"><span>Data contoh, tidak terhubung ke spreadsheet.</span></div>`;
      $('#demo-in').onclick = () => doLogin(() => api('login'));
      return;
    }
    body.innerHTML = `<div id="gbtn"></div>
      <div class="login-alt"><button type="button" id="kode-toggle">Masuk dengan kode akses</button></div>
      <form class="login-kode" id="kode-form" hidden>
        <input class="text-input" type="password" id="kode" placeholder="Kode akses" autocomplete="current-password">
        <button class="btn btn-primary" type="submit">Masuk</button>
      </form>`;
    $('#kode-toggle').onclick = () => { const f = $('#kode-form'); f.hidden = !f.hidden; if (!f.hidden) $('#kode').focus(); };
    $('#kode-form').onsubmit = e => { e.preventDefault(); doLogin(() => api('loginKode', null, { kode: $('#kode').value })); };
    loadGIS().then(() => {
      google.accounts.id.initialize({
        client_id: CFG.GOOGLE_CLIENT_ID,
        callback: resp => doLogin(() => api('login', null, { idToken: resp.credential })),
        auto_select: true, cancel_on_tap_outside: false, use_fedcm_for_prompt: true, itp_support: true, context: 'signin',
      });
      google.accounts.id.renderButton($('#gbtn'), { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', locale: 'id', width: 280 });
      google.accounts.id.prompt();
    }).catch(() => setLoginMsg('Gagal memuat login Google. Periksa koneksi internet, lalu muat ulang.'));
  }

  let gisPromise;
  function loadGIS() {
    if (window.google && google.accounts && google.accounts.id) return Promise.resolve();
    gisPromise = gisPromise || new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = res; s.onerror = () => { gisPromise = null; rej(); };
      document.head.append(s);
    });
    return gisPromise;
  }

  async function doLogin(fn) {
    setLoginMsg('Memverifikasi…', true);
    try {
      const r = await fn();
      S.session = { token: r.token, expiresAt: r.expiresAt, user: r.user };
      store.set(K.session, S.session);
      setLoginMsg('');
      startApp();
    } catch (e) { setLoginMsg(e.message); }
  }

  function onUnauthorized() {
    S.session = null; store.del(K.session);
    showLogin('Sesi berakhir. Silakan masuk lagi.');
  }

  function logout() {
    store.del(K.session); store.del(K.cache); store.del(K.outbox);
    try { if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect(); } catch { /* abaikan */ }
    location.replace(location.pathname + (DEMO ? '?demo=1' : ''));
  }

  // ================= START =================
  function startApp() {
    $('#login').hidden = true; $('#main').hidden = false;
    const name = S.session && S.session.user && S.session.user.name;
    $('#hello').textContent = name ? 'Halo, ' + name.split(' ')[0] : 'Halo 👋';
    loadCache();
    renderView(); updateSyncPill();
    refresh({ silent: S.loaded });
    if (params.get('aksi') === 'tambah') { history.replaceState(null, '', location.pathname + (DEMO ? '?demo=1' : '')); openTxForm(); }
  }

  window.addEventListener('online', () => { if (S.session) refresh({ silent: true }); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.session && Date.now() - S.lastSync > 60000) refresh({ silent: true });
  });

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // ================= MODE DEMO =================
  const Demo = (() => {
    const KEY = 'ckd_db';
    const CATS = {
      pengeluaran: ['Makan & Minum', 'Transportasi', 'Belanja Harian', 'Tagihan & Utilitas', 'Kos & Sewa', 'Kesehatan', 'Hiburan', 'Pendidikan', 'Sedekah', 'Lain-lain'],
      pemasukan: ['Gaji', 'Bonus', 'Freelance', 'Investasi'],
    };
    function seed() {
      let s = 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      const notes = { 'Makan & Minum': ['Makan siang', 'Kopi', 'Nasi padang', 'Sarapan', 'Makan malam keluarga'], Transportasi: ['Ojol ke kantor', 'Bensin', 'Parkir', 'KRL'], 'Belanja Harian': ['Belanja mingguan', 'Sabun & sampo', 'Sayur'], Hiburan: ['Nonton bioskop', 'Langganan musik'], Kesehatan: ['Vitamin', 'Obat flu'] };
      const tx = []; let row = 2; const t = todayD();
      for (let i = 200; i >= 0; i--) {
        const d = addDays(t, -i), iso = toISO(d);
        const k = Math.floor(rnd() * 3) + (rnd() > 0.7 ? 1 : 0);
        for (let j = 0; j < k; j++) {
          const r = rnd();
          const cat = r < 0.42 ? 'Makan & Minum' : r < 0.62 ? 'Transportasi' : r < 0.77 ? 'Belanja Harian' : r < 0.85 ? 'Hiburan' : r < 0.9 ? 'Kesehatan' : r < 0.95 ? 'Lain-lain' : 'Pendidikan';
          const base = { 'Makan & Minum': 35000, Transportasi: 25000, 'Belanja Harian': 120000, Hiburan: 80000, Kesehatan: 60000, 'Lain-lain': 50000, Pendidikan: 150000 }[cat];
          const amt = Math.round(base * (0.5 + rnd() * 1.6) / 1000) * 1000;
          const ns = notes[cat] || [''];
          tx.push({ id: 'd' + row, type: 'pengeluaran', date: iso, amount: amt, category: cat, note: ns[Math.floor(rnd() * ns.length)], row: row++ });
        }
        if (d.getDate() === 25) tx.push({ id: 'd' + row, type: 'pemasukan', date: iso, amount: 8500000, category: 'Gaji', note: 'Gaji bulanan', row: row++ });
        if (d.getDate() === 1) {
          tx.push({ id: 'd' + row, type: 'pengeluaran', date: iso, amount: 1800000, category: 'Kos & Sewa', note: 'Sewa kos', row: row++ });
          tx.push({ id: 'd' + row, type: 'pengeluaran', date: iso, amount: 50000 * (1 + Math.floor(rnd() * 4)), category: 'Sedekah', note: 'Infak', row: row++ });
        }
        if (d.getDate() === 5) tx.push({ id: 'd' + row, type: 'pengeluaran', date: iso, amount: Math.round((350000 + rnd() * 200000) / 1000) * 1000, category: 'Tagihan & Utilitas', note: 'Listrik & internet', row: row++ });
        if (rnd() > 0.93) tx.push({ id: 'd' + row, type: 'pemasukan', date: iso, amount: Math.round((500000 + rnd() * 2000000) / 50000) * 50000, category: 'Freelance', note: 'Proyek desain', row: row++ });
      }
      return { tx, row };
    }
    const DEMO_COLS = { tanggal: 'TANGGAL', akun: 'AKUN', kategori: 'KATEGORI', nominal: 'NILAI', tipe: 'TIPE', metode: 'PAYMENT', catatan: 'NOTE', id: 'ID' };
    let db = store.get(KEY) || seed();
    const save = () => store.set(KEY, db);
    async function call(action, p) {
      await sleep(action === 'getAll' ? 500 : 350);
      if (action === 'login') return { token: 'demo', expiresAt: Date.now() + 864e5 * 90, user: { email: 'demo@catatku.app', name: 'Demo', picture: '' } };
      if (action === 'getAll') return {
        transactions: db.tx.map(t => Object.assign({}, t)),
        categories: { pemasukan: CATS.pemasukan, pengeluaran: CATS.pengeluaran, source: 'demo' },
        meta: { columns: { pemasukan: DEMO_COLS, pengeluaran: DEMO_COLS }, skipped: 0, sheetUrl: '', options: { akun: ['Kas Kelompok'], metode: ['Tunai', 'Transfer'] } },
      };
      if (action === 'add') { if (!db.tx.some(t => t.id === p.id)) db.tx.push(Object.assign({}, p, { row: db.row++ })); save(); return { id: p.id, row: db.row - 1 }; }
      if (action === 'update') { const t = db.tx.find(x => x.id === p.id); if (!t) throw new ApiError('Transaksi tidak ditemukan.', 404); Object.assign(t, p); save(); return { id: p.id }; }
      if (action === 'delete') { db.tx = db.tx.filter(x => x.id !== p.id); save(); return { deleted: true }; }
      if (action === 'logoutAll') return { loggedOut: true };
      throw new ApiError('Aksi tidak dikenal', 400);
    }
    return { call };
  })();

  // Mulai
  if (S.session && S.session.token && (!S.session.expiresAt || S.session.expiresAt > Date.now()) && isConfigured()) startApp();
  else showLogin();
})();
