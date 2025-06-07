const { createClient } = require('@supabase/supabase-js');

class AuditService {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }

  /**
   * Log a generic event
   * @param {Object} params Event parameters
   * @param {string} params.eventType Type of event
   * @param {Object} params.eventData Event data payload
   * @param {string} params.userId User ID
   * @param {string|null} params.listingId Listing ID (optional)
   * @param {string|null} params.productId Product ID (optional)
   */
  async logEvent({ eventType, eventData, userId, listingId = null, productId = null }) {
    try {
      const { data, error } = await this.supabase.rpc('create_listing_log', {
        p_listing_id: listingId,
        p_product_id: productId,
        p_user_id: userId,
        p_event_type: eventType,
        p_event_data: eventData
      });

      if (error) {
        console.error('Audit log error:', error);
        // Don't throw - logging failures shouldn't break operations
      }

      return { success: !error, data, error };
    } catch (error) {
      console.error('Audit service error:', error);
      return { success: false, error };
    }
  }

  /**
   * Log product refresh event
   */
  async logProductRefresh(productId, userId, oldData, newData, listingIds = []) {
    const eventData = {
      old_price: oldData.price,
      new_price: newData.price,
      old_stock: oldData.stockLevel,
      new_stock: newData.stockLevel,
      source_url: oldData.sourceUrl,
      price_changed: oldData.price !== newData.price,
      stock_changed: oldData.stockLevel !== newData.stockLevel
    };

    // If listing IDs provided, create log for each listing
    if (listingIds && listingIds.length > 0) {
      const results = [];
      for (const listingId of listingIds) {
        const result = await this.logEvent({
          eventType: 'product_refreshed',
          eventData,
          userId,
          productId,
          listingId
        });
        results.push(result);
      }
      return results;
    }

    // Fallback to old behavior (product-level log without listing ID)
    return this.logEvent({
      eventType: 'product_refreshed',
      eventData,
      userId,
      productId
    });
  }

  /**
   * Log automatic repricing event
   */
  async logRepricing(listingId, productId, userId, oldPrice, newPrice, marketplace, reason) {
    return this.logEvent({
      eventType: 'repricing_applied',
      eventData: {
        old_price: oldPrice,
        new_price: newPrice,
        marketplace,
        reason,
        price_difference: newPrice - oldPrice,
        percentage_change: ((newPrice - oldPrice) / oldPrice * 100).toFixed(2)
      },
      userId,
      listingId,
      productId
    });
  }

  /**
   * Log price update error
   */
  async logPriceUpdateError(listingId, productId, userId, attemptedPrice, marketplace, error) {
    return this.logEvent({
      eventType: 'price_update_error',
      eventData: {
        attempted_price: attemptedPrice,
        marketplace,
        error: error.message || 'Unknown error',
        error_code: error.code,
        timestamp: new Date().toISOString()
      },
      userId,
      listingId,
      productId
    });
  }

  /**
   * Log product creation from source
   */
  async logProductCreation(productId, userId, source, sourceUrl, identifiers) {
    return this.logEvent({
      eventType: 'product_created',
      eventData: {
        source,
        source_url: sourceUrl,
        identifiers,
        created_at: new Date().toISOString()
      },
      userId,
      productId
    });
  }

  /**
   * Log listing sync event
   */
  async logListingSync(listingId, productId, userId, marketplace, action, details) {
    return this.logEvent({
      eventType: `listing_sync_${action}`,
      eventData: {
        marketplace,
        action,
        ...details,
        synced_at: new Date().toISOString()
      },
      userId,
      listingId,
      productId
    });
  }

  /**
   * Log bulk operation
   */
  async logBulkOperation(userId, operation, affectedCount, details) {
    return this.logEvent({
      eventType: `bulk_${operation}`,
      eventData: {
        affected_count: affectedCount,
        ...details,
        executed_at: new Date().toISOString()
      },
      userId
    });
  }
}

// Export singleton instance
module.exports = new AuditService();