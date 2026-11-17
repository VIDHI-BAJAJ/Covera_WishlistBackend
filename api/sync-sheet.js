// One-time backfill: copies ALL existing wishlist entries from Shopify into the "Wishlist" tab.
// Call from browser:  https://YOUR-VERCEL-URL/api/sync-sheet?key=<SETUP_SECRET>
// Safe to run more than once (Apps Script skips duplicates).
// Rows are grouped by name + mobile in the sheet: one row per customer, all products + prices inside it.
const { appendRows, buildRow } = require('../lib/google-sheet');
const SHOPIFY_STORE = process.env.SHOPIFY_STORE_URL;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

async function gql(query, variables = {}) {
  const res = await fetch(`https://${SHOPIFY_STORE}/admin/api/2024-10/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': SHOPIFY_TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Shopify ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

module.exports = async function handler(req, res) {
  const token = ((req.query && req.query.key) || (req.headers['authorization'] || '').replace('Bearer ', '')).trim();
  if (!process.env.SETUP_SECRET || token !== process.env.SETUP_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  try {
    let nodes = [], cursor = null, more = true;
    while (more) {
      const d = await gql(
        `query($after:String){ metaobjects(type:"wishlist_entry", first:250, after:$after){
           nodes{ fields{key value} } pageInfo{hasNextPage endCursor} } }`, { after: cursor });
      nodes = nodes.concat(d.metaobjects.nodes);
      more = d.metaobjects.pageInfo.hasNextPage; cursor = d.metaobjects.pageInfo.endCursor;
    }
    const rows = nodes
      .map(n => Object.fromEntries(n.fields.map(f => [f.key, f.value])))
      .sort((a, b) => String(a.added_at).localeCompare(String(b.added_at)))
      .map(e => buildRow({
        phone: e.phone, name: e.customer_name, product_id: e.product_id, product_title: e.product_title,
        product_handle: e.product_handle, product_price: e.product_price, added_at: e.added_at,
      }));

    // Same as the dashboard: one customer = one mobile, using the most recent non-empty name for it.
    // (rows are oldest -> newest, so the last non-empty name wins)
    const latestName = {};
    rows.forEach(r => { if (r.name) latestName[r.mobile] = r.name; });
    rows.forEach(r => { r.name = latestName[r.mobile] || ''; });

    let added = 0, skipped = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const r = await appendRows(rows.slice(i, i + 500));
      if (r) { added += r.added; skipped += r.skipped; }
    }
    return res.status(200).json({ total: rows.length, added, skipped });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
