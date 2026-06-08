async function send(data, config) {
  // BOB custom webhook expects variables FLAT at top level (not nested)
  // Variable names must match exactly what's defined in BOB workflow step 1:
  // name, phone, product_name, product_url, product_image, variant_id, price, wishlist_date
  const payload = {
    platform:      "lovecovera",
    phone:         formatPhone(data.phone),
    name:          data.customer_name,
    product_name:  data.product_title,
    product_url:   `https://lovecovera.com/products/${data.product_handle}`,
    product_image: data.product_image  || '',
    variant_id:    data.variant_id     || '',
    price:         data.product_price  || '',
    wishlist_date: new Date().toISOString().split('T')[0],
  };

  console.log('[BOB] Sending:', JSON.stringify(payload));

  const res = await fetch(config.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const body = await res.json().catch(() => ({}));
  console.log('[BOB] Response:', res.status, JSON.stringify(body));

  if (!res.ok) throw new Error(`BOB ${res.status}: ${JSON.stringify(body)}`);
  return { provider: 'businessonbot', success: true, response: body };
}

// Ensures phone is always 91XXXXXXXXXX format for BOB
function formatPhone(phone) {
  const cleaned = String(phone).replace(/\D/g, ''); // remove non-digits
  if (cleaned.startsWith('91') && cleaned.length === 12) return cleaned;
  if (cleaned.length === 10) return `91${cleaned}`;
  return cleaned;
}

module.exports = { send };
