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
    
    // Request report
    const reportRequest = await informedService.requestMissingPricesReport(integration.api_key);
    
    // Update log with external job ID
    await supabase
      .from('integration_logs')
      .update({
        external_job_id: reportRequest.ReportRequestID,
        status: 'processing',
        request_data: { reportRequest }
      })
      .eq('id', logEntry.id);

    // Poll for completion
    const reportStatus = await informedService.pollReportCompletion(
      integration.api_key, 
      reportRequest.ReportRequestID
    );

    // Download and parse report
    const csvData = await informedService.downloadReport(reportStatus.DownloadLink);
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
  console.log(`Processing ${reportData.length} items from missing prices report`);
  
  // Map Informed.co marketplace IDs to marketplace names
  const marketplaceIdMap = {
    '17860': 'Walmart',
    '17961': 'Amazon'
  };

  let processed = 0;
  let skipped = 0;
  let matchingAttempts = 0;

  for (const item of reportData) {
    processed++;
    try {
      console.log(`Processing item ${processed}/${reportData.length}: SKU=${item.sku}, MarketplaceId=${item.marketplaceId}`);
      
      // Get marketplace name from Informed.co ID
      const marketplaceName = marketplaceIdMap[item.marketplaceId];
      if (!marketplaceName) {
        console.log(`Unknown marketplace ID: ${item.marketplaceId}, skipping`);
        skipped++;
        continue;
      }

      console.log(`Marketplace: ${marketplaceName}`);

      // Find matching listing based on marketplace-specific SKU strategy
      let listing = null;
      matchingAttempts++;

      if (marketplaceName === 'Walmart') {
        // For Walmart, match by external_id (Walmart Item ID)
        const { data } = await supabase
          .from('listings')
          .select('*, products(*)')
          .eq('user_id', userId)
          .eq('external_id', item.sku)
          .single();
        listing = data;
        console.log(`Walmart lookup by external_id=${item.sku}: ${listing ? 'FOUND' : 'NOT FOUND'}`);
      } else if (marketplaceName === 'Amazon') {
        // For Amazon, match by sku (ASIN)
        const { data } = await supabase
          .from('listings')
          .select('*, products(*)')
          .eq('user_id', userId)
          .eq('sku', item.sku)
          .single();
        listing = data;
        console.log(`Amazon lookup by sku=${item.sku}: ${listing ? 'FOUND' : 'NOT FOUND'}`);
      }

      if (!listing) {
        console.log(`No matching listing found for ${marketplaceName} SKU: ${item.sku}`);
        skipped++;
        continue;
      }

      if (!listing.products) {
        console.log(`Listing found but no product attached: ${item.sku}`);
        skipped++;
        continue;
      }

      // Check if we have required product data
      const currentSourcePrice = parseFloat(listing.products.current_source_price);
      const shippingCost = parseFloat(listing.products.shipping_cost) || 0;
      const minPrice = parseFloat(listing.minimum_resell_price);

      if (!currentSourcePrice || currentSourcePrice <= 0) {
        console.log(`Missing or invalid source price for ${item.sku}: ${listing.products.current_source_price}`);
        skipped++;
        continue;
      }

      if (!minPrice || minPrice <= 0) {
        console.log(`Missing or invalid minimum resell price for ${item.sku}: ${listing.minimum_resell_price}`);
        skipped++;
        continue;
      }

      console.log(`✅ Valid update for ${item.sku}: cost=${currentSourcePrice}, shipping=${shippingCost}, minPrice=${minPrice}`);
      
      updates.push({
        sku: item.sku,
        marketplaceId: item.marketplaceId, // Use Informed.co's marketplace ID (17860 or 17961)
        cost: currentSourcePrice,
        minPrice: minPrice,
        shippingCost: shippingCost
      });
    } catch (error) {
      console.error(`Error processing item ${item.sku}:`, error);
      skipped++;
    }
  }

  console.log(`Processing complete: ${updates.length} updates generated, ${skipped} skipped, ${matchingAttempts} matching attempts`);
  return updates;
}

// DEPRECATED: All batch processing functions removed - using daily sync only

module.exports = router;