const axios = require('axios');
const BaseProvider = require('./baseProvider');

class BluecartProvider extends BaseProvider {
  constructor(apiKey) {
    super(apiKey);
    this.baseUrl = 'https://api.bluecartapi.com/request';
  }

  /**
   * Extract item ID from Walmart URL
   * @param {string} url - Walmart product URL
   * @returns {string|null} - Item ID or null
   */
  extractItemId(url) {
    // Handle different Walmart URL formats:
    // https://www.walmart.com/ip/Product-Name/123456789
    // https://www.walmart.com/ip/123456789
    const match = url.match(/\/ip\/(?:[^\/]+\/)?(\d+)/);
    return match ? match[1] : null;
  }

  /**
   * Fetch product data from BlueCart API
   * @param {string} url - Walmart product URL
   * @returns {Promise<object>} - Standardized product data
   */
  async fetchProduct(url, defaultStockLevels) {
    try {
      console.log(`Fetching Walmart product via BlueCart: ${url}`);
      
      const itemId = this.extractItemId(url);
      
      const params = {
        api_key: this.apiKey,
        type: 'product'
      };

      // Prefer URL over item_id as per BlueCart docs
      if (url && url.includes('walmart.com')) {
        params.url = url;
      } else if (itemId) {
        params.item_id = itemId;
      } else {
        throw new Error('Could not extract valid Walmart URL or item ID');
      }

      const response = await axios({
        method: 'get',
        url: this.baseUrl,
        params: params,
        timeout: 30000 // 30 second timeout
      });

      if (!response.data || !response.data.product) {
        throw new Error('Invalid response from BlueCart API');
      }

      return this.transformResponse(response.data, defaultStockLevels);
    } catch (error) {
      console.error('BlueCart API error:', error.message);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', error.response.data);
      }
      throw new Error(`Failed to fetch Walmart product: ${error.message}`);
    }
  }

  /**
   * Transform BlueCart API response to standardized format
   * @param {object} data - BlueCart API response
   * @returns {object} - Standardized product data
   */
  transformResponse(data, defaultStockLevels) {
    const product = data.product; // BlueCart returns product object like other providers
    
    // Extract price from buybox_winner
    const buyboxWinner = product.buybox_winner || {};
    const price = buyboxWinner.price || product.price || 0;
    
    // Extract availability
    const availability = buyboxWinner.availability || {};
    const inStock = availability.in_stock !== undefined ? availability.in_stock : true;
    const defaultStock = defaultStockLevels?.walmart || 10;
    
    // Extract images
    const images = [];
    if (product.main_image && product.main_image.link) {
      images.push(product.main_image.link);
    }
    if (product.images && Array.isArray(product.images)) {
      product.images.forEach(img => {
        if (img.link) {
          images.push(img.link);
        }
      });
    }
    
    return {
      title: product.title || 'Unknown Product',
      price: price,
      images: images,
      description: product.description || '',
      availability: availability.raw || 'Unknown',
      shipping: 0, // BlueCart doesn't provide shipping cost directly
      sku: product.item_id || '',
      brand: product.brand || '',
      category: product.category || '',
      features: product.features || [],
      specifications: product.specifications || {},
      rating: product.rating || null,
      reviewCount: product.ratings_total || 0,
      inStock: inStock,
      stockLevel: inStock ? defaultStock : 0, // Use default stock level when in stock
      sourceData: {
        itemId: product.item_id,
        upc: product.upc || null, // CRITICAL: This is what we need!
        gtin: product.gtin || product.upc || null,
        model: product.model || null,
        wpid: product.wpid || null,
        buyboxWinner: buyboxWinner,
        availabilityStatus: availability.raw || null
      }
    };
  }

  /**
   * Validate if URL is a Walmart URL
   * @param {string} url - URL to validate
   * @returns {boolean} - Whether URL is valid
   */
  validateUrl(url) {
    return url.includes('walmart.com');
  }

  /**
   * Get marketplace name
   * @returns {string} - Marketplace name
   */
  getMarketplaceName() {
    return 'Walmart';
  }
}

module.exports = BluecartProvider;