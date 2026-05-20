// Wishlist Admin Dashboard
// ─────────────────────────────────────────────────────────────────────────────
// Two endpoints in one file:
//   GET /api/admin                           → HTML dashboard (login + UI)
//   GET /api/admin?data=customers&password=… → JSON: customers grouped by phone
//
// Visit: https://your-vercel-app.vercel.app/api/admin
//
// Protected by ADMIN_PASSWORD env var (set in Vercel dashboard).

const SHOPIFY_STORE   = process.env.SHOPIFY_STORE_URL;
const SHOPIFY_TOKEN   = process.env.SHOPIFY_ACCESS_TOKEN;
const API_SECRET      = process.env.WISHLIST_API_SECRET || '';

// ─── Shopify GraphQL helper ───────────────────────────────────────────────────
async function gql(query, variables = {}) {
  const res = await fetch(
    `https://${SHOPIFY_STORE}/admin/api/2024-10/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': SHOPIFY_TOKEN,
      },
      body: JSON.stringify({ query, variables }),
    }
  );
  if (!res.ok) throw new Error(`Shopify API error: ${res.status} ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

// ─── Main handler ─────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  try {
    // JSON data endpoint
    if (req.query.data === 'customers') {
      if (!API_SECRET || req.query.secret !== API_SECRET) {
        res.setHeader('Content-Type', 'application/json');
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const customers = await getGroupedCustomers();
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ customers });
    }

    // HTML dashboard
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    // Allow embedding inside Shopify admin (myshopify.com & shopify.com)
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://*.myshopify.com https://admin.shopify.com");
    return res.status(200).send(renderDashboardHTML());
  } catch (err) {
    console.error('[Admin Error]', err);
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ─── Fetch ALL entries and group by phone ─────────────────────────────────────
async function getGroupedCustomers() {
  let allNodes = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const data = await gql(
      `query FetchAll($after: String) {
         metaobjects(type: "wishlist_entry", first: 250, after: $after) {
           nodes {
             id
             fields { key value }
           }
           pageInfo { hasNextPage endCursor }
         }
       }`,
      { after: cursor }
    );
    const { nodes, pageInfo } = data.metaobjects;
    allNodes = allNodes.concat(nodes);
    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  // Convert nodes to flat entries
  const entries = allNodes.map(node => {
    const obj = { id: node.id };
    node.fields.forEach(f => { obj[f.key] = f.value; });
    return obj;
  });

  // Group by phone
  const map = new Map();
  for (const e of entries) {
    const phone = e.phone || 'unknown';
    if (!map.has(phone)) {
      map.set(phone, {
        phone,
        name: '',
        items: [],
        total_value: 0,
        last_added: null,
      });
    }
    const c = map.get(phone);

    // Use the most recent non-empty name we see for this phone
    if (e.customer_name && e.customer_name.trim()) c.name = e.customer_name.trim();

    const price = parseFloat(String(e.product_price || '').replace(/[^\d.]/g, '')) || 0;
    c.total_value += price;

    const addedAt = e.added_at || null;
    if (addedAt && (!c.last_added || addedAt > c.last_added)) {
      c.last_added = addedAt;
    }

    c.items.push({
      id: e.id,
      product_id: e.product_id,
      product_title: e.product_title || '',
      product_handle: e.product_handle || '',
      product_image: e.product_image || '',
      product_price: price,
      variant_id: e.variant_id || '',
      added_at: addedAt,
    });
  }

  // Sort items per customer by date desc
  const customers = Array.from(map.values()).map(c => {
    c.items.sort((a, b) => (b.added_at || '').localeCompare(a.added_at || ''));
    return c;
  });

  // Sort customers by item count desc, then by last_added desc
  customers.sort((a, b) => {
    if (b.items.length !== a.items.length) return b.items.length - a.items.length;
    return (b.last_added || '').localeCompare(a.last_added || '');
  });

  return customers;
}

// ─── Render HTML dashboard ────────────────────────────────────────────────────
function renderDashboardHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Wishlist Admin</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{font-family:'Inter',sans-serif;background:#fff;color:#0a0a0a;-webkit-font-smoothing:antialiased;line-height:1.5;font-size:14px;min-height:100vh}

/* LAYOUT */
.shell{display:flex;flex-direction:column;min-height:100vh}

/* TOP BAR (replaces sidebar) */
.topbar{display:flex;align-items:center;gap:24px;padding:14px 32px;border-bottom:1px solid #f0f0ee;background:#fff;position:sticky;top:0;z-index:50}
.topbar-left{display:flex;align-items:center;gap:10px;flex-shrink:0}
.brand-dot{width:26px;height:26px;background:#0a0a0a;border-radius:7px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.brand-dot svg{width:13px;height:13px;stroke:#fff;fill:none;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.brand-name{font-size:14px;font-weight:600;letter-spacing:-.01em}
.topnav{display:flex;align-items:center;gap:4px;flex:1}
.nav-item{padding:7px 14px;border-radius:7px;cursor:pointer;transition:background .12s,color .12s;color:#6b6b66;font-size:13px;font-weight:500;text-decoration:none;user-select:none}
.nav-item:hover{background:#f5f5f3;color:#0a0a0a}
.nav-item.active{background:#485861;color:#fff}
.topbar-right{flex-shrink:0}
.signout-btn{font-size:12px;color:#6b6b66;background:none;border:1px solid #e8e8e4;padding:6px 12px;border-radius:7px;cursor:pointer;font-family:'Inter',sans-serif;transition:all .12s}
.signout-btn:hover{color:#0a0a0a;border-color:#0a0a0a}

/* MAIN */
.main{padding:36px 40px 80px;overflow-x:hidden;min-width:0}

/* ═══ LOGIN SCREEN ═══ */
#login-screen{display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fff;width:100%}
.login-card{max-width:380px;width:100%;background:#fff;border-radius:14px;padding:36px;box-shadow:0 4px 24px rgba(0,0,0,0.06);border:1px solid #ebebe7}
.login-card h1{margin:0 0 6px;font-size:22px;font-weight:600;letter-spacing:-.02em}
.login-card p{margin:0 0 24px;color:#6b6b66;font-size:14px}
.login-card input{width:100%;padding:11px 14px;border:1px solid #e8e8e4;border-radius:8px;font-size:14px;font-family:'Inter',sans-serif;outline:none;transition:border-color .15s;color:#0a0a0a;background:#fafaf8}
.login-card input:focus{border-color:#0a0a0a;background:#fff}
.login-card button{width:100%;margin-top:10px;padding:12px;background:#0a0a0a;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:500;cursor:pointer;font-family:'Inter',sans-serif;transition:opacity .15s;letter-spacing:-.01em}
.login-card button:hover{opacity:.85}
.login-card button:disabled{opacity:.45;cursor:not-allowed}
.login-error{color:#c0392b;font-size:12px;margin-top:10px;min-height:16px}
.login-tip{margin-top:18px;font-size:11px;color:#9a9a93}

/* ═══ PAGE HEADER ═══ */
.page-header{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px}
.page-eyebrow{font-size:10px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#9a9a93;margin-bottom:5px}
.page-title{font-size:24px;font-weight:300;letter-spacing:-.03em;line-height:1}
.hdr-actions{display:flex;align-items:center;gap:8px}
.ghost-btn{padding:8px 13px;border:1px solid #e8e8e4;border-radius:7px;background:#fff;font-size:12px;font-weight:500;font-family:'Inter',sans-serif;cursor:pointer;color:#0a0a0a;transition:background .12s;display:inline-flex;align-items:center;gap:5px;letter-spacing:-.01em}
.ghost-btn:hover{background:#f5f5f3}
.ghost-btn svg{width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}

/* ═══ DATE BAR ═══ */
.date-bar{display:flex;align-items:center;gap:6px;margin-bottom:24px;flex-wrap:wrap;padding:12px 16px;background:#fafaf8;border-radius:10px;border:1px solid #f0f0ee}
.date-bar-label{font-size:11px;font-weight:600;color:#9a9a93;letter-spacing:.06em;text-transform:uppercase;margin-right:4px;white-space:nowrap}
.date-chip{padding:6px 12px;border:1px solid #e8e8e4;border-radius:20px;font-size:12px;font-weight:500;cursor:pointer;background:#fff;transition:all .12s;color:#6b6b66;font-family:'Inter',sans-serif;white-space:nowrap}
.date-chip:hover{border-color:#0a0a0a;color:#0a0a0a}
.date-chip.active{background:#485861;border-color:#0a0a0a;color:#fff}
.date-divider{width:1px;height:18px;background:#e8e8e4;margin:0 4px;flex-shrink:0}
.custom-dates{display:flex;align-items:center;gap:6px}
.date-in{padding:5px 10px;border:1px solid #e8e8e4;border-radius:7px;font-size:12px;font-family:'Inter',sans-serif;outline:none;background:#fff;color:#0a0a0a;transition:border-color .15s}
.date-in:focus{border-color:#0a0a0a}
.date-arrow{font-size:11px;color:#9a9a93}

/* ═══ CAPSULES ═══ */
.capsules{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:24px}
.cap{background:#fff;border:1px solid #f0f0ee;border-radius:12px;padding:18px 16px 16px;position:relative;overflow:hidden;transition:border-color .15s}
.cap:hover{border-color:#d8d8d4}
.cap-accent{position:absolute;top:0;left:0;right:0;height:2px}
.cap-label{font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#9a9a93;margin-bottom:10px}
.cap-value{font-size:22px;font-weight:300;letter-spacing:-.03em;line-height:1;color:#0a0a0a}
.cap-sub{font-size:11px;color:#9a9a93;margin-top:5px}

/* ═══ 3-GRID ═══ */
.grid3{display:grid;grid-template-columns:40% 1fr 1fr;gap:14px;align-items:start}

/* ═══ CARD ═══ */
.card{background:#fff;border:1px solid #f0f0ee;border-radius:12px;overflow:hidden}
.card-hdr{padding:16px 18px 0;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between}
.card-title{font-size:10px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#9a9a93}
.card-action{font-size:12px;color:#6b6b66;cursor:pointer;display:inline-flex;align-items:center;gap:3px;transition:color .12s;background:none;border:none;font-family:'Inter',sans-serif;padding:0}
.card-action:hover{color:#0a0a0a}
.card-action svg{width:11px;height:11px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}

/* CUSTOMER ROWS */
.cust-row{display:flex;align-items:center;gap:10px;padding:10px 18px;border-bottom:1px solid #f8f8f6;cursor:pointer;transition:background .1s}
.cust-row:last-child{border-bottom:none}
.cust-row:hover{background:#fafaf8}
.av{width:32px;height:32px;border-radius:50%;background:#eef0ff;color:#4a55c1;display:flex;align-items:center;justify-content:center;font-weight:600;font-size:11px;flex-shrink:0}
.cust-info{flex:1;min-width:0}
.cust-name{font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#0a0a0a}
.cust-meta{font-size:11px;color:#9a9a93;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
.cust-badge{font-size:11px;font-weight:600;color:#6b6b66;flex-shrink:0;background:#f5f5f3;padding:2px 8px;border-radius:10px}

/* PRODUCT ROWS */
.prod-row{display:flex;align-items:center;gap:9px;padding:9px 18px;border-bottom:1px solid #f8f8f6}
.prod-row:last-child{border-bottom:none}
.prod-rank{font-size:10px;font-weight:700;color:#c8c8c0;width:14px;text-align:center;flex-shrink:0}
.prod-thumb{width:34px;height:34px;border-radius:6px;object-fit:cover;background:#f0f0ee;flex-shrink:0}
.prod-thumb-ph{width:34px;height:34px;border-radius:6px;background:#f5f5f3;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:15px}
.prod-info{flex:1;min-width:0}
.prod-name{font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#0a0a0a}
.prod-saves{font-size:11px;color:#9a9a93;margin-top:1px}
.prod-bar-wrap{width:44px;flex-shrink:0}
.prod-bar-bg{height:2px;background:#f0f0ee;border-radius:2px;overflow:hidden}
.prod-bar-fill{height:100%;background:#0a0a0a;border-radius:2px;transition:width .5s ease}

/* PRICE DIST */
.dist-row{display:flex;align-items:center;gap:9px;padding:8px 18px;border-bottom:1px solid #f8f8f6}
.dist-row:last-child{border-bottom:none}
.dist-lbl{font-size:11px;color:#6b6b66;width:74px;flex-shrink:0;white-space:nowrap}
.dist-bar-wrap{flex:1}
.dist-bar-bg{height:3px;background:#f0f0ee;border-radius:2px;overflow:hidden}
.dist-bar-fill{height:100%;border-radius:2px;transition:width .5s ease}
.dist-ct{font-size:11px;font-weight:500;color:#6b6b66;width:18px;text-align:right;flex-shrink:0}

/* TREND CHART */
.trend-wrap{padding:8px 18px 14px}
.trend-labels{display:flex;justify-content:space-between;margin-top:4px}
.trend-lbl{font-size:10px;color:#c0c0ba}

/* EMPTY / LOADING */
.empty{padding:32px 18px;text-align:center;color:#9a9a93;font-size:13px}
.spin-wrap{padding:48px;text-align:center}
.spinner{display:inline-block;width:22px;height:22px;border:2px solid #f0f0ee;border-top-color:#0a0a0a;border-radius:50%;animation:spin .7s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}

/* ═══ CUSTOMERS FULL TABLE ═══ */
.search-row{margin-bottom:14px}
.search-in{width:100%;padding:10px 14px;border:1px solid #f0f0ee;border-radius:8px;font-size:13px;font-family:'Inter',sans-serif;outline:none;background:#fafaf8;color:#0a0a0a;transition:all .15s}
.search-in:focus{border-color:#0a0a0a;background:#fff}

.tbl-wrap{background:#fff;border:1px solid #f0f0ee;border-radius:12px;overflow:hidden}
.tbl-head{display:grid;grid-template-columns:1fr 70px 100px 110px 40px;gap:8px;padding:9px 18px;background:#fafaf8;border-bottom:1px solid #f0f0ee}
.th-cell{font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#9a9a93}
.tbl-row{display:grid;grid-template-columns:1fr 70px 100px 110px 40px;gap:8px;padding:11px 18px;border-bottom:1px solid #f8f8f6;cursor:pointer;transition:background .1s;align-items:center}
.tbl-row:last-child{border-bottom:none}
.tbl-row:hover{background:#fafaf8}
.td-name-wrap{display:flex;align-items:center;gap:9px;min-width:0}
.td-txt{font-size:13px;color:#4a4a46}
.td-bold{font-size:13px;font-weight:500;color:#0a0a0a}
.td-muted{font-size:11px;color:#9a9a93;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.td-arrow{font-size:12px;color:#c0c0ba}

/* ═══ DETAIL PAGE ═══ */
.back-btn{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:#6b6b66;cursor:pointer;margin-bottom:22px;padding:0;border:none;background:none;font-family:'Inter',sans-serif;transition:color .12s}
.back-btn:hover{color:#0a0a0a}
.back-btn svg{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.detail-profile{display:flex;align-items:center;gap:16px;margin-bottom:24px;padding-bottom:24px;border-bottom:1px solid #f0f0ee}
.detail-av{width:50px;height:50px;border-radius:50%;background:#eef0ff;color:#4a55c1;display:flex;align-items:center;justify-content:center;font-weight:600;font-size:17px;flex-shrink:0}
.detail-name{font-size:22px;font-weight:300;letter-spacing:-.02em;line-height:1.1}
.detail-phone{font-size:12px;color:#9a9a93;margin-top:3px}
.detail-caps{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:24px}
.items-title{font-size:10px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#9a9a93;margin-bottom:14px}
.detail-item{display:flex;align-items:center;gap:13px;padding:13px 0;border-bottom:1px solid #f0f0ee}
.detail-item:last-child{border-bottom:none}
.d-img{width:50px;height:50px;border-radius:8px;object-fit:cover;background:#f0f0ee;flex-shrink:0}
.d-img-ph{width:50px;height:50px;border-radius:8px;background:#f5f5f3;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0}
.d-item-title{font-size:14px;font-weight:500;margin-bottom:3px;color:#0a0a0a}
.d-item-meta{font-size:12px;color:#9a9a93}
.d-item-price{font-size:14px;font-weight:500;margin-left:auto;flex-shrink:0;color:#0a0a0a}

/* ═══ TOAST ═══ */
.toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(12px);background:#0a0a0a;color:#fff;padding:10px 18px;border-radius:8px;font-size:13px;opacity:0;transition:all .22s;pointer-events:none;z-index:9999;white-space:nowrap;box-shadow:0 4px 20px rgba(0,0,0,.15)}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}

@media(max-width:880px){
  .topbar{padding:12px 16px;gap:12px;flex-wrap:wrap}
  .topnav{order:3;width:100%;overflow-x:auto}
  .capsules{grid-template-columns:repeat(2,1fr)}
  .grid3{grid-template-columns:1fr}
  .main{padding:24px 20px 60px}
}
</style>
</head>
<body>

<!-- ══ LOGIN SCREEN ══ -->
<div id="login-screen">
  <div class="login-card">
    <h1>Wishlist Admin</h1>
    <p>Enter your API secret to access the dashboard.</p>
    <input id="login-input" type="password" placeholder="API secret" autocomplete="current-password" />
    <button id="login-btn">Sign in</button>
    <div id="login-error" class="login-error"></div>
    <p class="login-tip">Tip: bookmark <code>/api/admin?secret=YOUR_SECRET</code> to skip this screen.</p>
  </div>
</div>

<!-- ══ APP SHELL (shown after login) ══ -->
<div class="shell" id="app-shell" style="display:none">

  <!-- TOP BAR (replaces sidebar) -->
  <header class="topbar">
    <div class="topbar-left">
      <div class="brand-name">Wishlist Admin</div>
    </div>
    <nav class="topnav">
      <a class="nav-item active" id="nav-overview" onclick="showScreen('overview')">Overview</a>
      <a class="nav-item" id="nav-customers-full" onclick="showScreen('customers-full')">Customers</a>
    </nav>
    <div class="topbar-right">
      <button class="signout-btn" onclick="doLogout()">Sign out</button>
    </div>
  </header>

  <!-- MAIN -->
  <main class="main">

    <!-- OVERVIEW -->
    <div id="screen-overview" class="screen" style="display:none">
      <div class="page-header">
        <div>
          <div class="page-eyebrow">Dashboard</div>
          <h1 class="page-title">Overview</h1>
        </div>
        <div class="hdr-actions">
          <button class="ghost-btn" onclick="exportCSV()">
            <svg viewBox="0 0 14 14"><path d="M7 1v8M4 7l3 3 3-3"/><path d="M2 11v1a1 1 0 001 1h8a1 1 0 001-1v-1"/></svg>
            Export CSV
          </button>
        </div>
      </div>

      <!-- Date bar -->
      <div class="date-bar">
        <span class="date-bar-label">Range</span>
        <button class="date-chip active" id="chip-7"   onclick="setRangeDays(7,this)">Last 7 days</button>
        <button class="date-chip"        id="chip-30"  onclick="setRangeDays(30,this)">Last 30 days</button>
        <button class="date-chip"        id="chip-90"  onclick="setRangeDays(90,this)">Last 90 days</button>
        <button class="date-chip"        id="chip-all" onclick="setRangeDays(0,this)">All time</button>
        <div class="date-divider"></div>
        <div class="custom-dates">
          <input type="date" class="date-in" id="range-from" onchange="applyCustomRange()"/>
          <span class="date-arrow">→</span>
          <input type="date" class="date-in" id="range-to"   onchange="applyCustomRange()"/>
        </div>
      </div>

      <!-- 4 Capsules (matching Doc 1 stats: customers, total items, avg items, most wishlisted) -->
      <div class="capsules" id="capsules"></div>

      <!-- 3-col grid -->
      <div class="grid3">
        <div class="card">
          <div class="card-hdr">
            <span class="card-title">Recent customers</span>
            <button class="card-action" onclick="showScreen('customers-full')">View all <svg viewBox="0 0 12 12"><path d="M4 2l4 4-4 4"/></svg></button>
          </div>
          <div id="recent-list"></div>
        </div>
        <div class="card">
          <div class="card-hdr">
            <span class="card-title">Popular products</span>
          </div>
          <div id="popular-list"></div>
        </div>
        <div class="card">
          <div class="card-hdr">
            <span class="card-title">Price range</span>
          </div>
          <div id="price-dist"></div>
          <div class="card-hdr" style="margin-top:8px">
            <span class="card-title">Items added over time</span>
          </div>
          <div class="trend-wrap">
            <canvas id="trend-cvs" height="72" style="width:100%;height:72px;display:block"></canvas>
            <div class="trend-labels" id="trend-labels"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- CUSTOMERS FULL -->
    <div id="screen-customers-full" class="screen" style="display:none">
      <div class="page-header">
        <div>
          <div class="page-eyebrow">All customers</div>
          <h1 class="page-title">Wishlist customers</h1>
        </div>
        <div class="hdr-actions">
          <button class="ghost-btn" onclick="exportCSV()">
            <svg viewBox="0 0 14 14"><path d="M7 1v8M4 7l3 3 3-3"/><path d="M2 11v1a1 1 0 001 1h8a1 1 0 001-1v-1"/></svg>
            Export CSV
          </button>
        </div>
      </div>
      <div class="search-row">
        <input class="search-in" type="text" id="search-in" placeholder="Search by name or phone…" oninput="renderTable()"/>
      </div>
      <div class="tbl-wrap">
        <div class="tbl-head">
          <div class="th-cell">Customer</div>
          <div class="th-cell">Items</div>
          <div class="th-cell">Total value</div>
          <div class="th-cell">Last added</div>
          <div class="th-cell"></div>
        </div>
        <div id="tbl-body"></div>
      </div>
    </div>

    <!-- CUSTOMER DETAIL -->
    <div id="screen-customer-detail" class="screen" style="display:none">
      <button class="back-btn" id="back-btn">
        <svg viewBox="0 0 14 14"><path d="M9 2L4 7l5 5"/></svg>
        Back
      </button>
      <div id="detail-content"></div>
    </div>

  </main>
</div>

<div class="toast" id="toast"></div>

<!-- ══ STANDALONE LOGIN SCRIPT — runs first, independent of main app ══ -->
<script>
(function () {
  // This tiny script handles sign-in and showing the dashboard. It's
  // deliberately kept simple and isolated so it can never be broken by
  // issues in the main dashboard script below.
  var btn   = document.getElementById('login-btn');
  var input = document.getElementById('login-input');
  var errEl = document.getElementById('login-error');
  var loginScreen = document.getElementById('login-screen');
  var appShell    = document.getElementById('app-shell');

  function safeGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function safeSet(k,v) { try { sessionStorage.setItem(k,v); } catch (e) {} }
  function safeDel(k) { try { sessionStorage.removeItem(k); } catch (e) {} }

  function setErr(msg) { if (errEl) errEl.textContent = msg || ''; }
  function setLoading(on) {
    if (!btn) return;
    btn.disabled = on;
    btn.textContent = on ? 'Signing in…' : 'Sign in';
    if (input) input.disabled = on;
  }

  function showDashboard(secret, customers) {
    safeSet('wl_admin_secret', secret);
    // Hand data off to the main dashboard script
    window.__WL_DATA__ = { secret: secret, customers: customers || [] };
    if (loginScreen) loginScreen.style.display = 'none';
    if (appShell)    appShell.style.display    = 'flex';

    // Defensive: directly unhide the overview screen so the static HTML
    // (page header, date bar, card containers) shows even if the main
    // dashboard script never runs or throws.
    var overviewEl = document.getElementById('screen-overview');
    if (overviewEl) overviewEl.style.display = 'block';

    // Call the main script's render hook. Because the main script's IIFE may
    // not have executed yet (it runs after this <script> block parses), poll
    // for the hook to appear and then call it. This avoids any race condition.
    var attempts = 0;
    function tryRender() {
      attempts++;
      if (typeof window.__WL_RENDER__ === 'function') {
        try { window.__WL_RENDER__(customers, secret); }
        catch (e) { console.error('[WL Render]', e); }
        return;
      }
      if (attempts < 100) { // up to ~5 seconds
        setTimeout(tryRender, 50);
      } else {
        console.error('[WL] Main dashboard script did not load — render hook not found.');
        if (errEl) errEl.textContent = 'Could not load dashboard. Please reload the page.';
      }
    }
    tryRender();
  }

  async function doLogin(secret, silent) {
    if (!secret) { if (!silent) setErr('Please enter your API secret.'); return false; }
    if (!silent) { setLoading(true); setErr(''); }
    try {
      var url = window.location.origin + '/api/admin?data=customers&secret=' + encodeURIComponent(secret);
      var res = await fetch(url);
      if (res.status === 401) {
        safeDel('wl_admin_secret');
        if (!silent) setErr('Incorrect secret. Please try again.');
        return false;
      }
      if (!res.ok) {
        var txt = '';
        try { txt = await res.text(); } catch (e) {}
        throw new Error('HTTP ' + res.status + (txt ? ': ' + txt.slice(0,120) : ''));
      }
      var data = await res.json();
      showDashboard(secret, data.customers || []);
      return true;
    } catch (e) {
      console.error('[WL Login]', e);
      if (!silent) setErr('Error: ' + (e && e.message ? e.message : e));
      return false;
    } finally {
      if (!silent) setLoading(false);
    }
  }

  if (btn) {
    btn.addEventListener('click', function () {
      var s = (input && input.value || '').trim();
      doLogin(s, false);
    });
  }
  if (input) {
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && btn) btn.click();
    });
  }

  // Auto-login: prefer ?secret= in URL, then sessionStorage
  try {
    var urlSecret = new URLSearchParams(window.location.search).get('secret') || '';
    var saved = safeGet('wl_admin_secret') || '';
    var auto = urlSecret || saved;
    if (auto) {
      if (input) input.value = auto;
      doLogin(auto, true).then(function (ok) {
        if (!ok) {
          setErr('Session expired or secret invalid. Please sign in again.');
          if (input) { input.select(); input.focus(); }
        }
      });
    } else if (input) {
      input.focus();
    }
  } catch (e) {
    console.error('[WL Boot]', e);
    if (input) input.focus();
  }
})();
</script>

<script>
(function () {
  const LS_KEY = 'wl_admin_secret';
  let CUSTOMERS = [];
  let FILTERED   = [];
  let CURRENT_SECRET = '';
  let RANGE_START = null;
  let RANGE_END   = null;
  let PREV_SCREEN = 'overview';

  // ─── DOM refs ─────────────────────────────────────────────
  const $ = id => document.getElementById(id);

  // ─── Safe storage (sessionStorage can throw inside iframes) ─
  let _mem = {};
  const ss = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return _mem[k] || null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { _mem[k] = v; } },
    remove(k) { try { sessionStorage.removeItem(k); } catch (e) {} delete _mem[k]; }
  };

  // ─── Helpers ──────────────────────────────────────────────
  function showToast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => t.classList.remove('show'), 2500);
  }

  function escapeHTML(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatDate(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
        + ', ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    } catch { return '—'; }
  }

  function formatMoney(n) {
    if (!n || isNaN(n)) return '₹0';
    return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }

  function initials(name, phone) {
    if (name && name.trim()) {
      const parts = name.trim().split(/\s+/);
      return (((parts[0] || '')[0] || '') + ((parts[1] || '')[0] || '')).toUpperCase() || '?';
    }
    if (phone) return phone.replace(/\D/g, '').slice(-2);
    return '?';
  }

  function ensureHttps(url) {
    if (!url) return '';
    if (url.startsWith('//')) return 'https:' + url;
    if (url.startsWith('http')) return url;
    return 'https://' + url;
  }

  // ─── Screen routing ───────────────────────────────────────
  function showScreen(name) {
    if (name !== 'customer-detail') PREV_SCREEN = name;
    ['overview', 'customers-full', 'customer-detail'].forEach(s => {
      const el = $('screen-' + s);
      if (el) el.style.display = 'none';
    });
    const target = $('screen-' + name);
    if (target) target.style.display = 'block';
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const map = { 'overview': 'nav-overview', 'customers-full': 'nav-customers-full' };
    const navKey = name === 'customer-detail'
      ? (PREV_SCREEN === 'customers-full' ? 'nav-customers-full' : 'nav-overview')
      : map[name];
    if (navKey && $(navKey)) $(navKey).classList.add('active');
    if (name === 'customers-full') renderTable();
  }

  // ─── Login ────────────────────────────────────────────────
  function setLoginState(loading) {
    const btn = $('login-btn');
    const inp = $('login-input');
    if (!btn) return;
    btn.disabled = loading;
    btn.textContent = loading ? 'Signing in…' : 'Sign in';
    if (inp) inp.disabled = loading;
  }

  function showLoginError(msg) {
    const el = $('login-error');
    if (el) el.textContent = msg;
  }

  async function tryLogin(secret, silent = false) {
    if (!secret) return false;

    if (!silent) {
      setLoginState(true);
      showLoginError('');
    }

    try {
      const url = window.location.origin + '/api/admin?data=customers&secret=' + encodeURIComponent(secret);
      const res = await fetch(url);

      if (res.status === 401) {
        ss.remove(LS_KEY); // clear bad saved secret
        if (!silent) showLoginError('Incorrect secret. Please try again.');
        return false;
      }
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error('HTTP ' + res.status + (txt ? ': ' + txt.slice(0, 120) : ''));
      }

      const data = await res.json();
      CUSTOMERS = data.customers || [];
      CURRENT_SECRET = secret;
      ss.set(LS_KEY, secret);

      // Show dashboard, hide login
      $('login-screen').style.display = 'none';
      $('app-shell').style.display = 'flex';

      initDashboard();
      return true;

    } catch (e) {
      console.error('[WL Login]', e);
      ss.remove(LS_KEY);
      if (!silent) showLoginError('Error: ' + e.message + '. Check console for details.');
      return false;
    } finally {
      if (!silent) setLoginState(false);
    }
  }

  $('login-btn').addEventListener('click', () => {
    const secret = $('login-input').value.trim();
    if (!secret) { showLoginError('Please enter your API secret.'); return; }
    tryLogin(secret, false);
  });
  $('login-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('login-btn').click();
  });

  function doLogout() {
    ss.remove(LS_KEY);
    CURRENT_SECRET = '';
    CUSTOMERS = [];
    FILTERED = [];
    $('app-shell').style.display = 'none';
    $('login-screen').style.display = 'flex';
    $('login-input').value = '';
    if (window.history && window.history.replaceState) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }
  window.doLogout = doLogout;

  // ─── Init dashboard after login ──────────────────────────
  function initDashboard() {
    // Always show the overview screen FIRST, so the static page header,
    // date bar, and card containers become visible regardless of whether
    // any individual render below succeeds.
    try { showScreen('overview'); } catch (e) { console.error('[WL showScreen]', e); }

    try {
      const now = new Date();
      const d7  = new Date(now); d7.setDate(d7.getDate() - 7);
      const rt = $('range-to');   if (rt) rt.value = now.toISOString().slice(0, 10);
      const rf = $('range-from'); if (rf) rf.value = d7.toISOString().slice(0, 10);
      const chip = $('chip-7');
      if (chip) {
        setRangeDays(7, chip);
      } else {
        // Fallback: set state directly and render
        const fromIso = d7.toISOString().slice(0, 10);
        const toIso   = now.toISOString().slice(0, 10);
        RANGE_START = fromIso; RANGE_END = toIso;
        applyFilterAndRender();
      }
    } catch (e) {
      console.error('[WL initDashboard]', e);
      // Even if filter/render fails, try to render with no filter as a fallback
      try {
        RANGE_START = null; RANGE_END = null;
        applyFilterAndRender();
      } catch (e2) { console.error('[WL fallback render]', e2); }
    }
  }

  // ─── Date range ──────────────────────────────────────────
  function setRangeDays(days, btn) {
    document.querySelectorAll('.date-chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    if (days === 0) {
      RANGE_START = null; RANGE_END = null;
      $('range-from').value = '';
      $('range-to').value   = '';
    } else {
      const now  = new Date();
      const from = new Date(now); from.setDate(from.getDate() - days);
      RANGE_START = from.toISOString().slice(0, 10);
      RANGE_END   = now.toISOString().slice(0, 10);
      $('range-from').value = RANGE_START;
      $('range-to').value   = RANGE_END;
    }
    applyFilterAndRender();
  }

  function applyCustomRange() {
    const s = $('range-from').value;
    const e = $('range-to').value;
    if (!s || !e) return;
    document.querySelectorAll('.date-chip').forEach(c => c.classList.remove('active'));
    RANGE_START = s; RANGE_END = e;
    applyFilterAndRender();
  }

  function applyFilterAndRender() {
    if (!RANGE_START || !RANGE_END) {
      FILTERED = CUSTOMERS.map(c => ({ ...c, items: [...c.items] }));
    } else {
      const s = new Date(RANGE_START); s.setHours(0, 0, 0, 0);
      const e = new Date(RANGE_END);   e.setHours(23, 59, 59, 999);
      FILTERED = CUSTOMERS.map(c => {
        const items = c.items.filter(it => {
          if (!it.added_at) return false;
          const d = new Date(it.added_at);
          return d >= s && d <= e;
        });
        if (!items.length) return null;
        return { ...c, items, total_value: items.reduce((a, it) => a + (it.product_price || 0), 0) };
      }).filter(Boolean);
    }
    renderOverview();
  }

  // ─── Overview ────────────────────────────────────────────
  function renderOverview() {
    showScreen('overview');
    try { renderCapsules(); }   catch (e) { console.error('[WL renderCapsules]', e); }
    try { renderRecent(); }     catch (e) { console.error('[WL renderRecent]', e); }
    try { renderPopular(); }    catch (e) { console.error('[WL renderPopular]', e); }
    try { renderPriceDist(); }  catch (e) { console.error('[WL renderPriceDist]', e); }
    try { renderTrend(); }      catch (e) { console.error('[WL renderTrend]', e); }
  }

  function renderCapsules() {
    const tc  = FILTERED.length;
    const ti  = FILTERED.reduce((a, c) => a + c.items.length, 0);
    const avg = tc ? (ti / tc).toFixed(1) : '0';
    const top = FILTERED.reduce((m, c) => Math.max(m, c.items.length), 0);
    $('capsules').innerHTML = \`
      <div class="cap">
        <div class="cap-accent" style="background:#485861"></div>
        <div class="cap-label">Customers</div>
        <div class="cap-value">\${tc}</div>
        <div class="cap-sub">in selected range</div>
      </div>
      <div class="cap">
        <div class="cap-accent" style="background:#485861"></div>
        <div class="cap-label">Total Items</div>
        <div class="cap-value">\${ti}</div>
        <div class="cap-sub">saved products</div>
      </div>
      <div class="cap">
        <div class="cap-accent" style="background:#485861"></div>
        <div class="cap-label">Avg Items</div>
        <div class="cap-value">\${avg}</div>
        <div class="cap-sub">per customer</div>
      </div>
      <div class="cap">
        <div class="cap-accent" style="background:#485861"></div>
        <div class="cap-label">Most Wishlisted</div>
        <div class="cap-value">\${top}</div>
        <div class="cap-sub">items by one customer</div>
      </div>
    \`;
  }

  function renderRecent() {
    const top = FILTERED.slice(0, 9);
    if (!top.length) { $('recent-list').innerHTML = '<div class="empty">No customers in range</div>'; return; }
    $('recent-list').innerHTML = top.map(c => {
      const idx = CUSTOMERS.findIndex(x => x.phone === c.phone);
      return \`
        <div class="cust-row" onclick="openDetail(\${idx})">
          <div class="av">\${escapeHTML(initials(c.name, c.phone))}</div>
          <div class="cust-info">
            <div class="cust-name">\${escapeHTML(c.name || c.phone)}</div>
            <div class="cust-meta">\${c.items.length} item\${c.items.length === 1 ? '' : 's'} · \${formatDate(c.last_added)}</div>
          </div>
          <div class="cust-badge">\${c.items.length}</div>
        </div>\`;
    }).join('');
  }

  function renderPopular() {
    const counts = {};
    FILTERED.forEach(c => c.items.forEach(it => {
      const key = it.product_id || it.product_title || 'x';
      if (!counts[key]) counts[key] = { title: it.product_title || 'Untitled', image: it.product_image, price: it.product_price, count: 0 };
      counts[key].count++;
    }));
    const prods = Object.values(counts).sort((a, b) => b.count - a.count).slice(0, 7);
    if (!prods.length) { $('popular-list').innerHTML = '<div class="empty">No data</div>'; return; }
    const max = prods[0].count;
    $('popular-list').innerHTML = prods.map((p, i) => \`
      <div class="prod-row">
        <div class="prod-rank">\${i + 1}</div>
        \${p.image
          ? \`<img class="prod-thumb" src="\${escapeHTML(ensureHttps(p.image))}" loading="lazy" alt="" onerror="this.style.display='none'"/>\`
          : \`<div class="prod-thumb-ph">🛍</div>\`}
        <div class="prod-info">
          <div class="prod-name">\${escapeHTML(p.title)}</div>
          <div class="prod-saves">\${p.count} saves · \${formatMoney(p.price)}</div>
        </div>
        <div class="prod-bar-wrap">
          <div class="prod-bar-bg"><div class="prod-bar-fill" style="width:\${Math.round(p.count / max * 100)}%"></div></div>
        </div>
      </div>\`).join('');
  }

  function renderPriceDist() {
    const brackets = [
      { l: '< ₹500',    min: 0,     max: 500,      c: '#50D5FA' },
      { l: '₹500–2k',   min: 500,   max: 2000,     c: '#485861' },
      { l: '₹2k–5k',    min: 2000,  max: 5000,     c: '#94B4BC' },
      { l: '₹5k–10k',   min: 5000,  max: 10000,    c: '#50D5FA' },
      { l: '> ₹10k',    min: 10000, max: Infinity,  c: '#94B4BC' },
    ];
    const all  = FILTERED.flatMap(c => c.items);
    const rows = brackets.map(b => ({ ...b, n: all.filter(it => it.product_price >= b.min && it.product_price < b.max).length }));
    const max  = Math.max(...rows.map(r => r.n), 1);
    $('price-dist').innerHTML = rows.map(r => \`
      <div class="dist-row">
        <div class="dist-lbl">\${r.l}</div>
        <div class="dist-bar-wrap"><div class="dist-bar-bg"><div class="dist-bar-fill" style="width:\${Math.round(r.n / max * 100)}%;background:\${r.c}"></div></div></div>
        <div class="dist-ct">\${r.n}</div>
      </div>\`).join('');
  }

  function renderTrend() {
    const cvs = $('trend-cvs');
    const ctx = cvs.getContext('2d');
    const W = cvs.offsetWidth || 260; const H = 72;
    cvs.width = W * devicePixelRatio; cvs.height = H * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.clearRect(0, 0, W, H);

    const s = RANGE_START ? new Date(RANGE_START) : new Date(Date.now() - 7 * 864e5);
    const e = RANGE_END   ? new Date(RANGE_END)   : new Date();
    const diffDays = Math.max(1, Math.round((e - s) / 864e5));
    const buckets  = Math.min(diffDays, 14);
    const stepMs   = (e - s) / buckets;

    const days = Array.from({ length: buckets }, (_, i) => {
      const from  = new Date(s.getTime() + i * stepMs);
      const to    = new Date(s.getTime() + (i + 1) * stepMs);
      const count = FILTERED.flatMap(c => c.items).filter(it => {
        if (!it.added_at) return false;
        const d = new Date(it.added_at); return d >= from && d < to;
      }).length;
      return { count, label: from.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) };
    });

    const maxC = Math.max(...days.map(d => d.count), 1);
    const pad = 6; const cW = W - pad * 2; const cH = H - 18;

    ctx.beginPath();
    days.forEach((d, i) => {
      const x = pad + i * (cW / (buckets - 1 || 1));
      const y = H - 14 - (d.count / maxC * (cH - 6));
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#0a0a0a'; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();

    ctx.lineTo(pad + (buckets - 1) * (cW / (buckets - 1 || 1)), H - 14);
    ctx.lineTo(pad, H - 14); ctx.closePath();
    ctx.fillStyle = 'rgba(10,10,10,0.05)'; ctx.fill();

    days.forEach((d, i) => {
      const x = pad + i * (cW / (buckets - 1 || 1));
      const y = H - 14 - (d.count / maxC * (cH - 6));
      ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = '#0a0a0a'; ctx.fill();
    });

    const show = [0, Math.floor(buckets / 2), buckets - 1];
    $('trend-labels').innerHTML = days.map((d, i) =>
      show.includes(i) ? \`<span class="trend-lbl">\${d.label}</span>\` : \`<span></span>\`
    ).join('');
  }

  // ─── Full customer table ──────────────────────────────────
  function renderTable() {
    const q = ($('search-in')?.value || '').trim().toLowerCase();
    const list = q
      ? CUSTOMERS.filter(c => (c.phone || '').toLowerCase().includes(q) || (c.name || '').toLowerCase().includes(q))
      : CUSTOMERS;
    $('tbl-body').innerHTML = list.length
      ? list.map(c => {
          const idx = CUSTOMERS.indexOf(c);
          return \`
            <div class="tbl-row" onclick="openDetail(\${idx})">
              <div class="td-name-wrap">
                <div class="av">\${escapeHTML(initials(c.name, c.phone))}</div>
                <div>
                  <div class="td-bold">\${escapeHTML(c.name || '—')}</div>
                  <div class="td-muted">\${escapeHTML(c.phone || '')}</div>
                </div>
              </div>
              <div class="td-bold">\${c.items.length}</div>
              <div class="td-txt">\${formatMoney(c.total_value)}</div>
              <div class="td-txt">\${formatDate(c.last_added)}</div>
              <div class="td-arrow">→</div>
            </div>\`;
        }).join('')
      : '<div class="empty">No customers found</div>';
  }

  // ─── Customer detail ─────────────────────────────────────
  function openDetail(idx) {
    const c = CUSTOMERS[idx];
    if (!c) return;
    const from = PREV_SCREEN;
    $('back-btn').onclick = () => showScreen(from === 'customers-full' ? 'customers-full' : 'overview');

    $('detail-content').innerHTML = \`
      <div class="detail-profile">
        <div class="detail-av">\${escapeHTML(initials(c.name, c.phone))}</div>
        <div>
          <div class="detail-name">\${escapeHTML(c.name || c.phone)}</div>
          <div class="detail-phone">\${c.name ? escapeHTML(c.phone) : ''}</div>
        </div>
      </div>
      <div class="detail-caps">
        <div class="cap"><div class="cap-accent" style="background:#0a0a0a"></div><div class="cap-label">Wishlist value</div><div class="cap-value" style="font-size:19px">\${formatMoney(c.total_value)}</div></div>
        <div class="cap"><div class="cap-accent" style="background:#4a55c1"></div><div class="cap-label">Items saved</div><div class="cap-value" style="font-size:19px">\${c.items.length}</div></div>
        <div class="cap"><div class="cap-accent" style="background:#1a7f5a"></div><div class="cap-label">Last activity</div><div class="cap-value" style="font-size:14px;font-weight:400;margin-top:4px">\${formatDate(c.last_added)}</div></div>
      </div>
      <div class="items-title">Saved items (\${c.items.length})</div>
      \${c.items.map(it => \`
        <div class="detail-item">
          \${it.product_image
            ? \`<img class="d-img" src="\${escapeHTML(ensureHttps(it.product_image))}" loading="lazy" alt="" onerror="this.style.display='none'"/>\`
            : \`<div class="d-img-ph">🛍</div>\`}
          <div style="flex:1;min-width:0">
            <div class="d-item-title">\${escapeHTML(it.product_title || 'Untitled product')}</div>
            <div class="d-item-meta">Added \${formatDate(it.added_at)}</div>
          </div>
          <div class="d-item-price">\${formatMoney(it.product_price)}</div>
        </div>\`).join('')}
    \`;
    showScreen('customer-detail');
  }
  window.openDetail = openDetail;

  // ─── CSV Export ──────────────────────────────────────────
  function exportCSV() {
    if (!CUSTOMERS.length) { showToast('Nothing to export'); return; }
    const rows = [['Name', 'Phone', 'Product Title', 'Product Handle', 'Variant ID', 'Price', 'Added At']];
    CUSTOMERS.forEach(c => {
      c.items.forEach(it => {
        rows.push([c.name || '', c.phone || '', it.product_title || '', it.product_handle || '', it.variant_id || '', it.product_price || '', it.added_at || '']);
      });
    });
    const csv = rows.map(r =>
      r.map(cell => {
        const s = String(cell == null ? '' : cell);
        if (/[",\\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
        return s;
      }).join(',')
    ).join('\\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = 'wishlist-customers-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('CSV downloaded ✓');
  }

  window.showScreen       = showScreen;
  window.setRangeDays     = setRangeDays;
  window.applyCustomRange = applyCustomRange;
  window.exportCSV        = exportCSV;
  window.renderTable      = renderTable;

  // ─── Boot: prefer data from standalone login script, then ?secret= in URL ───
  function getUrlSecret() {
    try { return new URLSearchParams(window.location.search).get('secret') || ''; }
    catch { return ''; }
  }

  // Render hook called by the standalone login script after a successful login.
  // The standalone script has already fetched customers and shown the dashboard,
  // so we just populate state and render.
  window.__WL_RENDER__ = function (customers, secret) {
    try {
      CUSTOMERS = customers || [];
      CURRENT_SECRET = secret || '';
      // Make sure the screens are correctly toggled (standalone script does this too,
      // but be defensive).
      const ls = $('login-screen'); if (ls) ls.style.display = 'none';
      const as = $('app-shell');    if (as) as.style.display = 'flex';
      initDashboard();
    } catch (e) {
      console.error('[WL Render]', e);
    }
  };

  (async function boot() {
    try {
      // If standalone script already populated data, just render.
      if (window.__WL_DATA__ && window.__WL_DATA__.customers) {
        window.__WL_RENDER__(window.__WL_DATA__.customers, window.__WL_DATA__.secret);
        return;
      }

      // Otherwise (standalone script didn't run or login still pending), wait
      // briefly for it to finish, then fall back to our own auto-login.
      await new Promise(r => setTimeout(r, 50));
      if (window.__WL_DATA__ && window.__WL_DATA__.customers) {
        window.__WL_RENDER__(window.__WL_DATA__.customers, window.__WL_DATA__.secret);
        return;
      }

      const urlSecret   = getUrlSecret();
      const savedSecret = ss.get(LS_KEY) || '';
      const autoSecret  = urlSecret || savedSecret;

      if (autoSecret) {
        $('login-input').value = autoSecret;
        const ok = await tryLogin(autoSecret, true);
        if (!ok) {
          showLoginError('Session expired or secret invalid. Please sign in again.');
          $('login-input').select();
        }
      } else {
        $('login-input').focus();
      }
    } catch (e) {
      console.error('[WL Boot]', e);
    }
  })();
})();
</script>
</body>
</html>`;
}
