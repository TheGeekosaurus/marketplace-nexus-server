const axios = require('axios');
const BaseProvider = require('./baseProvider');

class BigBoxProvider extends BaseProvider {
  constructor(apiKey) {
    super(apiKey);
    this.baseUrl = 'https://api.bigboxapi.com/request';
  }

  async fetchProduct(url) {
    try {
      console.log(`Fetching Home Depot product from URL: ${url}`);
      
      const response = await axios.get(this.baseUrl, {
        params: {
          api_key: this.apiKey,
          type: 'product',
          url: url
        },
        timeout: 30000 // 30 second timeout
      });

      if (!response.data || !response.data.product) {
        throw new Error('Invalid response from BigBox API');
      }

      return this.transformResponse(response.data);
    } catch (error) {
      console.error('BigBox API error:', error.message);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', error.response.data);
      }
      throw new Error(`Failed to fetch Home Depot product: ${error.message}`);
    }
  }

  transformResponse(data) {
    const product = data.product;
    const buyboxWinner = product.buybox_winner || {};
    
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

    // Calculate shipping cost
    let shipping = 0;
    if (buyboxWinner.ships_from === 'FREE') {
      shipping = 0;
    } else if (buyboxWinner.shipping && buyboxWinner.shipping !== 'FREE') {
      // Try to parse shipping cost if it's a string like "$5.99"
      const shippingMatch = buyboxWinner.shipping.match(/\$?([\d.]+)/);
      shipping = shippingMatch ? parseFloat(shippingMatch[1]) : 5.99;
    } else if (!buyboxWinner.free_shipping) {
      shipping = 5.99; // Default shipping cost
    }

    // Build features array
    const features = [];
    if (product.feature_bullets) {
      features.push(...product.feature_bullets);
    }

    return {
      title: product.title || 'Unknown Product',
      price: buyboxWinner.price || 0,
      images: images,
      description: product.description || features.join(' ') || '',
      availability: buyboxWinner.availability?.raw || 'Unknown',
      shipping: shipping,
      sku: product.model || product.item_id || '',
      brand: product.brand || '',
      category: product.category || '',
      features: features,
      specifications: product.specifications || {},
      rating: product.rating || null,
      reviewCount: product.reviews_total || 0,
      sourceData: {
        itemId: product.item_id,
        model: product.model,
        upc: product.upc,
        storePickup: buyboxWinner.store_pickup || false,
        shipToHome: buyboxWinner.ship_to_home || false,
        onlineOnly: product.online_only || false
      }
    };
  }

  validateUrl(url) {
    return url.includes('homedepot.com');
  }

  getMarketplaceName() {
    return 'Home Depot';
  }
}

module.exports = BigBoxProvider;