// ==========================================
// Product Scraper — JSON-LD + __NEXT_DATA__ + OG fallback
// Works with any product URL; best results for Nike.
// ==========================================

/**
 * Fetch and parse a product page.
 * Tries JSON-LD, __NEXT_DATA__ (Nike-optimized), then OG meta tags.
 * Returns product info or throws on failure.
 */
export async function fetchProduct(url, options = {}) {
  // Validate URL
  if (!url || typeof url !== 'string') {
    throw new Error('Please enter a valid URL');
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid URL format');
  }

  if (!parsed.protocol.startsWith('http')) {
    throw new Error('URL must use http or https');
  }

  // Fetch via proxy
  const proxyUrl = `/api/fetch?url=${encodeURIComponent(url)}`;
  let response;
  try {
    response = await fetch(proxyUrl, { signal: options.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error('Network error — could not reach the proxy');
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Product not found — check the URL or try another');
    }
    throw new Error(`Failed to fetch product page (HTTP ${response.status})`);
  }

  const html = await response.text();
  const isNike = parsed.hostname.endsWith('nike.com');

  // Strategy 1: __NEXT_DATA__ (best for Nike and other Next.js sites)
  if (isNike) {
    const nextData = extractNextData(html);
    if (nextData) {
      try {
        return parseNikeNextData(nextData, url);
      } catch {
        // Fall through to other strategies
      }
    }
  }

  // Strategy 2: JSON-LD structured data (works for most e-commerce sites)
  const jsonLd = extractJsonLd(html);
  if (jsonLd) {
    return parseJsonLd(jsonLd, url);
  }

  // Strategy 3: __NEXT_DATA__ generic (non-Nike Next.js sites)
  if (!isNike) {
    const nextData = extractNextData(html);
    if (nextData) {
      const result = parseGenericNextData(nextData, url);
      if (result) return result;
    }
  }

  // Strategy 4: OG meta tags (final fallback)
  const ogData = extractOgTags(html, url);
  if (ogData.name) {
    return ogData;
  }

  throw new Error('Could not extract product data from this page');
}

// ==========================================
// JSON-LD Extraction (most universal)
// ==========================================

/**
 * Find the first Product JSON-LD block in the page.
 */
function extractJsonLd(html) {
  const regex = /<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      // Could be a single object or an array
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item['@type'] === 'Product') return item;
        // Some sites nest Product inside @graph
        if (item['@graph']) {
          const product = item['@graph'].find((g) => g['@type'] === 'Product');
          if (product) return product;
        }
      }
    } catch {
      // Invalid JSON, try next block
    }
  }
  return null;
}

/**
 * Parse a schema.org Product JSON-LD object into our normalized format.
 */
function parseJsonLd(product, url) {
  const name = product.name || 'Unknown Product';

  // Brand
  let brand = '';
  if (typeof product.brand === 'string') {
    brand = product.brand;
  } else if (product.brand?.name) {
    brand = product.brand.name;
  }

  // Category
  const category = product.category || '';

  // Price — from offers
  let price = null;
  let currency = 'USD';
  const offers = product.offers;
  if (offers) {
    const offer = Array.isArray(offers) ? offers[0] : offers;
    price = parseFloat(offer.price || offer.lowPrice) || null;
    currency = offer.priceCurrency || 'USD';
  }

  // Image
  let image = null;
  if (typeof product.image === 'string') {
    image = product.image;
  } else if (Array.isArray(product.image)) {
    image = typeof product.image[0] === 'string' ? product.image[0] : product.image[0]?.url || null;
  } else if (product.image?.url) {
    image = product.image.url;
  }

  // Description
  const rawDesc = product.description || '';
  const description = rawDesc.replace(/<[^>]*>/g, '').trim();

  // Color — sometimes in additionalProperty or color field
  let colorDescription = '';
  if (product.color) {
    colorDescription = product.color;
  } else if (product.additionalProperty) {
    const colorProp = product.additionalProperty.find(
      (p) => p.name?.toLowerCase() === 'color' || p.name?.toLowerCase() === 'colorway'
    );
    if (colorProp) colorDescription = colorProp.value || '';
  }

  // SKU / style code
  const styleColor = product.sku || product.mpn || product.productID || '';

  // Availability
  const availability = offers?.availability || '';
  const isAvailable = !availability.includes('OutOfStock');

  return {
    name,
    subtitle: '',
    fullTitle: name,
    description,
    brand,
    category,
    price,
    currency,
    image,
    colorDescription,
    styleColor,
    productType: category,
    isAvailable,
    url,
  };
}

// ==========================================
// __NEXT_DATA__ Extraction (Nike-optimized)
// ==========================================

/**
 * Extract the __NEXT_DATA__ JSON blob from the page.
 */
