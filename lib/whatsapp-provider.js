const config  = require('./whatsapp-config');
const bob     = require('./adapters/businessonbot');

const ADAPTERS = {
  businessonbot: bob,
  gokwik:        gokwik,
};

async function sendToProvider(wishlistData) {
  const providerKey = config.ACTIVE_PROVIDER;
  const adapter     = ADAPTERS[providerKey];
  const provConfig  = config[providerKey];

  if (!adapter) throw new Error(`Unknown provider: ${providerKey}`);

  // Retry up to 3 times
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await adapter.send(wishlistData, provConfig);
      console.log(`[WhatsApp] Success on attempt ${attempt}`);
      return result;
    } catch (err) {
      lastError = err;
      console.warn(`[WhatsApp] Attempt ${attempt} failed:`, err.message);
      if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 1000));
    }
  }

  throw lastError;
}

module.exports = { sendToProvider };