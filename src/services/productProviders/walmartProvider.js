const BaseProvider = require('./baseProvider');
const walmartService = require('../walmart.service');
const config = require('../../config');

class WalmartProvider extends BaseProvider {
  constructor() {
    super(null); // No API key needed, we use OAuth
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
   * Fetch product data from Walmart
   * @param {string} url - Walmart product URL
   * @param {object} credentials - User's Walmart API credentials
   * @returns {Promise<object>} - Standardized product data
   */
  async fetchProduct(url, credentials) {
    try {
      if (!credentials || !credentials.clientId || !credentials.clientSecret) {
        throw new Error('Walmart API credentials not provided');
      }

      const itemId = this.extractItemId(url);
      if (!itemId) {
        throw new Error('Could not extract item ID from Walmart URL');
      }

      console.log(`Fetching Walmart product with ID: ${itemId}`);

      // Get access token
      const tokenData = await walmartService.getAccessToken(
        credentials.clientId,
        credentials.clientSecret
      );

      // First try to get the item from seller's own inventory
      try {
        const itemData = await walmartService.getListingById(tokenData.accessToken, itemId);
        return this.transformResponse(itemData, itemId);
      } catch (error) {
        console.log('Item not in seller inventory, searching catalog...');
      }

      // If not in inventory, we need to use a different approach
      // Since we can't search by item ID directly in catalog search,
      // we'll return a simplified response that allows the user to create an offer
      // The user must have the UPC/GTIN from the Walmart product page
      
      console.log('Item not in seller inventory. Returning basic product info for offer creation.');
      
      // Extract basic info from the URL and return minimal data
      // The frontend will need to ensure the user provides UPC/GTIN
      return {
        title: 'Walmart Product',
        price: 0,
        images: [],
        description: 'Product from Walmart.com',
        availability: 'Available',
        shipping: 0,
        sku: itemId,
        brand: '',
        category: '',
        features: [],
        specifications: {},
        rating: null,
        reviewCount: 0,
        inStock: true,
        stockLevel: null,
        sourceData: {
          itemId: itemId,
          wpid: null,
          upc: null, // User will need to provide this
          gtin: null,
          requiresUPC: true,
          message: 'Please enter the UPC/GTIN from the Walmart product page to create an offer.'
        }
      };
    } catch (error) {
      console.error('Walmart provider error:', error.message);
      throw new Error(`Failed to fetch Walmart product: ${error.message}`);
    }
  }

  /**
   * Transform Walmart API response to standardized format
   * @param {object} data - Walmart API response
   * @param {string} itemId - Walmart item ID
   * @returns {object} - Standardized product data
   */
  transformResponse(data, itemId) {
    // Handle response from seller's inventory API
    const item = data.ItemResponse?.[0] || data;
    
    return {
      title: item.productName || item.name || 'Unknown Product',
      price: item.price?.amount || item.price || 0,
      images: this.extractImages(item),
      description: item.shortDescription || '',
      availability: item.fulfillment?.availability || 'Unknown',
      shipping: 0, // Walmart typically has calculated shipping
      sku: item.sku || itemId,
      brand: item.brand || '',
      category: item.category || '',
      features: [],
      specifications: {},
      rating: null,
      reviewCount: 0,
      inStock: item.publishedStatus === 'PUBLISHED',
      stockLevel: item.fulfillment?.quantity || null,
      sourceData: {
        itemId: itemId,
        wpid: item.wpid || null,
        upc: item.upc || item.productIdentifiers?.productId || null,
        gtin: item.gtin || null,
        publishedStatus: item.publishedStatus || null,
        lifecycleStatus: item.lifecycleStatus || null
      }
    };
  }

  /**
   * Transform Walmart catalog search response to standardized format
   * @param {object} catalogItem - Walmart catalog item
   * @param {string} itemId - Walmart item ID
   * @returns {object} - Standardized product data
   */
  transformCatalogResponse(catalogItem, itemId) {
    return {
      title: catalogItem.name || catalogItem.title || 'Unknown Product',
      price: catalogItem.salePrice || catalogItem.price || 0,
      images: catalogItem.images ? [catalogItem.images.mainImage] : [],
      description: catalogItem.description || catalogItem.shortDescription || '',
      availability: 'Available',
      shipping: 0,
      sku: catalogItem.itemId || itemId,
      brand: catalogItem.brand || '',
      category: catalogItem.category || '',
      features: catalogItem.features || [],
      specifications: {},
      rating: catalogItem.customerRating || null,
      reviewCount: catalogItem.numReviews || 0,
      inStock: true, // Catalog items are generally available
      stockLevel: null,
      sourceData: {
        itemId: catalogItem.itemId || itemId,
        wpid: catalogItem.wpid || null,
        upc: catalogItem.upc || null,
        gtin: catalogItem.gtin || null,
        model: catalogItem.modelNumber || null
      }
    };
  }

  /**
   * Extract images from Walmart item data
   * @param {object} item - Walmart item data
   * @returns {array} - Array of image URLs
   */
  extractImages(item) {
    const images = [];
    
    // Primary image
    if (item.images?.mainImage) {
      images.push(item.images.mainImage);
    }
    
    // Additional images
    if (item.images?.additionalImages) {
      images.push(...item.images.additionalImages);
    }
    
    // Alternative image format
    if (item.imageInfo?.allImages) {
      item.imageInfo.allImages.forEach(img => {
        if (img.url) images.push(img.url);
      });
    }

    return images;
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

module.exports = WalmartProvider;