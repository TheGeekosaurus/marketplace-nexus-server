class BaseProvider {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  /**
   * Fetch product data from the marketplace
   * @param {string} url - The product URL
   * @returns {Promise<Object>} Standardized product data
   */
  async fetchProduct(url, defaultStockLevels) {
    throw new Error('fetchProduct method must be implemented by subclass');
  }

  /**
   * Transform marketplace-specific response to standard format
   * @param {Object} data - Raw API response
   * @returns {Object} Standardized product data
   */
  transformResponse(data) {
    throw new Error('transformResponse method must be implemented by subclass');
  }

  /**
   * Validate if URL belongs to this marketplace
   * @param {string} url - The product URL
   * @returns {boolean}
   */
  validateUrl(url) {
    throw new Error('validateUrl method must be implemented by subclass');
  }

  /**
   * Get marketplace name
   * @returns {string}
   */
  getMarketplaceName() {
    throw new Error('getMarketplaceName method must be implemented by subclass');
  }
}

module.exports = BaseProvider;