// One-time setup: creates the Metaobject definition in your Shopify store.
// Run once by visiting: https://your-vercel-app.vercel.app/api/setup?secret=YOUR_SECRET
//
// After this runs, you will see "Wishlist Entries" in:
// Shopify Admin → Content → Metaobjects

const SHOPIFY_STORE = process.env.SHOPIFY_STORE_URL;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SETUP_SECRET = process.env.SETUP_SECRET || '';

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
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

module.exports = async function handler(req, res) {
  // Basic protection so only you can run setup
  if (SETUP_SECRET && req.query.secret !== SETUP_SECRET) {
    return res.status(401).json({ error: 'Unauthorized. Pass ?secret=YOUR_SETUP_SECRET' });
  }

  try {
    const data = await gql(
      `mutation CreateMetaobjectDefinition($definition: MetaobjectDefinitionCreateInput!) {
         metaobjectDefinitionCreate(definition: $definition) {
           metaobjectDefinition {
             id
             type
             name
             fieldDefinitions { key name }
           }
           userErrors { field message code }
         }
       }`,
      {
        definition: {
          type: 'wishlist_entry',
          name: 'Wishlist Entry',
          displayNameKey: 'product_title',
          fieldDefinitions: [
            { key: 'phone',          name: 'Customer Phone',   type: 'single_line_text_field',  required: true  },
            { key: 'customer_name',  name: 'Customer Name',    type: 'single_line_text_field',  required: false },
            { key: 'product_id',     name: 'Product ID',       type: 'single_line_text_field',  required: true  },
            { key: 'product_title',  name: 'Product Title',    type: 'single_line_text_field',  required: false },
            { key: 'product_handle', name: 'Product Handle',   type: 'single_line_text_field',  required: false },
            { key: 'variant_id',     name: 'Variant ID',       type: 'single_line_text_field',  required: false },
            { key: 'product_image',  name: 'Product Image URL',type: 'single_line_text_field',  required: false },
            { key: 'product_price',  name: 'Product Price',    type: 'single_line_text_field',  required: false },
            { key: 'added_at',       name: 'Added At',         type: 'single_line_text_field',  required: false },
          ],
        },
      }
    );

    const result = data.metaobjectDefinitionCreate;
    if (result.userErrors.length) {
      // Code TAKEN means the type already exists — try to add the customer_name field
      const alreadyExists = result.userErrors.some(e => e.code === 'TAKEN');
      if (alreadyExists) {
        const updateMsg = await ensureCustomerNameField();
        return res.status(200).json({
          success: true,
          message: 'Metaobject definition already exists. ' + updateMsg,
        });
      }
      return res.status(400).json({ errors: result.userErrors });
    }

    return res.status(200).json({
      success: true,
      message: 'Metaobject definition created! Go to Shopify Admin → Content → Metaobjects to see it.',
      definition: result.metaobjectDefinition,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// ─── Ensure the customer_name field exists on an existing definition ──────────
async function ensureCustomerNameField() {
  // 1. Look up the existing definition
  const lookup = await gql(
    `query {
       metaobjectDefinitionByType(type: "wishlist_entry") {
         id
         fieldDefinitions { key name }
       }
     }`
  );

  const def = lookup.metaobjectDefinitionByType;
  if (!def) return 'Could not look up existing definition.';

  const hasName = def.fieldDefinitions.some(f => f.key === 'customer_name');
  if (hasName) return 'customer_name field already present. You are all set!';

  // 2. Add the customer_name field
  const update = await gql(
    `mutation AddCustomerName($id: ID!, $definition: MetaobjectDefinitionUpdateInput!) {
       metaobjectDefinitionUpdate(id: $id, definition: $definition) {
         metaobjectDefinition { id }
         userErrors { field message code }
       }
     }`,
    {
      id: def.id,
      definition: {
        fieldDefinitions: [
          {
            create: {
              key: 'customer_name',
              name: 'Customer Name',
              type: 'single_line_text_field',
              required: false,
            },
          },
        ],
      },
    }
  );

  const errs = update.metaobjectDefinitionUpdate.userErrors;
  if (errs.length) return 'Could not add customer_name field: ' + JSON.stringify(errs);
  return 'Added the new customer_name field successfully.';
};
