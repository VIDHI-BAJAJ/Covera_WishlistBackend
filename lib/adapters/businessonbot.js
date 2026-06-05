async function send(data, config) {
  const payload = {
    platform:  "lovecovera",
    phone:      data.phone,
    variables: {
      name:          data.customer_name,
      phone:         data.phone,
      product_name:  data.product_title,
      product_url:   `https://lovecovera.com/products/${data.product_handle}`,
      product_image: data.product_image  || '',
      variant_id:    data.variant_id     || '',
      price:         data.product_price  || '',
      wishlist_date: new Date().toISOString().split('T')[0],
    },
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

module.exports = { send };