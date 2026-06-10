// Vercel Cron Job — runs every 10 minutes via GitHub Actions
const { sendToProvider } = require('../lib/whatsapp-provider');

const SHOPIFY_STORE = process.env.SHOPIFY_STORE_URL;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const CRON_SECRET  = process.env.CRON_SECRET || '';

async function gql(query, variables = {}) {
  const res = await fetch(
    `https://${SHOPIFY_STORE}/admin/api/2024-10/graphql.json`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': SHOPIFY_TOKEN },
      body: JSON.stringify({ query, variables }),
    }
  );
  if (!res.ok) throw new Error(`Shopify API error: ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

module.exports = async function handler(req, res) {
  // Allow Vercel cron (no auth header) OR requests with correct CRON_SECRET
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '').trim();

  if (CRON_SECRET && token !== CRON_SECRET) {
    console.log('[Cron] Auth failed. Received token:', token ? '***' : '(empty)');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('[Cron] Starting wishlist batch processing...');

  try {
    const batches = await fetchAllBatches();
    console.log(`[Cron] Found ${batches.length} pending batch(es)`);

    const results = [];

    for (const batch of batches) {
      const { id, phone, name, products: productsRaw, created_at } = batch;

      // Only process batches older than 10 minutes
      const ageMinutes = (Date.now() - new Date(created_at).getTime()) / 1000 / 60;
      if (ageMinutes < 10) {
        console.log(`[Cron] Skipping ${phone} — only ${ageMinutes.toFixed(1)} mins old`);
        continue;
      }

      let products = [];
      try { products = JSON.parse(productsRaw || '[]'); } catch (e) { products = []; }
      if (!products.length) { await deleteBatch(id); continue; }

      try {
        await sendToProvider({
          phone:          phone,
          customer_name:  name,
          // Simplified message — just wishlist count and link
          product_title:  `${products.length} item${products.length > 1 ? 's' : ''}`,
          product_handle: 'wishlist',
          variant_id:     '',
          product_image:  '',
          product_price:  '',
          product_list:   `You've added ${products.length} item${products.length > 1 ? 's' : ''} to your wishlist`,
          wishlist_count: String(products.length),
          wishlist_url:   'https://lovecovera.com/pages/wishlist',
        });

        console.log(`[Cron] ✅ WhatsApp sent to ${phone} for ${products.length} product(s)`);
        results.push({ phone, products: products.length, status: 'sent' });
        await deleteBatch(id);

      } catch (err) {
        console.error(`[Cron] ❌ Failed for ${phone}:`, err.message);
        results.push({ phone, products: products.length, status: 'failed', error: err.message });
      }
    }

    return res.status(200).json({ processed: results.length, results });

  } catch (err) {
    console.error('[Cron] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

async function fetchAllBatches() {
  let allNodes = [], cursor = null, hasNextPage = true;
  while (hasNextPage) {
    const data = await gql(
      `query FetchBatches($after: String) {
         metaobjects(type: "wishlist_batch", first: 250, after: $after) {
           nodes { id fields { key value } }
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
  return allNodes.map(n => ({ id: n.id, ...Object.fromEntries(n.fields.map(f => [f.key, f.value])) }));
}

async function deleteBatch(id) {
  await gql(
    `mutation DeleteBatch($id: ID!) { metaobjectDelete(id: $id) { deletedId userErrors { field message } } }`,
    { id }
  );
  console.log(`[Cron] Deleted batch ${id}`);
}
