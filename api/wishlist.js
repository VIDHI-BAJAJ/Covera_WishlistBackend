// Shopify Wishlist API - Vercel Serverless Function
// Stores wishlist entries as Shopify Metaobjects (visible in Shopify Admin)

const SHOPIFY_STORE = process.env.SHOPIFY_STORE_URL;   // yourstore.myshopify.com
const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

// Strip whitespace, newlines, and trailing slashes from origin to avoid header errors
function cleanOrigin(value) {
  if (!value) return '*';
  // Remove all whitespace (spaces, tabs, newlines, carriage returns)
  let s = String(value).replace(/\s+/g, '');
  // Remove trailing slashes
  s = s.replace(/\/+$/, '');
  return s || '*';
}
const ALLOWED_ORIGIN = cleanOrigin(process.env.ALLOWED_ORIGIN);

const API_SECRET = process.env.WISHLIST_API_SECRET || '';

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
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-wishlist-secret');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Secret key validation (lightweight protection)
  if (API_SECRET && req.headers['x-wishlist-secret'] !== API_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    if (req.method === 'POST')   return await addToWishlist(req, res);
    if (req.method === 'GET')    return await getWishlist(req, res);
    if (req.method === 'DELETE') return await removeFromWishlist(req, res);
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[Wishlist API Error]', err.message);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
};

// ─── Add to wishlist ──────────────────────────────────────────────────────────
async function addToWishlist(req, res) {
  const {
    phone, customer_name, product_id, product_title,
    product_handle, variant_id, product_image, product_price,
  } = req.body || {};

  if (!phone || !product_id) {
    return res.status(400).json({ error: 'phone and product_id are required' });
  }

  const cleanPhone = sanitizePhone(phone);
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanPhone);
  if (!isEmail && cleanPhone.replace(/[^\d]/g, '').length < 7) {
    return res.status(400).json({ error: 'Invalid phone number or email' });
  }

  const cleanName = sanitizeName(customer_name);

  // Prevent duplicate entries
  const existingId = await findEntry(cleanPhone, String(product_id));
  if (existingId) {
    return res.status(200).json({ success: true, alreadyExists: true, id: existingId });
  }

  const data = await gql(
    `mutation CreateWishlistEntry($fields: [MetaobjectFieldInput!]!) {
       metaobjectCreate(metaobject: {
         type: "wishlist_entry",
         fields: $fields
       }) {
         metaobject { id handle }
         userErrors { field message }
       }
     }`,
    {
      fields: [
        { key: 'phone',           value: cleanPhone },
        { key: 'customer_name',   value: cleanName },
        { key: 'product_id',      value: String(product_id) },
        { key: 'product_title',   value: product_title   || '' },
        { key: 'product_handle',  value: product_handle  || '' },
        { key: 'variant_id',      value: String(variant_id || '') },
        { key: 'product_image',   value: product_image   || '' },
        { key: 'product_price',   value: String(product_price || '') },
        { key: 'added_at',        value: new Date().toISOString() },
      ],
    }
  );

  const errors = data.metaobjectCreate.userErrors;
  if (errors.length) return res.status(400).json({ error: errors });

  return res.status(201).json({
    success: true,
    id: data.metaobjectCreate.metaobject.id,
  });
}

// ─── Get wishlist by phone ────────────────────────────────────────────────────
async function getWishlist(req, res) {
  const phone = req.query?.phone;
  if (!phone) return res.status(400).json({ error: 'phone query param is required' });

  const entries = await fetchEntriesByPhone(sanitizePhone(phone));
  return res.status(200).json({ wishlist: entries });
}

// ─── Remove from wishlist ─────────────────────────────────────────────────────
async function removeFromWishlist(req, res) {
  const { phone, product_id } = req.body || {};
  if (!phone || !product_id) {
    return res.status(400).json({ error: 'phone and product_id are required' });
  }

  const id = await findEntry(sanitizePhone(phone), String(product_id));
  if (!id) return res.status(404).json({ error: 'Wishlist entry not found' });

  await gql(
    `mutation DeleteWishlistEntry($id: ID!) {
       metaobjectDelete(id: $id) {
         deletedId
         userErrors { field message }
       }
     }`,
    { id }
  );

  return res.status(200).json({ success: true });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function fetchEntriesByPhone(phone) {
  let allNodes = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const data = await gql(
      `query FetchWishlist($after: String) {
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

  return allNodes
    .filter(node => {
      const f = node.fields.find(x => x.key === 'phone');
      return f && f.value === phone;
    })
    .map(node => ({
      id: node.id,
      ...Object.fromEntries(node.fields.map(f => [f.key, f.value])),
    }));
}

async function findEntry(phone, product_id) {
  const entries = await fetchEntriesByPhone(phone);
  const found = entries.find(e => e.product_id === product_id);
  return found ? found.id : null;
}

function sanitizePhone(phone) {
  const val = String(phone).trim();
  // If it looks like an email, sanitize as email
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
    return val.toLowerCase().substring(0, 100);
  }
  // Otherwise sanitize as phone number
  return val.replace(/[^\d+\s\-()]/g, '').trim().substring(0, 20);
}

function sanitizeName(name) {
  if (!name) return '';
  // Allow letters (incl. unicode), spaces, dots, hyphens, apostrophes; cap length
  return String(name).replace(/[<>{}|\\^`]/g, '').trim().substring(0, 80);
}
