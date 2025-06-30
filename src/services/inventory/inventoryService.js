const { createClient } = require('@supabase/supabase-js');
const auditService = require('../audit/auditService');
const walmartService = require('../walmart.service');
const amazonService = require('../amazonService');

class InventoryService {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    this.walmartService = walmartService;
    this.amazonService = amazonService;
  }

  /**
   * Sync inventory levels for all listings of a product
   * @param {Object} params - Sync parameters
   */
  async syncProductInventory({
    productId,
    userId,
    newStockLevel,
    isInStock,
    settings
  }) {
    try {
      if (!settings?.automated_inventory_sync_enabled) {
        return {
          success: true,
          message: 'Automated inventory sync is disabled',
          results: { processed: 0, updated: 0, failed: 0 }
        };
      }

      // Get all active listings for this product
      const { data: listings, error: listingsError } = await this.supabase
        .from('listings')
        .select(`
          id, 
          external_id, 
          sku, 
          current_stock_level, 
          marketplace_id,
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

      // Get user's default stock levels
      const { data: userSettings } = await this.supabase
        .from('user_settings')
        .select('default_stock_levels')
        .eq('user_id', userId)
        .single();

      for (const listing of listings || []) {
        results.processed++;

        try {
          let targetInventory = Number(newStockLevel) || 0;

          // Handle marketplace-specific stock logic
          if (listing.marketplaces.name === 'Amazon' && isInStock) {
            // For Amazon, use default stock level when source shows in stock
            const amazonDefaultStock = userSettings?.default_stock_levels?.amazon || 10;
            targetInventory = amazonDefaultStock;
          }

          // Only update if inventory changed significantly
          if (Math.abs(listing.current_stock_level - targetInventory) >= 1) {
            const updateResult = await this.updateMarketplaceInventory({
              listing,
              newQuantity: targetInventory,
              userId,
              marketplace: listing.marketplaces.name
            });

            if (updateResult.success) {
              // Update listing in database
              await this.supabase
                .from('listings')
                .update({
                  current_stock_level: targetInventory,
                  is_available: targetInventory > 0,
                  updated_at: new Date().toISOString()
                })
                .eq('id', listing.id);

              // Log successful sync
              await auditService.logInventorySync(
                listing.id,
                productId,
                userId,
                listing.current_stock_level,
                targetInventory,
                listing.marketplaces.name,
                'source_stock_changed',
                newStockLevel
              );

              results.updated++;
            } else {
              results.failed++;
              results.errors.push({
                listingId: listing.id,
                error: updateResult.error
              });

              // Log error
              await auditService.logInventoryUpdateError(
                listing.id,
                productId,
                userId,
                targetInventory,
                listing.marketplaces.name,
                updateResult.error
              );
            }
          }
        } catch (error) {
          results.failed++;
          results.errors.push({
            listingId: listing.id,
            error: error.message
          });
        }
      }

      return {
        success: true,
        results
      };
    } catch (error) {
      console.error('Inventory sync service error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Update inventory on external marketplace
   * @param {Object} params - Update parameters
   */
  async updateMarketplaceInventory({ listing, newQuantity, userId, marketplace }) {
    try {
      // Get marketplace credentials
      const { data: credentials, error: credError } = await this.supabase
        .from('marketplace_credentials')
        .select('credentials')
        .eq('user_id', userId)
        .eq('marketplace_id', listing.marketplace_id)
        .single();

      if (credError || !credentials?.credentials) {
        return {
          success: false,
          error: 'No marketplace credentials found'
        };
      }

      let result;

      switch (marketplace) {
        case 'Walmart':
          result = await this.walmartService.updateInventory({
            credentials: credentials.credentials,
            sku: listing.external_id || listing.sku,
            quantity: newQuantity
          });
          break;

        case 'Amazon':
          result = await this.amazonService.updateInventory(
            credentials.credentials.refreshToken,
            credentials.credentials.sellerId,
            listing.sku,
            newQuantity,
            'PRODUCT'
          );
          break;

        default:
          return {
            success: false,
            error: `Unsupported marketplace: ${marketplace}`
          };
      }

      return result;
    } catch (error) {
      console.error(`Error updating ${marketplace} inventory:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Batch update inventory for multiple products
   */
  async batchSyncInventory(products, userId, settings) {
    const results = {
      total: products.length,
      processed: 0,
      updated: 0,
      failed: 0,
      errors: []
    };

    for (const product of products) {
      try {
        const syncResult = await this.syncProductInventory({
          productId: product.id,
          userId,
          newStockLevel: product.current_stock_level,
          isInStock: product.is_in_stock,
          settings
        });

        results.processed++;
        if (syncResult.success) {
          results.updated += syncResult.results.updated;
          results.failed += syncResult.results.failed;
        } else {
          results.failed++;
          results.errors.push({
            productId: product.id,
            error: syncResult.error
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

    return results;
  }
}

module.exports = new InventoryService();