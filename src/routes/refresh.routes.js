const express = require('express');
const router = express.Router();
const productRefreshService = require('../services/productRefresh/productRefreshService');
const { authMiddleware } = require('../middleware/auth.middleware');

/**
 * Refresh all products for a user
 * Called by Edge Function
 */
router.post('/refresh-user', authMiddleware, async (req, res) => {
  try {
    const { userId, settings } = req.body;
    
    // Verify service role or user permission
    if (req.headers['x-service-role'] !== 'true' && req.user?.id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const result = await productRefreshService.refreshUserProducts(userId, settings);
    
    // Get products with price changes for repricing
    const productsWithChanges = [];
    if (result.success && result.changedProducts) {
      productsWithChanges.push(...result.changedProducts.filter(p => p.changes.priceChanged));
    }

    res.json({
      success: result.success,
      results: result.results,
      productsWithChanges,
      error: result.error
    });
  } catch (error) {
    console.error('Refresh user products error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * Refresh specific products
 */
router.post('/refresh-batch', authMiddleware, async (req, res) => {
  try {
    const { productIds, defaultStockLevels } = req.body;
    const userId = req.user.id;

    if (!productIds || !Array.isArray(productIds)) {
      return res.status(400).json({
        success: false,
        message: 'Product IDs array is required'
      });
    }

    const result = await productRefreshService.batchRefresh(
      productIds,
      userId,
      defaultStockLevels
    );

    res.json({
      success: true,
      results: result
    });
  } catch (error) {
    console.error('Batch refresh error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * Refresh single product
 */
router.post('/refresh/:productId', authMiddleware, async (req, res) => {
  try {
    const { productId } = req.params;
    const userId = req.user.id;

    // Get product
    const { data: product, error } = await productRefreshService.supabase
      .from('products')
      .select('*')
      .eq('id', productId)
      .eq('user_id', userId)
      .single();

    if (error || !product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Get user's default stock levels
    const { data: settings } = await productRefreshService.supabase
      .from('user_settings')
      .select('default_stock_levels')
      .eq('user_id', userId)
      .single();

    const result = await productRefreshService.refreshProduct(
      product,
      settings?.default_stock_levels || {}
    );

    // If refresh was successful, handle repricing and inventory sync
    if (result.success) {
      // Get user's settings for repricing and inventory sync
      const { data: userProfile } = await productRefreshService.supabase
        .from('profiles')
        .select('automated_repricing_enabled, minimum_profit_type, minimum_profit_value, automated_inventory_sync_enabled')
        .eq('id', userId)
        .single();

      // Handle repricing if price changed
      if (result.changes?.priceChanged && userProfile?.automated_repricing_enabled) {
        console.log(`Price changed for product ${productId}, triggering repricing...`);
        
        // Import repricing service
        const repricingService = require('../services/repricing/repricingService');
        
        // Process repricing for this product
        const repricingResult = await repricingService.processProductRepricing({
          productId: product.id,
          userId,
          newSourcePrice: result.latestData.price,
          shippingCost: product.shipping_cost || 0,
          settings: userProfile
        });

        // Add repricing results to response
        result.repricingApplied = repricingResult.success;
        result.repricingResults = repricingResult.results;
        
        if (repricingResult.success && repricingResult.results?.updated > 0) {
          console.log(`Successfully repriced ${repricingResult.results.updated} listings for product ${productId}`);
          
          // Trigger Informed.co sync after successful repricing
          try {
            const backendUrl = process.env.BACKEND_URL || 'https://marketplace-nexus-server.onrender.com';
            const informedResponse = await fetch(`${backendUrl}/api/informed/sync-missing`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': req.headers.authorization,
                'X-User-Id': userId
              }
            });

            if (informedResponse.ok) {
              const informedData = await informedResponse.json();
              result.informedSyncApplied = informedData.success;
              result.informedSyncResults = { synced: informedData.synced || 0 };
              
              if (informedData.synced > 0) {
                console.log(`Successfully synced ${informedData.synced} updates to Informed.co`);
              }
            }
          } catch (informedError) {
            console.error('Informed.co sync error after repricing:', informedError);
            result.informedSyncError = informedError.message;
          }
        }
      } else if (result.changes?.priceChanged) {
        console.log(`Automated repricing disabled for user ${userId}, skipping repricing`);
      }

      // Handle inventory sync if stock changed
      if ((result.changes?.stockChanged || result.changes?.availabilityChanged) && userProfile?.automated_inventory_sync_enabled) {
        console.log(`Stock changed for product ${productId} (stock: ${result.latestData.stockLevel}, in_stock: ${result.latestData.inStock}), triggering inventory sync...`);
        
        // Import inventory service
        const inventoryService = require('../services/inventory/inventoryService');
        
        // Process inventory sync for this product
        const inventoryResult = await inventoryService.syncProductInventory({
          productId: product.id,
          userId,
          newStockLevel: result.latestData.stockLevel,
          isInStock: result.latestData.inStock,
          settings: userProfile
        });

        // Add inventory sync results to response
        result.inventorySyncApplied = inventoryResult.success;
        result.inventorySyncResults = inventoryResult.results;
        
        if (inventoryResult.success && inventoryResult.results?.updated > 0) {
          console.log(`Successfully synced inventory for ${inventoryResult.results.updated} listings for product ${productId}`);
        }
      } else if (result.changes?.stockChanged || result.changes?.availabilityChanged) {
        console.log(`Automated inventory sync disabled for user ${userId}, skipping inventory sync`);
      }
    }

    res.json(result);
  } catch (error) {
    console.error('Refresh product error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;