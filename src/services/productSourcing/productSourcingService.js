const productProviderFactory = require('../productProviderFactory');
const auditService = require('../audit/auditService');

class ProductSourcingService {
  /**
   * Fetch product data from external marketplace
   * This service is responsible ONLY for fetching and transforming data
   * No database operations or business logic
   */
  async fetchFromUrl(url, options = {}) {
    try {
      const { marketplace, defaultStockLevels } = options;

      // Get provider
      let provider;
      if (marketplace && marketplace !== 'auto-detect') {
        provider = productProviderFactory.getProvider(marketplace);
        if (!provider) {
          throw new Error(`Marketplace '${marketplace}' is not supported`);
        }
      } else {
        provider = productProviderFactory.getProviderByUrl(url);
        if (!provider) {
          const detectedMarketplace = productProviderFactory.detectMarketplace(url);
          throw new Error(`Marketplace '${detectedMarketplace}' is not supported`);
        }
      }

      // Validate URL
      if (!provider.validateUrl(url)) {
        throw new Error(`URL does not match expected format for ${provider.getMarketplaceName()}`);
      }

      // Fetch product data
      console.log(`Fetching product from ${provider.getMarketplaceName()}...`);
      const productData = await provider.fetchProduct(url, defaultStockLevels);

      return {
        success: true,
        marketplace: provider.getMarketplaceName(),
        data: productData
      };
    } catch (error) {
      console.error('Product sourcing error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Fetch product by ASIN (Amazon specific)
   */
  async fetchByAsin(asin, options = {}) {
    const provider = productProviderFactory.getProvider('amazon');
    if (!provider) {
      throw new Error('Amazon provider not available');
    }

    // Construct Amazon URL from ASIN
    const domain = options.domain || 'amazon.com';
    const url = `https://${domain}/dp/${asin}`;

    return this.fetchFromUrl(url, { ...options, marketplace: 'amazon' });
  }

  /**
   * Fetch product by Item ID (Walmart specific)
   */
  async fetchByItemId(itemId, options = {}) {
    const provider = productProviderFactory.getProvider('walmart');
    if (!provider) {
      throw new Error('Walmart provider not available');
    }

    // Construct Walmart URL from Item ID
    const url = `https://www.walmart.com/ip/${itemId}`;

    return this.fetchFromUrl(url, { ...options, marketplace: 'walmart' });
  }

  /**
   * Validate product URL
   */
  validateUrl(url) {
    const marketplace = productProviderFactory.detectMarketplace(url);
    if (marketplace === 'unknown') {
      return {
        valid: false,
        marketplace: null,
        error: 'Unsupported marketplace'
      };
    }

    const provider = productProviderFactory.getProvider(marketplace);
    if (!provider) {
      return {
        valid: false,
        marketplace,
        error: 'Provider not available for this marketplace'
      };
    }

    const isValid = provider.validateUrl(url);
    return {
      valid: isValid,
      marketplace,
      error: isValid ? null : 'Invalid URL format'
    };
  }

  /**
   * Get supported marketplaces
   */
  getSupportedMarketplaces() {
    return productProviderFactory.getSupportedMarketplaces();
  }

  /**
   * Extract product identifiers from URL
   */
  extractIdentifiers(url) {
    const marketplace = productProviderFactory.detectMarketplace(url);
    const identifiers = {};

    switch (marketplace) {
      case 'amazon':
        const asinMatch = url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
        if (asinMatch) {
          identifiers.asin = asinMatch[1];
        }
        break;
      case 'walmart':
        const itemIdMatch = url.match(/\/ip\/(?:[^\/]+\/)?(\d+)/);
        if (itemIdMatch) {
          identifiers.itemId = itemIdMatch[1];
        }
        break;
      case 'homedepot':
        const skuMatch = url.match(/\/p\/[^\/]+\/(\d+)/);
        if (skuMatch) {
          identifiers.sku = skuMatch[1];
        }
        break;
    }

    return {
      marketplace,
      identifiers
    };
  }

  /**
   * Compare two product data objects to find differences
   */
  compareProducts(oldData, newData) {
    const changes = {
      price: oldData.price !== newData.price,
      stock: oldData.stockLevel !== newData.stockLevel,
      availability: oldData.inStock !== newData.inStock,
      title: oldData.title !== newData.title,
      images: JSON.stringify(oldData.images) !== JSON.stringify(newData.images)
    };

    const differences = {};
    
    if (changes.price) {
      differences.price = {
        old: oldData.price,
        new: newData.price,
        difference: newData.price - oldData.price,
        percentChange: ((newData.price - oldData.price) / oldData.price * 100).toFixed(2)
      };
    }

    if (changes.stock) {
      differences.stock = {
        old: oldData.stockLevel,
        new: newData.stockLevel,
        difference: newData.stockLevel - oldData.stockLevel
      };
    }

    if (changes.availability) {
      differences.availability = {
        old: oldData.inStock,
        new: newData.inStock
      };
    }

    return {
      hasChanges: Object.values(changes).some(v => v),
      changes,
      differences
    };
  }
}

// Export singleton instance
module.exports = new ProductSourcingService();