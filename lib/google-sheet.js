// Pushes wishlist rows to the "Wishlist" tab of the Google Sheet via Apps Script web app.
const URL_ = process.env.GSHEET_WEBHOOK_URL;
const SECRET = process.env.GSHEET_SECRET;
const STORE = 'https://lovecovera.com';

function istString(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d).reduce((a, x) => (a[x.type] = x.value, a), {});
  return `${p.day}-${p.month}-${p.year} ${p.hour}:${p.minute}:${p.second}`;
}

function detectDevice(ua = '') {
  return /mobile|android|iphone|ipad/i.test(ua) ? 'Mobile' : 'Desktop';
}

function formatMobile(phone) {
  const c = String(phone || '').replace(/\D/g, '');
  if (!c) return String(phone || '');           // email case
  if (c.length === 10) return '91' + c;
  return c;
}

function buildRow({ phone, name, product_id, product_title, product_handle, product_price, added_at, page_url, device }) {
  return {
    datetime: istString(added_at ? new Date(added_at) : new Date()),
    name: name || '',
    mobile: formatMobile(phone),
    product: product_title || '',
    product_url: product_handle ? `${STORE}/products/${product_handle}` : '',
    page_url: page_url || '',
    device: device || '',
    product_id: String(product_id || ''),
    price: String(product_price || ''),
  };
}

async function appendRows(rows) {
  if (!URL_ || !SECRET) { console.warn('[Sheet] GSHEET_WEBHOOK_URL / GSHEET_SECRET not set — skipping'); return null; }
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids CORS preflight; Apps Script follows redirect
    body: JSON.stringify({ secret: SECRET, rows }),
    redirect: 'follow',
  });
  const text = await res.text();
  let body = {};
  try { body = JSON.parse(text); } catch (e) {}
  if (!res.ok || body.ok !== true) {
    throw new Error(`Sheet ${res.status}: ${text.substring(0, 200)}`);
  }
  console.log('[Sheet] OK', JSON.stringify(body));
  return body;
}

module.exports = { appendRows, buildRow, detectDevice };
