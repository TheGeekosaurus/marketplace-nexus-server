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
   * DEPRECATED: Queue methods removed - now using daily sync only
   * These methods are kept as no-ops to prevent breaking existing code
   */
  async queuePriceUpdate(listingId, userId, updateType, priceData) {
    console.log(`[INFORMED] Skipping queue for ${updateType} - using daily sync only`);
    return false;
  }

  async queueCostUpdatesForProduct(productId, userId, oldPrice, newPrice) {
    console.log(`[INFORMED] Skipping cost queue for product ${productId} - using daily sync only`);
    return false;
  }

  async queueMinPriceUpdatesForListing(listingId, userId, oldMinPrice, newMinPrice) {
    console.log(`[INFORMED] Skipping price queue for listing ${listingId} - using daily sync only`);
    return false;
  }

  async processProductRefreshChanges(productId, userId, oldData, newData, listingIds) {
    console.log(`[INFORMED] Skipping refresh queue for product ${productId} - using daily sync only`);
    return false;
  }
}

module.exports = new InformedQueueService();