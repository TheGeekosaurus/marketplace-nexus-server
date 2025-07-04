const express = require('express');
const router = express.Router();
const repricingService = require('../services/repricing/repricingService');
const { authMiddleware } = require('../middleware/auth.middleware');

/**
 * Batch repricing
 * Called by Edge Function after product refresh
 */
router.post('/batch', authMiddleware, async (req, res) => {
  try {
    const { products, userId, settings } = req.body;
    
    // Verify service role or user permission
    if (req.headers['x-service-role'] !== 'true' && req.user?.id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const result = await repricingService.batchReprice(products, userId, settings);

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Batch repricing error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * Reprice single product
 */
router.post('/product/:productId', authMiddleware, async (req, res) => {
  try {
    const { productId } = req.params;
    const userId = req.user.id;

    // Get product details
    const { data: product, error } = await repricingService.supabase
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
    const { data: settings } = await repricingService.supabase
      .from('user_settings')
      .select('automated_repricing_enabled, minimum_profit_type, minimum_profit_value')
      .eq('user_id', userId)
      .single();

    const result = await repricingService.processProductRepricing({
      productId: product.id,
      userId,
      newSourcePrice: product.current_source_price || 0,
      shippingCost: product.shipping_cost || 0,
      settings
    });

    res.json(result);
  } catch (error) {
    console.error('Reprice product error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * Calculate minimum price for a product
 */
router.post('/calculate', authMiddleware, async (req, res) => {
  try {
    const { sourceCost, shippingCost = 0 } = req.body;
    const userId = req.user.id;

    if (typeof sourceCost !== 'number' || sourceCost < 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid source cost is required'
      });
    }

    // Get user settings
    const { data: settings } = await repricingService.supabase
      .from('user_settings')
      .select('minimum_profit_type, minimum_profit_value')
      .eq('user_id', userId)
      .single();

    const totalCost = sourceCost + shippingCost;
    const minimumPrice = repricingService.calculateMinimumResellPrice(totalCost, settings);

    res.json({
      success: true,
      sourceCost,
      shippingCost,
      totalCost,
      minimumPrice,
      profitMargin: settings
    });
  } catch (error) {
    console.error('Calculate price error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * Update marketplace price directly
 */
router.post('/update-marketplace-price', authMiddleware, async (req, res) => {
  try {
    const { listingId, newPrice } = req.body;
    const userId = req.user.id;

    if (!listingId || typeof newPrice !== 'number' || newPrice <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid listing ID and price are required'
      });
    }

    // Get listing details
    const { data: listing, error } = await repricingService.supabase
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

    const result = await repricingService.updateMarketplacePrice({
      listing,
      newPrice,
      userId,
      marketplace: listing.marketplaces.name
    });

    if (result.success) {
      // Update listing in database
      await repricingService.supabase
        .from('listings')
        .update({
          price: newPrice,
          updated_at: new Date().toISOString()
        })
        .eq('id', listingId);
    }

    res.json(result);
  } catch (error) {
    console.error('Update marketplace price error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;