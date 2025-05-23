const axios = require('axios');
const BaseProvider = require('./baseProvider');

class RainforestProvider extends BaseProvider {
  constructor(apiKey) {
    super(apiKey);
    this.baseUrl = 'https://api.rainforestapi.com/request';
  }

  async fetchProduct(url) {
    try {
      console.log(`Fetching Amazon product from URL: ${url}`);
      
      // Extract ASIN from URL if available
      const asinMatch = url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
      const asin = asinMatch ? asinMatch[1] : null;
      
      const params = {
        api_key: this.apiKey,
        type: 'product'
      };
      
      // Determine Amazon domain from URL
      const domain = this.extractAmazonDomain(url);
      if (domain) {
        params.amazon_domain = domain;
      } else {
        params.amazon_domain = 'amazon.com'; // Default to US
      }
      
      // Use ASIN if extracted, otherwise use URL
      if (asin) {
        params.asin = asin;
      } else {
        params.url = url;
      }
      
      // Add optional parameters for comprehensive data
      params.include_summarization_attributes = true;
      params.include_a_plus_body = true;
      
      console.log('Rainforest API request params:', params);
      
      const response = await axios.get(this.baseUrl, {
        params,
        timeout: 30000 // 30 second timeout
      });

      if (!response.data || !response.data.product) {
        throw new Error('Invalid response from Rainforest API');
      }

      // Optionally fetch stock estimation for better inventory data
      let stockData = null;
      if (asin && this.shouldFetchStockEstimation()) {
        try {
          stockData = await this.fetchStockEstimation(asin, domain || 'amazon.com');
        } catch (stockError) {
          console.warn('Stock estimation failed:', stockError.message);
          // Continue without stock data
        }
      }

      return this.transformResponse(response.data, stockData);
    } catch (error) {
      console.error('Rainforest API error:', error.message);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', error.response.data);
      }
      throw new Error(`Failed to fetch Amazon product: ${error.message}`);
    }
  }

  async fetchStockEstimation(asin, amazonDomain) {
    try {
      const response = await axios.get(this.baseUrl, {
        params: {
          api_key: this.apiKey,
          type: 'stock_estimation',
          asin: asin,
          amazon_domain: amazonDomain
        },
        timeout: 15000 // 15 second timeout for stock check
      });

      return response.data;
    } catch (error) {
      throw new Error(`Stock estimation failed: ${error.message}`);
    }
  }

  transformResponse(data, stockData = null) {
    const product = data.product;
    
    // Extract main image and additional images
    const images = [];
    if (product.main_image?.link) {
      images.push(product.main_image.link);
    }
    if (product.images && Array.isArray(product.images)) {
      product.images.forEach(img => {
        if (img.link && !images.includes(img.link)) {
          images.push(img.link);
        }
      });
    }
    // Also check for variant images
    if (product.images_flat) {
      product.images_flat.forEach(imgUrl => {
        if (imgUrl && !images.includes(imgUrl)) {
          images.push(imgUrl);
        }
      });
    }

    // Extract features from feature_bullets
    const features = product.feature_bullets || [];

    // Build specifications from attributes and specifications
    const specifications = {};
    if (product.attributes && Array.isArray(product.attributes)) {
      product.attributes.forEach(attr => {
        if (attr.name && attr.value) {
          specifications[attr.name] = attr.value;
        }
      });
    }
    if (product.specifications && Array.isArray(product.specifications)) {
      product.specifications.forEach(spec => {
        if (spec.name && spec.value) {
          specifications[spec.name] = spec.value;
        }
      });
    }

    // Extract price information
    const buyboxWinner = product.buybox_winner || {};
    const price = buyboxWinner.price?.value || 
                  product.buybox_winner?.price?.value ||
                  0;

    // Determine stock status
    let inStock = false;
    let stockLevel = null;
    
    if (stockData && stockData.stock_estimation) {
      inStock = stockData.stock_estimation.in_stock || false;
      stockLevel = stockData.stock_estimation.stock_level || null;
    } else if (buyboxWinner.availability) {
      inStock = buyboxWinner.availability.type === 'in_stock';
      // Try to extract stock level from availability message
      const stockMatch = buyboxWinner.availability.raw?.match(/Only (\d+) left in stock/);
      if (stockMatch) {
        stockLevel = parseInt(stockMatch[1]);
      }
    }

    // Extract shipping cost (0 for Prime eligible items)
    const isPrime = buyboxWinner.is_prime || buyboxWinner.fulfillment?.is_prime || false;
    const shipping = isPrime ? 0 : (buyboxWinner.shipping?.value || 5.99);

    return {
      title: product.title || 'Unknown Product',
      price: price,
      images: images,
      description: product.description || features.join(' ') || '',
      availability: buyboxWinner.availability?.raw || 'Unknown',
      shipping: shipping,
      sku: product.asin || '',
      brand: product.brand || '',
      category: product.categories_flat || '',
      features: features,
      specifications: specifications,
      rating: product.rating || null,
      reviewCount: product.ratings_total || 0,
      inStock: inStock,
      stockLevel: stockLevel,
      sourceType: 'Amazon',
      sourceData: {
        asin: product.asin,
        amazonChoice: product.amazon_choice || false,
        bestSeller: product.bestsellers_rank ? true : false,
        bestSellerRank: product.bestsellers_rank || null,
        prime: isPrime,
        fba: buyboxWinner.fulfillment?.type === 'Amazon' || false,
        soldBy: buyboxWinner.fulfillment?.name || 'Unknown',
        variations: product.variations || [],
        variantAsins: product.variant_asins_flat || [],
        parentAsin: product.parent_asin || null,
        reviewSummary: product.top_positive_review?.body || null,
        aPlus: product.a_plus_content?.has_a_plus_content || false,
        coupon: product.coupon_text || null,
        dimensions: product.dimensions || null,
        weight: product.weight || null,
        firstAvailable: product.first_available?.raw || null
      }
    };
  }

  extractAmazonDomain(url) {
    const domainMatch = url.match(/amazon\.([a-z.]+)/i);
    if (!domainMatch) return null;
    
    const domainSuffix = domainMatch[1];
    // Map common Amazon domains
    const domainMap = {
      'com': 'amazon.com',
      'co.uk': 'amazon.co.uk',
      'de': 'amazon.de',
      'fr': 'amazon.fr',
      'es': 'amazon.es',
      'it': 'amazon.it',
      'ca': 'amazon.ca',
      'co.jp': 'amazon.co.jp',
      'in': 'amazon.in',
      'com.mx': 'amazon.com.mx',
      'com.br': 'amazon.com.br',
      'com.au': 'amazon.com.au'
    };
    
    return domainMap[domainSuffix] || 'amazon.com';
  }

  shouldFetchStockEstimation() {
    // You can make this configurable via environment variable
    return process.env.RAINFOREST_FETCH_STOCK === 'true';
  }

  validateUrl(url) {
    return url.includes('amazon.') || url.includes('amzn.');
  }

  getMarketplaceName() {
    return 'Amazon';
  }
}

module.exports = RainforestProvider;