function extractNextData(html) {
  const match = html.match(
    /<script\s+id="__NEXT_DATA__"\s+type="application\/json"[^>]*>([\s\S]*?)<\/script>/
  );
  if (!match) return null;

  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

/**
 * Parse product info from Nike's __NEXT_DATA__ structure.
 */
function parseNikeNextData(data, url) {
  const props = data?.props?.pageProps;

  const product =
    props?.selectedProduct ||
    props?.product ||
    props?.initialState?.product?.selectedProduct;

  if (!product) {
    const state = props?.initialState;
    if (state?.product) {
      const products = state.product;
      const firstKey = Object.keys(products).find(
        (k) => k !== 'selectedProduct' && typeof products[k] === 'object' && products[k]?.title
      );
      if (firstKey) {
        return extractFromNikeProduct(products[firstKey], url);
      }
    }
    throw new Error('Product data not found in Nike page structure');
  }

  return extractFromNikeProduct(product, url);
}

/**
 * Extract normalized fields from a Nike selectedProduct object.
 */
function extractFromNikeProduct(product, url) {
  const info = product.productInfo || {};
  const title = info.title || product.title || product.name || 'Unknown Product';
  const subtitle = info.subtitle || product.subtitle || '';
  const fullTitle = info.fullTitle || (subtitle ? `${title} ${subtitle}` : title);

  const brand =
    (Array.isArray(product.brands) ? product.brands[0] : product.brand) || 'Nike';

  const category = product.productType || 'Footwear';

  const prices = product.prices || {};
  const price = prices.currentPrice ?? prices.initialPrice ?? null;
  const currency = prices.currency || 'USD';

  let heroImage = null;
  const contentImages = product.contentImages || [];
  if (contentImages.length > 0) {
    const first = contentImages[0];
    heroImage =
      first?.properties?.squarish?.url ||
      first?.properties?.portrait?.url ||
      first?.url ||
      null;
  }

  const colorDescription = product.colorDescription || '';
  const styleColor = product.styleColor || '';

  const rawDesc = info.productDescription || info.description || product.description || '';
  const description = rawDesc.replace(/<[^>]*>/g, '').trim();

  return {
    name: title,
    subtitle,
    fullTitle,
    description,
    brand,
    category,
    price,
    currency,
    image: heroImage,
    colorDescription,
    styleColor,
    productType: product.productType || '',
    isAvailable: true,
    url,
  };
}

// ==========================================
// Generic __NEXT_DATA__ (non-Nike Next.js)
// ==========================================

/**
 * Try to find product-like data in a generic __NEXT_DATA__ blob.
 * Walks the pageProps tree looking for objects with name/title + price.
 */
function parseGenericNextData(data, url) {
  const props = data?.props?.pageProps;
  if (!props) return null;

  // Look for a "product" key at the top level of pageProps
  const candidate = props.product || props.item || props.productData || props.data?.product;
  if (candidate && (candidate.name || candidate.title)) {
    return normalizeGenericProduct(candidate, url);
  }

  // Shallow search: find any object with name + price-like fields
  for (const key of Object.keys(props)) {
    const val = props[key];
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      if ((val.name || val.title) && (val.price !== undefined || val.offers || val.prices)) {
        return normalizeGenericProduct(val, url);
      }
    }
  }

  return null;
}

function normalizeGenericProduct(obj, url) {
  const name = obj.name || obj.title || 'Unknown Product';
  const brand = obj.brand?.name || obj.brand || '';
  const price = typeof obj.price === 'number'
    ? obj.price
    : parseFloat(obj.price || obj.prices?.current || obj.prices?.sale || obj.offers?.price) || null;
  const currency = obj.currency || obj.prices?.currency || 'USD';
  const image = typeof obj.image === 'string' ? obj.image : (obj.image?.[0] || obj.images?.[0]?.url || obj.images?.[0] || null);
  const description = (obj.description || '').replace(/<[^>]*>/g, '').trim();

  return {
    name,
    subtitle: obj.subtitle || '',
    fullTitle: name,
    description,
    brand,
    category: obj.category || obj.productType || '',
    price,
    currency,
    image,
    colorDescription: obj.color || obj.colorDescription || '',
    styleColor: obj.sku || obj.styleCode || '',
    productType: obj.productType || obj.category || '',
    isAvailable: obj.inStock !== false && obj.availability !== 'OutOfStock',
    url,
  };
}

// ==========================================
// OG Meta Tags (final fallback)
// ==========================================

/**
 * Extract product info from Open Graph and standard meta tags.
 */
function extractOgTags(html, url) {
  const get = (property) => {
    const match = html.match(
      new RegExp(`<meta\\s+property=["']${property}["']\\s+content=["']([^"']*)["']`, 'i')
    ) ||
    html.match(
      new RegExp(`<meta\\s+content=["']([^"']*)["']\\s+property=["']${property}["']`, 'i')
    );
    return match ? match[1] : '';
  };

  // Also try <meta name="..."> (some sites use name instead of property)
  const getName = (name) => {
    const match = html.match(
      new RegExp(`<meta\\s+name=["']${name}["']\\s+content=["']([^"']*)["']`, 'i')
    ) ||
    html.match(
      new RegExp(`<meta\\s+content=["']([^"']*)["']\\s+name=["']${name}["']`, 'i')
    );
    return match ? match[1] : '';
  };

  const name = get('og:title') || getName('title');
  const image = get('og:image');
  const description = get('og:description') || getName('description');
  const siteName = get('og:site_name');
  const priceStr = get('product:price:amount') || get('og:price:amount');
  const currency = get('product:price:currency') || get('og:price:currency') || 'USD';
  const brand = get('product:brand') || siteName || '';

  return {
    name: name || '',
    subtitle: '',
    fullTitle: name || '',
    description: description || '',
    brand,
    category: get('product:category') || '',
    price: priceStr ? parseFloat(priceStr) : null,
    currency,
    image: image || null,
    colorDescription: get('product:color') || '',
    styleColor: '',
    productType: '',
    isAvailable: true,
    url: url || '',
  };
}
