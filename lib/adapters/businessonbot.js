async function send(data, config) {
  const payload = {
    platform: "lovecovera",
    phone:    formatPhone(data.phone),
    variables: {
      name:          data.customer_name,
      phone:         formatPhone(data.phone),
      product_name:  data.product_title,
      product_url:   `https://lovecovera.com/products/${data.product_handle}`,
      product_image: data.product_image || '',
      variant_id:    data.variant_id    || '',
      price:         data.product_price || '',
      wishlist_date: new Date().toISOString().split('T')[0],
    },
    noOfVariables: 8,
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
  const cleaned = String(phone).replace(/\D/g, '');
  if (cleaned.startsWith('91') && cleaned.length === 12) return cleaned;
  if (cleaned.length === 10) return `91${cleaned}`;
  return cleaned;
}

module.exports = { send };
