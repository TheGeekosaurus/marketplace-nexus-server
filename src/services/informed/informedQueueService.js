const { createClient } = require('@supabase/supabase-js');

class InformedQueueService {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }

  /**
   * Check if user has active Informed.co integration
   */
  async hasActiveIntegration(userId) {
    try {
      const { data: integration } = await this.supabase
        .from('third_party_integrations')
        .select('id, is_active')
        .eq('user_id', userId)
        .eq('integration_type', 'informed_co')
        .eq('is_active', true)
        .single();

      return !!integration;
    } catch (error) {
      console.error('Error checking Informed.co integration:', error);
      return false;
    }
  }

  /**
   * Queue price updates for Informed.co when source product prices change
   */
  async queuePriceUpdate(listingId, userId, updateType, priceData) {
    try {
      // Check if user has active integration
      const hasIntegration = await this.hasActiveIntegration(userId);
      if (!hasIntegration) {
        console.log(`User ${userId} doesn't have active Informed.co integration, skipping queue`);
        return false;
      }

      const queueData = {
        user_id: userId,
        listing_id: listingId,
        update_type: updateType,
        processed: false,
        created_at: new Date().toISOString()
      };

      // Add specific price data based on update type
      if (updateType === 'cost_change') {
        queueData.old_cost = priceData.oldCost;
        queueData.new_cost = priceData.newCost;
      } else if (updateType === 'price_change') {
        queueData.old_min_price = priceData.oldMinPrice;
        queueData.new_min_price = priceData.newMinPrice;
      }

      const { error } = await this.supabase
        .from('informed_price_updates_queue')
        .insert(queueData);

      if (error) {
        console.error('Error queuing Informed.co price update:', error);
        return false;
      }

      console.log(`Queued Informed.co ${updateType} for listing ${listingId}`);
      return true;
    } catch (error) {
      console.error('Error in queuePriceUpdate:', error);
      return false;
    }
  }

  /**
   * Queue cost updates for all listings of a product when source price changes
   */
  async queueCostUpdatesForProduct(productId, userId, oldPrice, newPrice) {
    try {
      // Check if user has active integration
      const hasIntegration = await this.hasActiveIntegration(userId);
      if (!hasIntegration) {
        return false;
      }

      // Get all listings for this product
      const { data: listings, error: listingsError } = await this.supabase
        .from('listings')
        .select('id, base_price, shipping_cost')
        .eq('product_id', productId)
        .eq('user_id', userId);

      if (listingsError || !listings) {
        console.error('Error fetching listings for product:', listingsError);
        return false;
      }

      // Calculate cost changes for each listing
      const queuePromises = listings.map(listing => {
        const oldCost = (oldPrice || 0) + (listing.shipping_cost || 0);
        const newCost = (newPrice || 0) + (listing.shipping_cost || 0);

        return this.queuePriceUpdate(listing.id, userId, 'cost_change', {
          oldCost,
          newCost
        });
      });

      const results = await Promise.allSettled(queuePromises);
      const successful = results.filter(r => r.status === 'fulfilled' && r.value === true).length;

      console.log(`Queued cost updates for ${successful}/${listings.length} listings of product ${productId}`);
      return successful > 0;
    } catch (error) {
      console.error('Error in queueCostUpdatesForProduct:', error);
      return false;
    }
  }

  /**
   * Queue min price updates when listing pricing changes
   */
  async queueMinPriceUpdatesForListing(listingId, userId, oldMinPrice, newMinPrice) {
    try {
      // Check if user has active integration
      const hasIntegration = await this.hasActiveIntegration(userId);
      if (!hasIntegration) {
        return false;
      }

      return this.queuePriceUpdate(listingId, userId, 'price_change', {
        oldMinPrice,
        newMinPrice
      });
    } catch (error) {
      console.error('Error in queueMinPriceUpdatesForListing:', error);
      return false;
    }
  }

  /**
   * Calculate minimum price for a listing (reuse existing logic)
   */
  calculateMinPrice(baseCost, shippingCost, marketplaceFee, minProfitMargin) {
    const totalCost = (baseCost || 0) + (shippingCost || 0);
    const feeAmount = totalCost * ((marketplaceFee || 15) / 100);
    return totalCost + feeAmount + (minProfitMargin || 10);
  }

  /**
   * Process product refresh changes and queue appropriate updates
   */
  async processProductRefreshChanges(productId, userId, oldData, newData, listingIds) {
    try {
      if (!listingIds || listingIds.length === 0) {
        return false;
      }

      // Check if price changed
      if (oldData.price !== newData.price) {
        console.log(`Product ${productId} price changed: ${oldData.price} -> ${newData.price}`);
        
        // Queue cost updates for all listings
        await this.queueCostUpdatesForProduct(productId, userId, oldData.price, newData.price);
        
        // Also calculate and queue new min prices
        for (const listingId of listingIds) {
          // Get listing details to calculate new min price
          const { data: listing } = await this.supabase
            .from('listings')
            .select('marketplace_fee_percentage, shipping_cost')
            .eq('id', listingId)
            .single();

          if (listing) {
            const oldMinPrice = this.calculateMinPrice(
              oldData.price, 
              listing.shipping_cost, 
              listing.marketplace_fee_percentage, 
              10 // default min profit
            );
            
            const newMinPrice = this.calculateMinPrice(
              newData.price, 
              listing.shipping_cost, 
              listing.marketplace_fee_percentage, 
              10 // default min profit
            );

            await this.queueMinPriceUpdatesForListing(listingId, userId, oldMinPrice, newMinPrice);
          }
        }
      }

      return true;
    } catch (error) {
      console.error('Error processing product refresh changes for Informed.co:', error);
      return false;
    }
  }
}

module.exports = new InformedQueueService();