const BigBoxProvider = require('./productProviders/bigBoxProvider');
const RainforestProvider = require('./productProviders/rainforestProvider');

class ProductProviderFactory {
  constructor() {
    this.providers = new Map();
    this.initializeProviders();
  }

  initializeProviders() {
    // Initialize BigBox provider for Home Depot
    if (process.env.BIGBOX_API_KEY) {
      this.providers.set('homedepot', new BigBoxProvider(process.env.BIGBOX_API_KEY));
    }

    // Initialize Rainforest provider for Amazon
    if (process.env.RAINFOREST_API_KEY) {
      this.providers.set('amazon', new RainforestProvider(process.env.RAINFOREST_API_KEY));
    }

    // Future providers will be added here:
    // if (process.env.BLUECART_API_KEY) {
    //   this.providers.set('walmart', new BlueCartProvider(process.env.BLUECART_API_KEY));
    // }
  }

  /**
   * Detect marketplace from URL
   * @param {string} url - The product URL
   * @returns {string} marketplace identifier
   */
  detectMarketplace(url) {
    if (!url || typeof url !== 'string') {
      return 'unknown';
    }

    const urlLower = url.toLowerCase();
    
    if (urlLower.includes('homedepot.com')) return 'homedepot';
    if (urlLower.includes('amazon.com')) return 'amazon';
    if (urlLower.includes('walmart.com')) return 'walmart';
    if (urlLower.includes('lowes.com')) return 'lowes';
    
    return 'unknown';
  }

  /**
   * Get provider for a specific marketplace
   * @param {string} marketplace - The marketplace identifier
   * @returns {BaseProvider|null} The provider instance or null
   */
  getProvider(marketplace) {
    return this.providers.get(marketplace) || null;
  }

  /**
   * Get provider by URL (auto-detect marketplace)
   * @param {string} url - The product URL
   * @returns {BaseProvider|null} The provider instance or null
   */
  getProviderByUrl(url) {
    const marketplace = this.detectMarketplace(url);
    return this.getProvider(marketplace);
  }

  /**
   * Check if marketplace is supported
   * @param {string} marketplace - The marketplace identifier
   * @returns {boolean}
   */
  isSupported(marketplace) {
    return this.providers.has(marketplace);
  }

  /**
   * Get list of supported marketplaces
   * @returns {string[]}
   */
  getSupportedMarketplaces() {
    return Array.from(this.providers.keys());
  }
}

// Export singleton instance
module.exports = new ProductProviderFactory();