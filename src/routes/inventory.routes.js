const express = require('express');
const router = express.Router();
const inventoryService = require('../services/inventory/inventoryService');
const { authMiddleware } = require('../middleware/auth.middleware');

/**
 * Batch inventory sync
 * Called by Edge Function after product refresh
 */
router.post('/sync/batch', authMiddleware, async (req, res) => {
  try {
    const { products, userId, settings } = req.body;
    
    // Verify service role or user permission
    if (req.headers['x-service-role'] !== 'true' && req.user?.id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const result = await inventoryService.batchSyncInventory(products, userId, settings);

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Batch inventory sync error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * Sync inventory for a single product
 */
router.post('/sync/product/:productId', authMiddleware, async (req, res) => {
  try {
    const { productId } = req.params;
    const userId = req.user.id;

    // Get product details
    const { data: product, error } = await inventoryService.supabase
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

    // Get user settings
    const { data: settings } = await inventoryService.supabase
      .from('user_settings')
      .select('automated_inventory_sync_enabled, default_stock_levels')
      .eq('user_id', userId)
      .single();

    const result = await inventoryService.syncProductInventory({
      productId: product.id,
      userId,
      newStockLevel: product.current_stock_level,
      isInStock: product.is_in_stock,
      settings
    });

    res.json(result);
  } catch (error) {
    console.error('Sync product inventory error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * Update marketplace inventory directly
 */
router.post('/update-marketplace', authMiddleware, async (req, res) => {
  try {
    const { listingId, quantity } = req.body;
    const userId = req.user.id;

    if (!listingId || typeof quantity !== 'number' || quantity < 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid listing ID and quantity are required'
      });
    }

    // Get listing details
    const { data: listing, error } = await inventoryService.supabase
      .from('listings')
      .select(`
        *,
        marketplaces!inner(name)
      `)
      .eq('id', listingId)
      .eq('user_id', userId)
      .single();

    if (error || !listing) {
      return res.status(404).json({
        success: false,
        message: 'Listing not found'
      });
    }

    const result = await inventoryService.updateMarketplaceInventory({
      listing,
      newQuantity: quantity,
      userId,
      marketplace: listing.marketplaces.name
    });

    if (result.success) {
      // Update listing in database
      await inventoryService.supabase
        .from('listings')
        .update({
          current_stock_level: quantity,
          is_available: quantity > 0,
          updated_at: new Date().toISOString()
        })
        .eq('id', listingId);
    }

    res.json(result);
  } catch (error) {
    console.error('Update marketplace inventory error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;