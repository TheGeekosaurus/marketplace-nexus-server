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

    // Get user settings from profiles table
    const { data: settings } = await repricingService.supabase
      .from('profiles')
      .select('automated_repricing_enabled, minimum_profit_type, minimum_profit_value')
      .eq('id', userId)
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

    // Get user settings from profiles table
    const { data: settings } = await repricingService.supabase
      .from('profiles')
      .select('minimum_profit_type, minimum_profit_value')
      .eq('id', userId)
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

/**
 * Daily repricing check - find and update listings below minimum price
 * Called by Edge Function on daily schedule
 */
router.post('/check-below-minimum', authMiddleware, async (req, res) => {
  try {
    const { userId, settings } = req.body;
    
    // Verify service role or user permission
    if (req.headers['x-service-role'] !== 'true' && req.user?.id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    // Check if user has automated repricing enabled
    if (!settings?.automated_repricing_enabled) {
      return res.json({
        success: true,
        results: {
          processed: 0,
          updated: 0,
          skipped: 0,
          failed: 0,
          errors: []
        },
        message: 'Automated repricing disabled for user'
      });
    }

    const result = await repricingService.checkAndRepriceBelowMinimum(userId, settings);

    // Trigger Informed.co sync after successful daily repricing
    if (result.success && result.results?.updated > 0) {
      try {
        const backendUrl = process.env.BACKEND_URL || 'https://marketplace-nexus-server.onrender.com';
        const informedResponse = await fetch(`${backendUrl}/api/informed/immediate-sync`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': req.headers.authorization,
            'X-Service-Role': 'true'
          },
          body: JSON.stringify({
            productIds: [], // Empty array means sync all user's listings
            reason: 'daily_repricing'
          })
        });

        if (informedResponse.ok) {
          const informedData = await informedResponse.json();
          result.informedSyncApplied = informedData.success;
          result.informedSyncResults = { synced: informedData.synced || 0 };
          
          if (informedData.synced > 0) {
            console.log(`[Daily Repricing] Successfully synced ${informedData.synced} updates to Informed.co for user ${userId}`);
          }
        }
      } catch (informedError) {
        console.error(`[Daily Repricing] Informed.co sync error for user ${userId}:`, informedError);
        result.informedSyncError = informedError.message;
      }
    }

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Daily repricing check error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * Manual repricing trigger - reprice all listings below minimum price immediately
 * Called by user from settings UI
 */
router.post('/manual-trigger', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    
    console.log(`[Manual Repricing] Triggered by user ${userId}`);

    // Get user settings from profiles table
    const { data: settings, error: settingsError } = await repricingService.supabase
      .from('profiles')
      .select('automated_repricing_enabled, minimum_profit_type, minimum_profit_value')
      .eq('id', userId)
      .single();

    if (settingsError) {
      throw settingsError;
    }

    // Even if automated repricing is disabled, allow manual trigger
    // This is useful for testing or one-time updates
    const result = await repricingService.checkAndRepriceBelowMinimum(userId, {
      ...settings,
      automated_repricing_enabled: true // Force enable for manual trigger
    });

    console.log(`[Manual Repricing] Completed for user ${userId}:`, {
      processed: result.results?.processed || 0,
      updated: result.results?.updated || 0,
      failed: result.results?.failed || 0
    });

    // Trigger Informed.co sync after successful manual repricing
    if (result.success && result.results?.updated > 0) {
      try {
        const backendUrl = process.env.BACKEND_URL || 'https://marketplace-nexus-server.onrender.com';
        const informedResponse = await fetch(`${backendUrl}/api/informed/immediate-sync`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': req.headers.authorization
          },
          body: JSON.stringify({
            productIds: [], // Empty array means sync all user's listings
            reason: 'manual_repricing'
          })
        });

        if (informedResponse.ok) {
          const informedData = await informedResponse.json();
          result.informedSyncApplied = informedData.success;
          result.informedSyncResults = { synced: informedData.synced || 0 };
          
          if (informedData.synced > 0) {
            console.log(`[Manual Repricing] Successfully synced ${informedData.synced} updates to Informed.co for user ${userId}`);
          }
        }
      } catch (informedError) {
        console.error(`[Manual Repricing] Informed.co sync error for user ${userId}:`, informedError);
        result.informedSyncError = informedError.message;
      }
    }

    res.json({
      success: true,
      message: `Repricing completed: ${result.results?.updated || 0} listings updated`,
      ...result
    });
  } catch (error) {
    console.error('[Manual Repricing] Error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;