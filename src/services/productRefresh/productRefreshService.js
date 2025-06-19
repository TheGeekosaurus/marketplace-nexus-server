const { createClient } = require('@supabase/supabase-js');
const productProviderFactory = require('../productProviderFactory');
const auditService = require('../audit/auditService');

class ProductRefreshService {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }

  /**
   * Get users who need product refresh
   */
  async getUsersNeedingRefresh() {
    const { data: users, error } = await this.supabase
      .from('profiles')
      .select('id, product_refresh_interval, last_product_refresh')
      .or('last_product_refresh.is.null,last_product_refresh.lt.now() - product_refresh_interval * interval \'1 hour\'');

    if (error) {
      throw error;
    }

    return users || [];
  }

  /**
   * Get products that need refresh for a user
   */
  async getProductsToRefresh(userId, refreshInterval = 24) {
    const { data: products, error } = await this.supabase
      .from('products')
      .select('*')
      .eq('user_id', userId)
      .or(`last_checked_at.is.null,last_checked_at.lt.now() - ${refreshInterval} * interval '1 hour'`)
      .not('source_url', 'is', null);

    if (error) {
      throw error;
    }

    return products || [];
  }

  /**
   * Refresh a single product
   */
  async refreshProduct(product, defaultStockLevels = {}) {
    try {
      // Get provider based on source URL (auto-detect marketplace)
      const provider = productProviderFactory.getProviderByUrl(product.source_url);
      if (!provider) {
        const detectedMarketplace = productProviderFactory.detectMarketplace(product.source_url);
        throw new Error(`Unsupported marketplace: ${detectedMarketplace} (detected from ${product.source_url})`);
      }

      // Fetch latest data
      console.log(`Refreshing product ${product.id} from ${product.source_type}`);
      const latestData = await provider.fetchProduct(product.source_url, defaultStockLevels);

      if (!latestData) {
        throw new Error('Unable to fetch latest product data');
      }

      // Prepare update data
      const updates = {
        current_source_price: latestData.price,
        current_stock_level: latestData.stockLevel,
        is_in_stock: latestData.inStock ?? false,
        last_checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      // Check for changes
      const changes = {
        priceChanged: product.current_source_price !== latestData.price,
        stockChanged: product.current_stock_level !== latestData.stockLevel,
        availabilityChanged: product.is_in_stock !== latestData.inStock
      };

      // Update product in database
      const { error: updateError } = await this.supabase
        .from('products')
        .update(updates)
        .eq('id', product.id);

      if (updateError) {
        throw updateError;
      }

      // Get listings for this product to log refresh for each
      const { data: listings, error: listingsError } = await this.supabase
        .from('listings')
        .select('id')
        .eq('product_id', product.id)
        .eq('user_id', product.user_id);

      const listingIds = listings?.map(listing => listing.id) || [];

      // Log the refresh
      await auditService.logProductRefresh(
        product.id,
        product.user_id,
        {
          price: product.current_source_price,
          stockLevel: product.current_stock_level,
          sourceUrl: product.source_url
        },
        {
          price: latestData.price,
          stockLevel: latestData.stockLevel,
          sourceUrl: product.source_url
        },
        listingIds
      );

      // Note: Informed.co updates now handled by daily sync only

      return {
        success: true,
        productId: product.id,
        updates,
        changes,
        latestData
      };
    } catch (error) {
      console.error(`Error refreshing product ${product.id}:`, error);
      return {
        success: false,
        productId: product.id,
        error: error.message
      };
    }
  }

  /**
   * Refresh all products for a user
   */
  async refreshUserProducts(userId, settings = {}) {
    const results = {
      processed: 0,
      updated: 0,
      failed: 0,
      errors: []
    };

    const changedProducts = [];

    try {
      // Get user's refresh interval
      const { data: profile } = await this.supabase
        .from('profiles')
        .select('product_refresh_interval')
        .eq('id', userId)
        .single();

      const refreshInterval = profile?.product_refresh_interval || 24;

      // Get products to refresh
      const products = await this.getProductsToRefresh(userId, refreshInterval);
      console.log(`Found ${products.length} products to refresh for user ${userId}`);

      // Get user's default stock levels
      const { data: userSettings } = await this.supabase
        .from('user_settings')
        .select('default_stock_levels')
        .eq('user_id', userId)
        .single();

      const defaultStockLevels = userSettings?.default_stock_levels || {};

      // Process each product
      for (const product of products) {
        results.processed++;

        const refreshResult = await this.refreshProduct(product, defaultStockLevels);

        if (refreshResult.success) {
          results.updated++;
          
          // Track products with changes for repricing
          if (refreshResult.changes.priceChanged) {
            changedProducts.push({
              id: product.id,
              name: product.name,
              current_source_price: refreshResult.latestData.price,
              shipping_cost: product.shipping_cost || 0,
              changes: refreshResult.changes
            });
          }
        } else {
          results.failed++;
          results.errors.push({
            productId: product.id,
            productName: product.name,
            error: refreshResult.error
          });
        }
      }

      // Update user's last refresh time only if products were actually refreshed
      if (results.processed > 0) {
        await this.supabase
          .from('profiles')
          .update({ last_product_refresh: new Date().toISOString() })
          .eq('id', userId);
      }

      return {
        success: true,
        userId,
        results,
        changedProducts
      };
    } catch (error) {
      console.error(`Error refreshing products for user ${userId}:`, error);
      return {
        success: false,
        userId,
        error: error.message,
        results
      };
    }
  }

  /**
   * Batch refresh products
   */
  async batchRefresh(productIds, userId, defaultStockLevels = {}) {
    const results = {
      total: productIds.length,
      processed: 0,
      updated: 0,
      failed: 0,
      errors: []
    };

    // Get products
    const { data: products, error } = await this.supabase
      .from('products')
      .select('*')
      .in('id', productIds)
      .eq('user_id', userId);

    if (error) {
      throw error;
    }

    for (const product of products || []) {
      const refreshResult = await this.refreshProduct(product, defaultStockLevels);
      results.processed++;

      if (refreshResult.success) {
        results.updated++;
      } else {
        results.failed++;
        results.errors.push({
          productId: product.id,
          error: refreshResult.error
        });
      }
    }

    // Log bulk operation
    await auditService.logBulkOperation(userId, 'product_refresh', results.processed, {
      updated: results.updated,
      failed: results.failed,
      total: results.total
    });

    return results;
  }
}

// Export singleton instance
module.exports = new ProductRefreshService();