// Vercel Cron Job — runs every 10 minutes
// Reads all pending wishlist_batch metaobjects, sends 1 combined WhatsApp per customer, then deletes the batch

const { sendToProvider } = require('../lib/whatsapp-provider');

const SHOPIFY_STORE = process.env.SHOPIFY_STORE_URL;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const CRON_SECRET  = process.env.CRON_SECRET || '';

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
  if (!res.ok) throw new Error(`Shopify API error: ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

module.exports = async function handler(req, res) {
  // Security: only allow Vercel cron or requests with CRON_SECRET header
  const authHeader = req.headers['authorization'];
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('[Cron] Starting wishlist batch processing...');

  try {
    // Fetch all pending batches
    const batches = await fetchAllBatches();
    console.log(`[Cron] Found ${batches.length} pending batch(es)`);

    const results = [];

    for (const batch of batches) {
      const { id, phone, name, products: productsRaw, created_at } = batch;

      // Only process batches older than 10 minutes (give customer time to add more products)
      const createdAt = new Date(created_at);
      const ageMinutes = (Date.now() - createdAt.getTime()) / 1000 / 60;
      if (ageMinutes < 10) {
        console.log(`[Cron] Skipping ${phone} — batch only ${ageMinutes.toFixed(1)} mins old`);
        continue;
      }

      let products = [];
      try { products = JSON.parse(productsRaw || '[]'); } catch (e) { products = []; }

      if (!products.length) {
        await deleteBatch(id);
        continue;
      }

      const firstProduct = products[0];
      const totalCount   = products.length;

      // Build product list string for multi-product messages
      const productList = products.length === 1
        ? firstProduct.product_title
        : products.map((p, i) => `${i + 1}. ${p.product_title} - Rs.${p.product_price}`).join('\n');

      try {
        await sendToProvider({
          phone:          phone,
          customer_name:  name,
          product_title:  products.length === 1
                            ? firstProduct.product_title
                            : `${totalCount} items`,
          product_handle: firstProduct.product_handle,
          variant_id:     firstProduct.variant_id,
          product_image:  firstProduct.product_image,
          product_price:  products.length === 1
                            ? firstProduct.product_price
                            : products.reduce((sum, p) => sum + Number(p.product_price || 0), 0).toString(),
          product_list:   productList,
          wishlist_count: String(totalCount),
        });

        console.log(`[Cron] ✅ WhatsApp sent to ${phone} for ${totalCount} product(s)`);
        results.push({ phone, products: totalCount, status: 'sent' });

        // Delete batch after successful send
        await deleteBatch(id);

      } catch (err) {
        console.error(`[Cron] ❌ Failed to send to ${phone}:`, err.message);
        results.push({ phone, products: totalCount, status: 'failed', error: err.message });
      }
    }

    return res.status(200).json({ processed: results.length, results });

  } catch (err) {
    console.error('[Cron] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

async function fetchAllBatches() {
  let allNodes = [];
  let cursor = null;
  let hasNextPage = true;

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

  return allNodes.map(n => ({
    id: n.id,
    ...Object.fromEntries(n.fields.map(f => [f.key, f.value])),
  }));
}

async function deleteBatch(id) {
  await gql(
    `mutation DeleteBatch($id: ID!) {
       metaobjectDelete(id: $id) { deletedId userErrors { field message } }
     }`,
    { id }
  );
  console.log(`[Cron] Deleted batch ${id}`);
}
