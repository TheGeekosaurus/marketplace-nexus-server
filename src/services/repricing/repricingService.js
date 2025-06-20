const { createClient } = require('@supabase/supabase-js');
const auditService = require('../audit/auditService');

class RepricingService {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }

  /**
   * Calculate minimum resell price based on user settings
   * @param {number} sourceCost - Product cost (price + shipping)
   * @param {Object} settings - User pricing settings
   * @param {number} marketplaceFeePercentage - Custom marketplace fee percentage (or null for default)
   * @returns {number} Minimum resell price
   */
  calculateMinimumResellPrice(sourceCost, settings, marketplaceFeePercentage = null) {
    // Use custom marketplace fee or default to 15%
    const feePercentage = marketplaceFeePercentage || 15;
    const feeDecimal = feePercentage / 100;

    if (!settings || !settings.minimum_profit_type || !settings.minimum_profit_value) {
      // Use proper calculation: price = cost / (1 - fee_percentage)
      return Math.round((sourceCost / (1 - feeDecimal)) * 100) / 100;
    }

    let costPlusProfit = sourceCost;

    // Apply profit margin
    if (settings.minimum_profit_type === 'dollar') {
      costPlusProfit = sourceCost + settings.minimum_profit_value;
    } else if (settings.minimum_profit_type === 'percentage') {
      costPlusProfit = sourceCost * (1 + settings.minimum_profit_value / 100);
    }

    // Calculate final price using: price = (cost + profit) / (1 - fee_percentage)
    // This ensures: final_price - (final_price * fee_percentage) = cost + profit
    const minimumPrice = costPlusProfit / (1 - feeDecimal);

    return Math.round(minimumPrice * 100) / 100; // Round to 2 decimal places
  }

  /**
   * Check if a listing needs repricing
   * @param {Object} listing - Current listing data
   * @param {number} minimumPrice - Calculated minimum price
   * @returns {boolean} Whether repricing is needed
   */
  needsRepricing(listing, minimumPrice) {
    return listing.price < minimumPrice;
  }

  /**
   * Process repricing for a product's listings
   * @param {Object} params - Repricing parameters
   */
  async processProductRepricing({
    productId,
    userId,
    newSourcePrice,
    shippingCost = 0,
    settings
  }) {
    try {
      const totalCost = newSourcePrice + shippingCost;

      // Get all active listings for this product
      const { data: listings, error: listingsError } = await this.supabase
        .from('listings')
        .select(`
          id, 
          external_id, 
          sku, 
          price, 
          marketplace_id,
          marketplace_fee_percentage,
          minimum_resell_price,
          marketplaces!inner(name)
        `)
        .eq('product_id', productId)
        .eq('user_id', userId)
        .eq('status', 'active');

      if (listingsError) {
        throw listingsError;
      }

      const results = {
        processed: 0,
        updated: 0,
        failed: 0,
        errors: []
      };

      for (const listing of listings || []) {
        results.processed++;

        try {
          // Calculate minimum resell price for this specific listing using its marketplace fee
          const minimumResellPrice = this.calculateMinimumResellPrice(
            totalCost, 
            settings, 
            listing.marketplace_fee_percentage
          );

          // ALWAYS update minimum resell price in database when source costs change
          const currentMinPrice = listing.minimum_resell_price || 0;
          if (minimumResellPrice !== currentMinPrice) {
            await this.supabase
              .from('listings')
              .update({
                minimum_resell_price: minimumResellPrice,
                updated_at: new Date().toISOString()
              })
              .eq('id', listing.id);
          }

          // Check if automated repricing should update the marketplace price
          if (this.needsRepricing(listing, minimumResellPrice) && settings?.automated_repricing_enabled) {
            // Update price on marketplace
            const updateResult = await this.updateMarketplacePrice({
              listing,
              newPrice: minimumResellPrice,
              userId,
              marketplace: listing.marketplaces.name
            });

            if (updateResult.success) {
              // Update the actual price in database
              await this.supabase
                .from('listings')
                .update({
                  price: minimumResellPrice,
                  updated_at: new Date().toISOString()
                })
                .eq('id', listing.id);

              // Log successful repricing
              await auditService.logRepricing(
                listing.id,
                productId,
                userId,
                listing.price,
                minimumResellPrice,
                listing.marketplaces.name,
                'minimum_profit_threshold'
              );

              // Note: Informed.co updates now handled by daily sync only

              results.updated++;
            } else {
              results.failed++;
              results.errors.push({
                listingId: listing.id,
                error: updateResult.error
              });
            }
          }
        } catch (error) {
          results.failed++;
          results.errors.push({
            listingId: listing.id,
            error: error.message
          });

          // Log error
          await auditService.logPriceUpdateError(
            listing.id,
            productId,
            userId,
            minimumResellPrice,
            listing.marketplaces.name,
            error
          );
        }
      }

      return {
        success: true,
        minimumResellPrice,
        results
      };
    } catch (error) {
      console.error('Repricing service error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Update price on external marketplace
   * @param {Object} params - Update parameters
   */
  async updateMarketplacePrice({ listing, newPrice, userId, marketplace }) {
    try {
      // Get marketplace credentials
      const { data: credentials, error: credError } = await this.supabase
        .from('marketplace_credentials')
        .select('credentials')
        .eq('user_id', userId)
        .eq('marketplace_id', listing.marketplace_id)
        .single();

      if (credError || !credentials?.credentials) {
        throw new Error('Marketplace credentials not found');
      }

      // Route to appropriate marketplace handler
      switch (marketplace.toLowerCase()) {
        case 'walmart':
          return await this.updateWalmartPrice(listing, newPrice, credentials.credentials);
        case 'amazon':
          // Amazon price updates would go here
          throw new Error('Amazon price updates not yet implemented');
        case 'facebook':
          // Facebook price updates would go here
          throw new Error('Facebook price updates not yet implemented');
        default:
          throw new Error(`Unsupported marketplace: ${marketplace}`);
      }
    } catch (error) {
      console.error(`Price update error for ${marketplace}:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Update Walmart price
   * @private
   */
  async updateWalmartPrice(listing, newPrice, credentials) {
    const backendUrl = process.env.BACKEND_URL || 'https://marketplace-nexus-server.onrender.com';
    
    try {
      const response = await fetch(`${backendUrl}/api/walmart/update-price`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          credentials,
          sku: listing.external_id || listing.sku,
          price: newPrice
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to update Walmart price');
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Batch repricing for multiple products
   */
  async batchReprice(products, userId, settings) {
    const results = {
      total: products.length,
      processed: 0,
      updated: 0,
      failed: 0,
      errors: []
    };

    for (const product of products) {
      try {
        const repricingResult = await this.processProductRepricing({
          productId: product.id,
          userId,
          newSourcePrice: product.current_source_price,
          shippingCost: product.shipping_cost || 0,
          settings
        });

        if (repricingResult.success) {
          results.processed++;
          results.updated += repricingResult.results.updated;
          results.failed += repricingResult.results.failed;
        } else {
          results.failed++;
          results.errors.push({
            productId: product.id,
            error: repricingResult.error
          });
        }
      } catch (error) {
        results.failed++;
        results.errors.push({
          productId: product.id,
          error: error.message
        });
      }
    }

    // Log bulk operation
    await auditService.logBulkOperation(userId, 'repricing', results.processed, {
      updated: results.updated,
      failed: results.failed,
      total: results.total
    });

    return results;
  }
}

// Export singleton instance
module.exports = new RepricingService();