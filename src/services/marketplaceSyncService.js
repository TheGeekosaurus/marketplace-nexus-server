const { createClient } = require('@supabase/supabase-js');
const walmartService = require('./walmart.service');
const amazonService = require('./amazonService');
const auditService = require('./audit/auditService');
const { simplifyWalmartItem } = require('../utils/walmart.utils');

class MarketplaceSyncService {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }

  /**
   * Sync Walmart listings to database
   */
  async syncWalmartListings(userId, marketplaceId, credentials) {
    const syncId = `walmart_${Date.now()}`;
    console.log(`[WALMART_SYNC:${syncId}] ========== SYNC INITIATED ==========`);
    console.log(`[WALMART_SYNC:${syncId}] Config:`, {
      userId,
      marketplaceId,
      timestamp: new Date().toISOString()
    });
    
    const result = { added: 0, updated: 0, errors: 0, notFound: 0 };
    
    try {
      // Get access token
      const tokenData = await walmartService.getAccessToken(
        credentials.clientId, 
        credentials.clientSecret
      );

      // Get all existing listings from database for comparison
      const { data: existingListings } = await this.supabase
        .from('listings')
        .select('id, external_id, last_synced_at, product_id')
        .eq('marketplace_id', marketplaceId)
        .eq('user_id', userId);

      const existingMap = new Map(
        existingListings?.map(l => [l.external_id, l]) || []
      );

      // Fetch all listings from Walmart API (paginated)
      console.log(`[WALMART_SYNC:${syncId}] Starting API pagination...`);
      let offset = 0;
      const limit = 50;
      let hasMore = true;
      const allWalmartListings = [];
      let pageCount = 0;

      while (hasMore) {
        pageCount++;
        console.log(`[WALMART_SYNC:${syncId}] Fetching page ${pageCount} (offset: ${offset})...`);
        
        const listings = await walmartService.getListings(tokenData.accessToken, {
          limit,
          offset,
          status: 'PUBLISHED'
        });

        const items = listings.ItemResponse || [];
        const formattedItems = items.map(item => simplifyWalmartItem(item));
        allWalmartListings.push(...formattedItems);

        console.log(`[WALMART_SYNC:${syncId}] Page ${pageCount} response:`, {
          count: formattedItems.length,
          totalCount: listings.totalItems,
          hasMore: items.length === limit && allWalmartListings.length < (listings.totalItems || 0)
        });
        
        hasMore = items.length === limit && allWalmartListings.length < (listings.totalItems || 0);
        offset += limit;
      }
      
      console.log(`[WALMART_SYNC:${syncId}] Total listings fetched: ${allWalmartListings.length}`);

      // Process each listing
      console.log(`[WALMART_SYNC:${syncId}] Processing ${allWalmartListings.length} listings...`);
      
      for (const walmartListing of allWalmartListings) {
        try {
          const existingListing = existingMap.get(walmartListing.sku);

          if (existingListing) {
            // Update existing listing (preserve marketplace_fee_percentage and current_stock_level)
            const { error } = await this.supabase
              .from('listings')
              .update({
                title: walmartListing.productName,
                price: walmartListing.price,
                // NOTE: current_stock_level is intentionally NOT updated here - background inventory sync is authoritative
                // NOTE: is_available will be updated by background inventory sync based on actual stock levels
                status: walmartListing.publishedStatus === 'PUBLISHED' ? 'active' : 'inactive',
                upc: walmartListing.upc || walmartListing.gtin || null,
                external_data: walmartListing,
                last_synced_at: new Date().toISOString(),
                sync_status: 'synced'
                // NOTE: marketplace_fee_percentage is intentionally NOT updated to preserve user settings
              })
              .eq('id', existingListing.id);

            if (error) throw error;
            result.updated++;

            // Log listing sync
            await this.createListingLog(
              existingListing.id,
              existingListing.product_id || null,
              userId,
              'listing_synced',
              {
                sku: walmartListing.sku,
                price: walmartListing.price,
                stock: walmartListing.inventoryCount,
                status: walmartListing.publishedStatus,
                marketplace: 'Walmart',
                source: 'marketplace_sync'
              }
            );

            // Remove from map to track what's left
            existingMap.delete(walmartListing.sku);
          } else {
            // Create new listing without product_id (marketplace-only listing)
            const { data, error } = await this.supabase
              .from('listings')
              .insert({
                external_id: walmartListing.sku,
                sku: walmartListing.sku,
                title: walmartListing.productName,
                price: walmartListing.price,
                // NOTE: current_stock_level will be set by background inventory sync
                // NOTE: is_available will be set by background inventory sync
                status: walmartListing.publishedStatus === 'PUBLISHED' ? 'active' : 'inactive',
                marketplace_id: marketplaceId,
                user_id: userId,
                product_id: null, // Explicitly set to null for marketplace-only listings
                images: walmartListing.imageUrl ? [walmartListing.imageUrl] : [],
                upc: walmartListing.upc || walmartListing.gtin || null,
                external_data: walmartListing,
                last_synced_at: new Date().toISOString(),
                sync_status: 'synced'
              })
              .select();

            if (error) throw error;
            result.added++;

            // Log new listing creation
            if (data && data[0]) {
              await this.createListingLog(
                data[0].id,
                null, // No product_id for marketplace-only listings
                userId,
                'listing_created',
                {
                  sku: walmartListing.sku,
                  title: walmartListing.productName,
                  price: walmartListing.price,
                  stock: walmartListing.inventoryCount,
                  marketplace: 'Walmart',
                  source: 'marketplace_sync'
                }
              );
            }
          }
        } catch (error) {
          console.error(`Error processing listing ${walmartListing.sku}:`, error);
          result.errors++;
        }
      }

      // Mark listings not found in API as 'not_found'
      const notFoundListings = Array.from(existingMap.values());
      for (const listing of notFoundListings) {
        try {
          const { error } = await this.supabase
            .from('listings')
            .update({
              sync_status: 'not_found',
              last_synced_at: new Date().toISOString()
            })
            .eq('id', listing.id);

          if (error) throw error;
          result.notFound++;
        } catch (error) {
          console.error(`Error marking listing ${listing.id} as not found:`, error);
          result.errors++;
        }
      }

      // Update sync status
      await this.updateSyncStatus(userId, marketplaceId, 'completed', {
        totalListings: allWalmartListings.length
      });

      // Start background inventory sync
      this.syncWalmartInventoryInBackground(credentials, marketplaceId, userId, allWalmartListings.map(l => l.sku));

      console.log(`[WALMART_SYNC:${syncId}] ========== SYNC COMPLETED ==========`);
      console.log(`[WALMART_SYNC:${syncId}] Results:`, result);
      
      return {
        success: true,
        userId,
        marketplaceId,
        results: result,
        totalSynced: allWalmartListings.length
      };
    } catch (error) {
      console.error(`[WALMART_SYNC:${syncId}] ========== SYNC FAILED ==========`);
      console.error(`[WALMART_SYNC:${syncId}] Error:`, error);
      
      // Update sync status to error
      await this.updateSyncStatus(userId, marketplaceId, 'error', {
        errorMessage: error instanceof Error ? error.message : 'Unknown error'
      });

      throw error;
    }
  }

  /**
   * Sync Amazon listings to database
   */
  async syncAmazonListings(userId, marketplaceId, connection) {
    const syncId = `amazon_${Date.now()}`;
    console.log(`[AMAZON_SYNC:${syncId}] ========== SYNC INITIATED ==========`);
    console.log(`[AMAZON_SYNC:${syncId}] Config:`, {
      userId,
      marketplaceId,
      hasRefreshToken: !!connection.refreshToken,
      sellerId: connection.sellerId,
      timestamp: new Date().toISOString()
    });
    
    const result = { added: 0, updated: 0, errors: 0, notFound: 0 };
    
    try {
      // Get all existing listings from database for comparison
      const { data: existingListings, error: dbError } = await this.supabase
        .from('listings')
        .select('id, external_id, last_synced_at, product_id')
        .eq('marketplace_id', marketplaceId)
        .eq('user_id', userId);

      if (dbError) {
        console.error('Database error fetching existing listings:', dbError);
        throw dbError;
      }

      console.log(`Found ${existingListings?.length || 0} existing listings in database`);

      const existingMap = new Map(
        existingListings?.map(l => [l.external_id, l]) || []
      );

      // Fetch all listings from Amazon API
      console.log('Starting Amazon API sync...');
      const amazonResult = await amazonService.getListings(connection.refreshToken, connection.sellerId, {
        reportType: 'GET_MERCHANT_LISTINGS_ALL_DATA'
      });

      if (!amazonResult.success) {
        throw new Error('Amazon API returned success=false');
      }

      const allAmazonListings = amazonResult.data;
      console.log(`[AMAZON_SYNC:${syncId}] Total listings fetched: ${allAmazonListings.length}`);

      // Process each listing
      console.log(`[AMAZON_SYNC:${syncId}] Processing ${allAmazonListings.length} listings...`);
      
      for (const amazonListing of allAmazonListings) {
        try {
          const existingListing = existingMap.get(amazonListing.asin);

          if (existingListing) {
            // Update existing listing (preserve marketplace_fee_percentage and images)
            const { error } = await this.supabase
              .from('listings')
              .update({
                title: amazonListing.productName,
                price: amazonListing.price,
                current_stock_level: amazonListing.quantity,
                is_available: amazonListing.quantity > 0,
                status: amazonListing.status === 'ACTIVE' ? 'active' : 'inactive',
                // NOTE: images intentionally NOT updated to preserve manual image settings
                description: amazonListing.description || null,
                external_data: amazonListing,
                last_synced_at: new Date().toISOString(),
                sync_status: 'synced'
                // NOTE: marketplace_fee_percentage is intentionally NOT updated to preserve user settings
              })
              .eq('id', existingListing.id);

            if (error) {
              console.error(`- Error updating listing: ${error.message}`);
              throw error;
            }
            
            result.updated++;

            // Log listing sync
            await this.createListingLog(
              existingListing.id,
              existingListing.product_id || null,
              userId,
              'listing_synced',
              {
                asin: amazonListing.asin,
                sku: amazonListing.sku,
                price: amazonListing.price,
                stock: amazonListing.quantity,
                status: amazonListing.status,
                marketplace: 'Amazon',
                source: 'marketplace_sync'
              }
            );

            // Remove from map to track what's left
            existingMap.delete(amazonListing.asin);
          } else {
            // Create new listing without product_id (marketplace-only listing)
            const { data, error } = await this.supabase
              .from('listings')
              .insert({
                external_id: amazonListing.asin,
                sku: amazonListing.sku,
                title: amazonListing.productName,
                price: amazonListing.price,
                current_stock_level: amazonListing.quantity,
                is_available: amazonListing.quantity > 0,
                status: amazonListing.status === 'ACTIVE' ? 'active' : 'inactive',
                marketplace_id: marketplaceId,
                user_id: userId,
                product_id: null,
                images: amazonListing.imageUrl ? [amazonListing.imageUrl] : [],
                description: amazonListing.description || null,
                external_data: amazonListing,
                last_synced_at: new Date().toISOString(),
                sync_status: 'synced'
              })
              .select();

            if (error) {
              console.error(`- Error creating listing: ${error.message}`);
              throw error;
            }
            
            result.added++;

            // Log new listing creation
            if (data && data[0]) {
              await this.createListingLog(
                data[0].id,
                null, // No product_id for marketplace-only listings
                userId,
                'listing_created',
                {
                  asin: amazonListing.asin,
                  sku: amazonListing.sku,
                  title: amazonListing.productName,
                  price: amazonListing.price,
                  stock: amazonListing.quantity,
                  marketplace: 'Amazon',
                  source: 'marketplace_sync'
                }
              );
            }
          }
        } catch (error) {
          console.error(`Error processing listing ${amazonListing.sku} (ASIN: ${amazonListing.asin}):`, error);
          result.errors++;
        }
      }

      // Mark listings not found in API as 'not_found'
      const notFoundListings = Array.from(existingMap.values());
      console.log(`Marking ${notFoundListings.length} listings as not found`);
      
      for (const listing of notFoundListings) {
        try {
          const { error } = await this.supabase
            .from('listings')
            .update({
              sync_status: 'not_found',
              last_synced_at: new Date().toISOString()
            })
            .eq('id', listing.id);

          if (error) throw error;
          result.notFound++;
        } catch (error) {
          console.error(`Error marking listing ${listing.id} as not found:`, error);
          result.errors++;
        }
      }

      // Update sync status
      await this.updateSyncStatus(userId, marketplaceId, 'completed', {
        totalListings: allAmazonListings.length
      });

      console.log(`[AMAZON_SYNC:${syncId}] ========== SYNC COMPLETED ==========`);
      console.log(`[AMAZON_SYNC:${syncId}] Results:`, result);

      return {
        success: true,
        userId,
        marketplaceId,
        results: result,
        totalSynced: allAmazonListings.length
      };
    } catch (error) {
      console.error(`[AMAZON_SYNC:${syncId}] ========== SYNC FAILED ==========`);
      console.error(`[AMAZON_SYNC:${syncId}] Error:`, {
        message: error.message,
        stack: error.stack
      });
      
      // Update sync status to error
      await this.updateSyncStatus(userId, marketplaceId, 'error', {
        errorMessage: error instanceof Error ? error.message : 'Unknown error'
      });

      throw error;
    }
  }

  /**
   * Update marketplace sync status
   */
  async updateSyncStatus(userId, marketplaceId, status, additionalData = {}) {
    const updateData = {
      status,
      updated_at: new Date().toISOString()
    };

    if (additionalData.totalListings !== undefined) {
      updateData.total_listings = additionalData.totalListings;
    }
    if (additionalData.lastFullSync) {
      updateData.last_full_sync = additionalData.lastFullSync;
    }
    if (additionalData.errorMessage) {
      updateData.error_message = additionalData.errorMessage;
    }

    // Upsert sync status record
    const { error } = await this.supabase
      .from('marketplace_sync_status')
      .upsert({
        user_id: userId,
        marketplace_id: marketplaceId,
        ...updateData
      }, {
        onConflict: 'user_id,marketplace_id'
      });

    if (error) {
      console.error('Error updating sync status:', error);
    }
  }

  /**
   * Create listing log using Supabase RPC
   */
  async createListingLog(listingId, productId, userId, eventType, eventData) {
    try {
      const { error } = await this.supabase.rpc('create_listing_log', {
        p_listing_id: listingId,
        p_product_id: productId,
        p_user_id: userId,
        p_event_type: eventType,
        p_event_data: eventData
      });

      if (error) {
        console.error('Error creating listing log:', error);
      }
    } catch (error) {
      console.error('Error calling create_listing_log RPC:', error);
    }
  }

  /**
   * Background inventory sync for Walmart listings
   */
  async syncWalmartInventoryInBackground(credentials, marketplaceId, userId, skus) {
    // Run in background, don't await
    (async () => {
      const inventorySyncId = Date.now().toString().substring(-8);
      
      try {
        console.log(`[INVENTORY_SYNC:${inventorySyncId}] ========== BACKGROUND INVENTORY SYNC INITIATED ==========`);
        console.log(`[INVENTORY_SYNC:${inventorySyncId}] Processing ${skus.length} SKUs for inventory updates`);
        
        // Get access token
        const tokenData = await walmartService.getAccessToken(
          credentials.clientId, 
          credentials.clientSecret
        );

        let successCount = 0;
        let errorCount = 0;
        
        // Process SKUs one by one with a small delay to respect rate limits
        for (let i = 0; i < skus.length; i++) {
          const sku = skus[i];
          try {
            console.log(`[INVENTORY_SYNC:${inventorySyncId}] Processing SKU ${i + 1}/${skus.length}: ${sku}`);
            
            // Get inventory for this SKU
            const inventory = await walmartService.getInventory(tokenData.accessToken, sku);
            const stockLevel = inventory.quantity?.amount || 0;
            
            // Update the listing with actual inventory count (AUTHORITATIVE UPDATE)
            const { error } = await this.supabase
              .from('listings')
              .update({
                current_stock_level: stockLevel,
                is_available: stockLevel > 0
              })
              .eq('external_id', sku)
              .eq('marketplace_id', marketplaceId)
              .eq('user_id', userId);

            if (error) {
              console.error(`[INVENTORY_SYNC:${inventorySyncId}] Database update failed for SKU ${sku}:`, error);
              errorCount++;
            } else {
              successCount++;
              console.log(`[INVENTORY_SYNC:${inventorySyncId}] Updated SKU ${sku}: stock=${stockLevel}, available=${stockLevel > 0}`);
              
              // Log stock update only on successful database update
              const { data: listing } = await this.supabase
                .from('listings')
                .select('id, product_id')
                .eq('external_id', sku)
                .eq('marketplace_id', marketplaceId)
                .eq('user_id', userId)
                .single();

              if (listing) {
                await this.createListingLog(
                  listing.id,
                  listing.product_id || null,
                  userId,
                  'stock_updated',
                  {
                    sku: sku,
                    new_stock: stockLevel,
                    marketplace: 'Walmart',
                    source: 'background_sync'
                  }
                );
              }
            }
          } catch (error) {
            console.error(`[INVENTORY_SYNC:${inventorySyncId}] Error processing SKU ${sku}:`, error);
            errorCount++;
          }

          // Small delay to avoid rate limiting (300 TPM = 5 per second, so 200ms between requests)
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        
        console.log(`[INVENTORY_SYNC:${inventorySyncId}] ========== BACKGROUND INVENTORY SYNC COMPLETED ==========`);
        console.log(`[INVENTORY_SYNC:${inventorySyncId}] Results: ${successCount} successful, ${errorCount} errors`);
        
      } catch (error) {
        console.error(`[INVENTORY_SYNC:${inventorySyncId}] ========== BACKGROUND INVENTORY SYNC FAILED ==========`);
        console.error(`[INVENTORY_SYNC:${inventorySyncId}] Fatal error:`, error);
      }
    })();
  }
}

// Export singleton instance
module.exports = new MarketplaceSyncService();