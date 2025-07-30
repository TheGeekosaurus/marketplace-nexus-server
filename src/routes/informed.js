const express = require('express');
const router = express.Router();
const informedService = require('../services/informed/informedService');
const { createClient } = require('@supabase/supabase-js');
const { authMiddleware } = require('../middleware/auth.middleware');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Apply authentication middleware to all routes
router.use(authMiddleware);

// Configure Informed.co integration
router.post('/configure', async (req, res) => {
  try {
    const { apiKey, settings } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    if (!apiKey) {
      return res.status(400).json({ error: 'API key is required' });
    }

    // Test the API key by making a simple request
    try {
      await informedService.requestMissingPricesReport(apiKey);
    } catch (error) {
      return res.status(400).json({ 
        error: 'Invalid API key or Informed.co API error',
        details: error.message 
      });
    }

    // Store the integration configuration
    const { data, error } = await supabase
      .from('third_party_integrations')
      .upsert({
        user_id: userId,
        integration_type: 'informed_co',
        api_key: apiKey, // Note: Should be encrypted in production
        config: {
          marketplace_mappings: settings?.marketplace_mappings || {},
          settings: {
            batch_delay_minutes: settings?.batch_delay_minutes || 10,
            max_batch_size: settings?.max_batch_size || 500,
            auto_sync_enabled: settings?.auto_sync_enabled !== false
          }
        },
        is_active: true,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id,integration_type'
      })
      .select()
      .single();

    if (error) {
      console.error('Error saving integration:', error);
      return res.status(500).json({ error: 'Failed to save integration configuration' });
    }

    res.json({ 
      success: true, 
      integration: {
        id: data.id,
        is_active: data.is_active,
        config: data.config
      }
    });
  } catch (error) {
    console.error('Error configuring Informed.co integration:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get integration status
router.get('/status', async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const { data: integration } = await supabase
      .from('third_party_integrations')
      .select('id, is_active, config, created_at, updated_at')
      .eq('user_id', userId)
      .eq('integration_type', 'informed_co')
      .single();

    if (!integration) {
      return res.json({ configured: false });
    }

    // Get recent logs
    const { data: recentLogs } = await supabase
      .from('integration_logs')
      .select('*')
      .eq('integration_id', integration.id)
      .order('started_at', { ascending: false })
      .limit(5);

    res.json({
      configured: true,
      integration: {
        id: integration.id,
        is_active: integration.is_active,
        config: integration.config,
        created_at: integration.created_at,
        updated_at: integration.updated_at
      },
      recent_logs: recentLogs || []
    });
  } catch (error) {
    console.error('Error getting integration status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Trigger manual sync of missing prices
router.post('/sync-missing', async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    // Get integration config
    const { data: integration } = await supabase
      .from('third_party_integrations')
      .select('*')
      .eq('user_id', userId)
      .eq('integration_type', 'informed_co')
      .single();

    if (!integration) {
      return res.status(404).json({ error: 'Informed.co integration not configured' });
    }

    // Start the sync process
    const result = await syncMissingPrices(userId, integration);
    
    res.json({ 
      success: true, 
      log_id: result.logId,
      message: 'Sync process started' 
    });
  } catch (error) {
    console.error('Error starting missing prices sync:', error);
    res.status(500).json({ error: 'Failed to start sync process' });
  }
});

// DEPRECATED: Batch updates removed - using daily sync only
router.post('/batch-updates', async (req, res) => {
  res.json({ 
    success: true, 
    processed: 0,
    logs: [],
    message: 'Batch updates disabled - using daily sync only'
  });
});

// Get integration logs
router.get('/logs', async (req, res) => {
  try {
    const userId = req.user?.id;
    const { limit = 20, offset = 0, operation_type } = req.query;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    // Get integration
    const { data: integration } = await supabase
      .from('third_party_integrations')
      .select('id')
      .eq('user_id', userId)
      .eq('integration_type', 'informed_co')
      .single();

    if (!integration) {
      return res.json({ logs: [], total: 0 });
    }

    let query = supabase
      .from('integration_logs')
      .select('*', { count: 'exact' })
      .eq('integration_id', integration.id)
      .order('started_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (operation_type) {
      query = query.eq('operation_type', operation_type);
    }

    const { data: logs, count, error } = await query;

    if (error) {
      console.error('Error fetching logs:', error);
      return res.status(500).json({ error: 'Failed to fetch logs' });
    }

    res.json({ logs: logs || [], total: count || 0 });
  } catch (error) {
    console.error('Error fetching integration logs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper function to sync missing prices
async function syncMissingPrices(userId, integration) {
  // Create log entry
  const { data: logEntry } = await supabase
    .from('integration_logs')
    .insert({
      user_id: userId,
      integration_id: integration.id,
      operation_type: 'sync_missing_prices',
      status: 'pending'
    })
    .select()
    .single();

  try {
    // Debug API key
    console.log('Integration API key exists:', !!integration.api_key);
    console.log('API key length:', integration.api_key?.length);
    console.log('API key starts with:', integration.api_key?.substring(0, 10) + '...');
    
    // Full sync: send ALL our listings with valid price data to Informed.co
    console.log('Starting full sync of all listings with valid price data');
    
    // Generate updates for all our listings with valid data
    const updates = await generateAllPriceUpdates(userId);

    let feedSubmission = null;
    if (updates.length > 0) {
      // Submit combined cost and price updates to Informed.co
      feedSubmission = await informedService.submitPriceUpdates(integration.api_key, updates);
    }

    // Update log with completion
    await supabase
      .from('integration_logs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        items_processed: updates.length,
        items_succeeded: updates.length,
        items_failed: 0,
        response_data: { feedSubmission, updates }
      })
      .eq('id', logEntry.id);

    return { logId: logEntry.id, updates: updates.length };
  } catch (error) {
    // Update log with error
    await supabase
      .from('integration_logs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: error.message
      })
      .eq('id', logEntry.id);

    throw error;
  }
}

// Generate price updates for ALL listings with valid data (full sync approach)
async function generateAllPriceUpdates(userId) {
  const updates = [];
  console.log('Generating full sync updates for all listings with valid data');
  
  // Map marketplace names to Informed.co marketplace IDs
  const marketplaceIdMap = {
    'Walmart': '17860',
    'Amazon': '17961'
  };

  try {
    // Get all listings with products that have valid pricing data
    const { data: listings, error } = await supabase
      .from('listings')
      .select(`
        *,
        products!inner(*),
        marketplaces!inner(name)
      `)
      .eq('user_id', userId)
      .not('products.current_source_price', 'is', null)
      .not('minimum_resell_price', 'is', null)
      .gt('products.current_source_price', 0)
      .gt('minimum_resell_price', 0);

    if (error) {
      console.error('Error fetching listings for full sync:', error);
      return [];
    }

    console.log(`Found ${listings?.length || 0} listings with valid pricing data`);

    for (const listing of listings || []) {
      try {
        const marketplaceName = listing.marketplaces.name;
        const marketplaceId = marketplaceIdMap[marketplaceName];
        
        if (!marketplaceId) {
          console.log(`Unsupported marketplace: ${marketplaceName}, skipping listing ${listing.id}`);
          continue;
        }

        // Determine SKU based on marketplace
        let sku;
        if (marketplaceName === 'Walmart') {
          sku = listing.external_id; // Walmart Item ID
        } else if (marketplaceName === 'Amazon') {
          sku = listing.sku; // ASIN
        }

        if (!sku) {
          console.log(`Missing SKU for ${marketplaceName} listing ${listing.id}, skipping`);
          continue;
        }

        // Calculate total cost including shipping
        const currentSourcePrice = parseFloat(listing.products.current_source_price) || 0;
        const shippingCost = parseFloat(listing.products.shipping_cost) || 0;
        const totalCost = currentSourcePrice + shippingCost;
        
        const minPrice = parseFloat(listing.minimum_resell_price);

        console.log(`✅ Adding ${marketplaceName} listing: SKU=${sku}, cost=${totalCost} (price: ${currentSourcePrice} + shipping: ${shippingCost}), minPrice=${minPrice}`);
        
        updates.push({
          sku: sku,
          marketplaceId: marketplaceId,
          cost: totalCost,
          minPrice: minPrice
        });

      } catch (error) {
        console.error(`Error processing listing ${listing.id}:`, error);
      }
    }

    console.log(`Full sync complete: ${updates.length} updates generated`);
    return updates;

  } catch (error) {
    console.error('Error in generateAllPriceUpdates:', error);
    return [];
  }
}

// DEPRECATED: All batch processing functions removed - using daily sync only

module.exports = router;