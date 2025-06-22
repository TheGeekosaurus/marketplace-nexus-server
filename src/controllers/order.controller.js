const asyncHandler = require('express-async-handler');
const Joi = require('joi');
const walmartOrderService = require('../services/walmartOrderService');
const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

// Initialize Supabase client
const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey
);

/**
 * Fetch Walmart orders
 * @route GET /api/orders/walmart
 * @access Private
 */
const getWalmartOrders = asyncHandler(async (req, res) => {
  const schema = Joi.object({
    createdStartDate: Joi.date().iso(),
    createdEndDate: Joi.date().iso(),
    limit: Joi.number().integer().min(1).max(200).default(100),
    productInfo: Joi.boolean().default(false),
    shipNodeType: Joi.string().default('SellerFulfilled'),
    status: Joi.string().valid('Created', 'Acknowledged', 'Shipped', 'Delivered', 'Cancelled'),
    cursor: Joi.string()
  });

  const { error, value } = schema.validate(req.query);
  if (error) {
    return res.status(400).json({ 
      success: false,
      message: error.details[0].message 
    });
  }

  const { clientid: clientId, clientsecret: clientSecret } = req.headers;
  
  if (!clientId || !clientSecret) {
    return res.status(401).json({
      success: false,
      message: 'Walmart credentials required in headers'
    });
  }

  try {
    // Get access token
    const tokenData = await walmartOrderService.getAccessToken(clientId, clientSecret);
    
    // Fetch orders
    const ordersResponse = await walmartOrderService.getOrders(
      tokenData.accessToken,
      value
    );

    return res.status(200).json({
      success: true,
      data: ordersResponse.orders,
      meta: ordersResponse.meta,
      nextCursor: ordersResponse.nextCursor
    });
  } catch (error) {
    console.error('Error fetching Walmart orders:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch orders',
      error: error.response ? error.response.data : null
    });
  }
});

/**
 * Get specific Walmart order
 * @route GET /api/orders/walmart/:orderId
 * @access Private
 */
const getWalmartOrderById = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const { clientid: clientId, clientsecret: clientSecret } = req.headers;
  
  if (!clientId || !clientSecret) {
    return res.status(401).json({
      success: false,
      message: 'Walmart credentials required in headers'
    });
  }

  try {
    // Get access token
    const tokenData = await walmartOrderService.getAccessToken(clientId, clientSecret);
    
    // Fetch order
    const orderResponse = await walmartOrderService.getOrderById(
      tokenData.accessToken,
      orderId
    );

    return res.status(200).json({
      success: true,
      data: orderResponse.order
    });
  } catch (error) {
    console.error('Error fetching Walmart order:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch order',
      error: error.response ? error.response.data : null
    });
  }
});

/**
 * Sync Walmart orders to database
 * @route POST /api/orders/sync/walmart
 * @access Private
 */
