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

// Process batched price updates
router.post('/batch-updates', async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const result = await processBatchedUpdates(userId);
    
    res.json({ 
      success: true, 
      processed: result.processed,
      logs: result.logs
    });
  } catch (error) {
    console.error('Error processing batch updates:', error);
    res.status(500).json({ error: 'Failed to process batch updates' });
  }
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
    // Request report
    const reportRequest = await informedService.requestMissingPricesReport(integration.api_key);
    
    // Update log with external job ID
    await supabase
      .from('integration_logs')
      .update({
        external_job_id: reportRequest.reportRequestID,
        status: 'processing',
        request_data: { reportRequest }
      })
      .eq('id', logEntry.id);

    // Poll for completion
    const reportStatus = await informedService.pollReportCompletion(
      integration.api_key, 
      reportRequest.reportRequestID
    );

    // Download and parse report
    const csvData = await informedService.downloadReport(reportStatus.downloadLink);
    const reportData = await informedService.parseMissingPricesReport(csvData);

    // Process the report data
    const updates = await processMissingPricesReport(userId, reportData, integration.config);

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
        items_processed: reportData.length,
        items_succeeded: updates.length,
        items_failed: reportData.length - updates.length,
        response_data: { reportStatus, feedSubmission, updates }
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

// Helper function to process missing prices report
async function processMissingPricesReport(userId, reportData, integrationConfig) {
  const updates = [];
  const marketplaceMappings = integrationConfig.marketplace_mappings || {};

  for (const item of reportData) {
    try {
      // Find our marketplace by informed.co marketplace ID
      const { data: marketplace } = await supabase
        .from('marketplaces')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (!marketplace) continue;

      // Find matching listing based on SKU mapping
      const { data: listing } = await supabase
        .from('listings')
        .select('*, products(*)')
        .eq('user_id', userId)
        .eq('sku', item.sku)
        .single();

      if (!listing || !listing.products) continue;

      // Use stored values from database
      const cost = parseFloat(listing.products.current_source_price) || 0;
      const shippingCost = parseFloat(listing.products.shipping_cost) || 0;
      const minPrice = parseFloat(listing.minimum_resell_price) || 0;
      
      updates.push({
        sku: item.sku,
        marketplaceId: item.marketplaceId,
        cost: cost,
        minPrice: minPrice,
        shippingCost: shippingCost
      });
    } catch (error) {
      console.error(`Error processing item ${item.sku}:`, error);
    }
  }

  return updates;
}

// Helper function to process batched updates
async function processBatchedUpdates(userId) {
  // Get pending updates
  const { data: queuedUpdates } = await supabase
    .from('informed_price_updates_queue')
    .select('*')
    .eq('user_id', userId)
    .eq('processed', false)
    .order('created_at', { ascending: true })
    .limit(500);

  if (!queuedUpdates || queuedUpdates.length === 0) {
    return { processed: 0, logs: [] };
  }

  // Get integration
  const { data: integration } = await supabase
    .from('third_party_integrations')
    .select('*')
    .eq('user_id', userId)
    .eq('integration_type', 'informed_co')
    .single();

  if (!integration) {
    throw new Error('Informed.co integration not configured');
  }

  const logs = [];

  // Process all updates together
  if (queuedUpdates.length > 0) {
    const logEntry = await createBatchLog(userId, integration.id, 'batch_price_update', queuedUpdates.length);
    try {
      const updates = await prepareBatchUpdates(queuedUpdates);
      const feedSubmission = await informedService.submitPriceUpdates(integration.api_key, updates);
      
      await completeBatchLog(logEntry.id, updates.length, 0, { feedSubmission });
      logs.push(logEntry);
    } catch (error) {
      await failBatchLog(logEntry.id, error.message);
      logs.push(logEntry);
    }
  }

  // Mark items as processed
  await supabase
    .from('informed_price_updates_queue')
    .update({ processed: true })
    .in('id', queuedUpdates.map(u => u.id));

  return { processed: queuedUpdates.length, logs };
}

// Helper functions for batch processing
async function createBatchLog(userId, integrationId, operationType, itemCount) {
  const { data } = await supabase
    .from('integration_logs')
    .insert({
      user_id: userId,
      integration_id: integrationId,
      operation_type: operationType,
      status: 'processing',
      items_processed: itemCount
    })
    .select()
    .single();
  
  return data;
}

async function completeBatchLog(logId, succeeded, failed, responseData) {
  await supabase
    .from('integration_logs')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      items_succeeded: succeeded,
      items_failed: failed,
      response_data: responseData
    })
    .eq('id', logId);
}

async function failBatchLog(logId, errorMessage) {
  await supabase
    .from('integration_logs')
    .update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_message: errorMessage
    })
    .eq('id', logId);
}

async function prepareBatchUpdates(queuedUpdates) {
  // Group updates by listing to combine cost and price changes
  const listingUpdates = new Map();
  
  for (const update of queuedUpdates) {
    const key = update.listing_id;
    if (!listingUpdates.has(key)) {
      listingUpdates.set(key, {
        listing_id: update.listing_id,
        cost: null,
        minPrice: null
      });
    }
    
    const listingUpdate = listingUpdates.get(key);
    if (update.update_type === 'cost_change') {
      listingUpdate.cost = update.new_cost;
    } else if (update.update_type === 'price_change') {
      listingUpdate.minPrice = update.new_min_price;
    }
  }
  
  const updates = [];
  
  for (const [listingId, updateData] of listingUpdates) {
    const { data: listing } = await supabase
      .from('listings')
      .select('sku, external_id, marketplaces(name), products(base_price, shipping_cost), marketplace_fee_percentage')
      .eq('id', listingId)
      .single();

    if (listing && listing.products) {
      const sku = informedService.mapOurSkuToInformed(listing, listing.marketplaces);
      if (sku) {
        // Calculate current cost and min price if not provided in update
        const prices = informedService.calculateCostAndMinPrice(listing, listing.products);
        
        updates.push({
          sku,
          cost: updateData.cost || prices.cost,
          minPrice: updateData.minPrice || prices.minPrice,
          shippingCost: parseFloat(listing.products.shipping_cost) || 0,
          marketplaceId: '1' // This should come from config mapping
        });
      }
    }
  }
  
  return updates;
}

module.exports = router;