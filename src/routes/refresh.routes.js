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