const syncWalmartOrders = asyncHandler(async (req, res) => {
  const schema = Joi.object({
    marketplaceId: Joi.string().uuid().required(),
    dateRange: Joi.object({
      startDate: Joi.date().iso(),
      endDate: Joi.date().iso()
    }).default({
      startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
      endDate: new Date()
    }),
    fullSync: Joi.boolean().default(false)
  });

  const { error, value } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({ 
      success: false,
      message: error.details[0].message 
    });
  }

  const { clientid: clientId, clientsecret: clientSecret } = req.headers;
  const userId = req.headers['x-user-id'] || req.user?.id;
  
  if (!clientId || !clientSecret) {
    return res.status(401).json({
      success: false,
      message: 'Walmart credentials required in headers'
    });
  }

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'User ID required'
    });
  }

  const { marketplaceId, dateRange, fullSync } = value;
  const syncResults = {
    added: 0,
    updated: 0,
    errors: 0,
    items: {
      added: 0,
      updated: 0,
      linked: 0,
      unlinked: 0
    }
  };

  try {
    console.log(`Starting Walmart order sync for user ${userId}`);
    
    // Update sync status
    await supabase
      .from('order_sync_status')
      .upsert({
        user_id: userId,
        marketplace_id: marketplaceId,
        status: 'syncing',
        updated_at: new Date()
      }, {
        onConflict: 'user_id,marketplace_id'
      });

    // Get access token
    const tokenData = await walmartOrderService.getAccessToken(clientId, clientSecret);
    
    // Fetch orders with pagination
    let hasMore = true;
    let cursor = null;
    const allOrders = [];

    while (hasMore) {
      const params = {
        createdStartDate: dateRange.startDate.toISOString(),
        createdEndDate: dateRange.endDate.toISOString(),
        limit: 100
      };

      if (cursor) {
        params.cursor = cursor;
      }

      const ordersResponse = await walmartOrderService.getOrders(
        tokenData.accessToken,
        params
      );

      allOrders.push(...ordersResponse.orders);
      
      // Check if there are more pages
      hasMore = ordersResponse.nextCursor ? true : false;
      cursor = ordersResponse.nextCursor;
    }

    console.log(`Fetched ${allOrders.length} orders from Walmart`);

    // Get existing orders from database
    const existingOrderIds = allOrders.map(o => o.purchaseOrderId);
    const { data: existingOrders } = await supabase
      .from('orders')
      .select('id, external_order_id')
      .eq('user_id', userId)
      .eq('marketplace_id', marketplaceId)
      .in('external_order_id', existingOrderIds);

    const existingOrderMap = new Map(
      existingOrders?.map(o => [o.external_order_id, o.id]) || []
    );

    // Get all listings for SKU matching
    const { data: userListings } = await supabase
      .from('listings')
      .select('id, sku, external_id, product_id')
      .eq('user_id', userId)
      .eq('marketplace_id', marketplaceId);

    const skuToListingMap = new Map();
    userListings?.forEach(listing => {
      if (listing.sku) skuToListingMap.set(listing.sku, listing);
      if (listing.external_id) skuToListingMap.set(listing.external_id, listing);
    });

    // Process each order
    for (const walmartOrder of allOrders) {
      try {
        const orderData = walmartOrderService.transformOrderForDB(
          walmartOrder,
          marketplaceId,
          userId
        );

        let orderId;
        
        if (existingOrderMap.has(walmartOrder.purchaseOrderId)) {
          // Update existing order
          orderId = existingOrderMap.get(walmartOrder.purchaseOrderId);
          
          const { error: updateError } = await supabase
            .from('orders')
            .update(orderData)
            .eq('id', orderId);

          if (updateError) throw updateError;
          syncResults.updated++;
        } else {
          // Insert new order
          const { data: newOrder, error: insertError } = await supabase
            .from('orders')
            .insert(orderData)
            .select('id')
            .single();

          if (insertError) throw insertError;
          orderId = newOrder.id;
          syncResults.added++;
        }

        // Process order items
        const orderLines = walmartOrder.orderLines?.orderLine || [];
        
        // Delete existing items if updating
        if (existingOrderMap.has(walmartOrder.purchaseOrderId)) {
          await supabase
            .from('order_items')
            .delete()
            .eq('order_id', orderId);
        }

        for (const orderLine of orderLines) {
          const itemData = walmartOrderService.transformOrderItemForDB(orderLine, orderId);
          
          // Try to match with listing
          const listing = skuToListingMap.get(itemData.sku);
          if (listing) {
            itemData.listing_id = listing.id;
            
            // Get source cost if product exists
            if (listing.product_id) {
              const { data: product } = await supabase
                .from('products')
                .select('current_source_price')
                .eq('id', listing.product_id)
                .single();

              if (product) {
                itemData.source_cost = product.current_source_price || 0;
              }
            }
            syncResults.items.linked++;
          } else {
            syncResults.items.unlinked++;
          }

          const { error: itemError } = await supabase
            .from('order_items')
            .insert(itemData);

          if (itemError) {
            console.error('Error inserting order item:', itemError);
            syncResults.errors++;
          } else {
            syncResults.items.added++;
          }
        }

      } catch (orderError) {
        console.error(`Error processing order ${walmartOrder.purchaseOrderId}:`, orderError);
        syncResults.errors++;
      }
    }

    // Update sync status
    await supabase
      .from('order_sync_status')
      .upsert({
        user_id: userId,
        marketplace_id: marketplaceId,
        status: 'completed',
        last_full_sync: fullSync ? new Date() : undefined,
        last_incremental_sync: !fullSync ? new Date() : undefined,
        total_orders: syncResults.added + syncResults.updated,
        updated_at: new Date()
      }, {
        onConflict: 'user_id,marketplace_id'
      });

    return res.status(200).json({
      success: true,
      message: `Order sync completed successfully`,
      results: syncResults
    });

  } catch (error) {
    console.error('Error syncing Walmart orders:', error);
    
    // Update sync status to error
    await supabase
      .from('order_sync_status')
      .upsert({
        user_id: userId,
        marketplace_id: marketplaceId,
        status: 'error',
        error_message: error.message,
        updated_at: new Date()
      }, {
        onConflict: 'user_id,marketplace_id'
      });

    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to sync orders',
      error: error.response ? error.response.data : null
    });
  }
});

/**
 * Get order sync status
 * @route GET /api/orders/sync-status/:marketplaceId
 * @access Private
 */
const getOrderSyncStatus = asyncHandler(async (req, res) => {
  const { marketplaceId } = req.params;
  const userId = req.headers['x-user-id'] || req.user?.id;
  
  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'User ID required'
    });
  }

  try {
    const { data: syncStatus, error } = await supabase
      .from('order_sync_status')
      .select('*')
      .eq('user_id', userId)
      .eq('marketplace_id', marketplaceId)
      .single();

    if (error && error.code !== 'PGRST116') { // Not found is ok
      throw error;
    }

    return res.status(200).json({
      success: true,
      data: syncStatus || {
        status: 'idle',
        total_orders: 0,
        last_full_sync: null,
        last_incremental_sync: null
      }
    });
  } catch (error) {
    console.error('Error fetching sync status:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch sync status'
    });
  }
});

module.exports = {
  getWalmartOrders,
  getWalmartOrderById,
  syncWalmartOrders,
  getOrderSyncStatus
};