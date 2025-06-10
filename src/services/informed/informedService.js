const axios = require('axios');
const csv = require('csv-parser');
const { Readable } = require('stream');

class InformedService {
  constructor() {
    this.reportsBaseUrl = 'https://api.informed.co/reports';
    this.feedsBaseUrl = 'https://api.informed.co/v1/feed';
  }

  // Helper to create headers with API key
  createHeaders(apiKey) {
    return {
      'x-api-key': apiKey,
      'Content-Type': 'application/json'
    };
  }

  // Reports API Methods
  async requestMissingPricesReport(apiKey) {
    try {
      const response = await axios.get(`${this.reportsBaseUrl}/requestReport`, {
        headers: this.createHeaders(apiKey),
        params: {
          reportType: 'Listings_Without_A_Min_Price'
        }
      });
      
      return response.data;
    } catch (error) {
      console.error('Error requesting missing prices report:', error.response?.data || error.message);
      throw new Error(`Failed to request report: ${error.response?.data?.message || error.message}`);
    }
  }

  async checkReportStatus(apiKey, reportRequestID) {
    try {
      const response = await axios.get(`${this.reportsBaseUrl}/requests/${reportRequestID}`, {
        headers: this.createHeaders(apiKey)
      });
      
      return response.data;
    } catch (error) {
      console.error('Error checking report status:', error.response?.data || error.message);
      throw new Error(`Failed to check report status: ${error.response?.data?.message || error.message}`);
    }
  }

  async downloadReport(downloadLink) {
    try {
      const response = await axios.get(downloadLink, {
        responseType: 'text'
      });
      
      return response.data;
    } catch (error) {
      console.error('Error downloading report:', error.message);
      throw new Error(`Failed to download report: ${error.message}`);
    }
  }

  async parseMissingPricesReport(csvData) {
    return new Promise((resolve, reject) => {
      const results = [];
      const stream = Readable.from([csvData]);
      
      stream
        .pipe(csv())
        .on('data', (row) => {
          results.push({
            sku: row.SKU,
            marketplaceId: row.MARKETPLACE_ID,
            currentPrice: parseFloat(row.CURRENT_PRICE) || 0,
            title: row.TITLE,
            itemId: row.ITEM_ID
          });
        })
        .on('end', () => {
          resolve(results);
        })
        .on('error', (error) => {
          reject(new Error(`Failed to parse CSV: ${error.message}`));
        });
    });
  }

  // Feed Submission API Methods
  async submitCostUpdates(apiKey, updates) {
    const csvData = this.generateCostUpdateCSV(updates);
    return this.submitFeed(apiKey, csvData, 'Set_Cost');
  }

  async submitMinMaxPrices(apiKey, updates) {
    const csvData = this.generateMinMaxPricesCSV(updates);
    return this.submitFeed(apiKey, csvData, 'Set_Min_Max_Prices');
  }

  async submitManualPrices(apiKey, updates) {
    const csvData = this.generateManualPricesCSV(updates);
    return this.submitFeed(apiKey, csvData, 'Set_Manual_Prices');
  }

  async submitFeed(apiKey, csvData, feedType) {
    try {
      const FormData = require('form-data');
      const form = new FormData();
      
      // Create a buffer from CSV data
      const csvBuffer = Buffer.from(csvData, 'utf8');
      form.append('file', csvBuffer, {
        filename: `${feedType}_${Date.now()}.csv`,
        contentType: 'text/csv'
      });

      const response = await axios.post(`${this.feedsBaseUrl}/submissions`, form, {
        headers: {
          'x-api-key': apiKey,
          ...form.getHeaders()
        }
      });
      
      return response.data;
    } catch (error) {
      console.error('Error submitting feed:', error.response?.data || error.message);
      throw new Error(`Failed to submit feed: ${error.response?.data?.message || error.message}`);
    }
  }

  async checkFeedStatus(apiKey, feedSubmissionID) {
    try {
      const response = await axios.get(`${this.feedsBaseUrl}/submissions/${feedSubmissionID}`, {
        headers: this.createHeaders(apiKey)
      });
      
      return response.data;
    } catch (error) {
      console.error('Error checking feed status:', error.response?.data || error.message);
      throw new Error(`Failed to check feed status: ${error.response?.data?.message || error.message}`);
    }
  }

  // CSV Generation Methods
  generateCostUpdateCSV(updates) {
    const headers = 'SKU,COST,CURRENCY\n';
    const rows = updates.map(update => 
      `${update.sku},${update.cost},USD`
    ).join('\n');
    
    return headers + rows;
  }

  generateMinMaxPricesCSV(updates) {
    const headers = 'SKU,MARKETPLACE_ID,MIN_PRICE,MAX_PRICE\n';
    const rows = updates.map(update => 
      `${update.sku},${update.marketplaceId},${update.minPrice},${update.maxPrice || ''}`
    ).join('\n');
    
    return headers + rows;
  }

  generateManualPricesCSV(updates) {
    const headers = 'SKU,MARKETPLACE_ID,MANUAL_PRICE\n';
    const rows = updates.map(update => 
      `${update.sku},${update.marketplaceId},${update.manualPrice}`
    ).join('\n');
    
    return headers + rows;
  }

  // Data Processing Helpers
  mapOurSkuToInformed(listing, marketplace) {
    // Walmart: use external_id (Walmart Item ID)
    // Amazon: use sku (ASIN)
    if (marketplace.name === 'Walmart') {
      return listing.external_id;
    } else if (marketplace.name === 'Amazon') {
      return listing.sku;
    }
    return null;
  }

  calculateCostAndMinPrice(listing, product, userSettings = {}) {
    const baseCost = parseFloat(product.base_price) || 0;
    const shippingCost = parseFloat(product.shipping_cost) || 0;
    const cost = baseCost + shippingCost;
    
    const marketplaceFee = parseFloat(listing.marketplace_fee_percentage) || 15;
    const minProfitMargin = parseFloat(userSettings.minimum_profit_margin) || 10;
    
    // Calculate minimum price: cost + marketplace fees + minimum profit
    const feeAmount = cost * (marketplaceFee / 100);
    const minPrice = cost + feeAmount + minProfitMargin;
    
    // Calculate reasonable max price (20% above min price)
    const maxPrice = minPrice * 1.2;
    
    return {
      cost: parseFloat(cost.toFixed(2)),
      minPrice: parseFloat(minPrice.toFixed(2)),
      maxPrice: parseFloat(maxPrice.toFixed(2))
    };
  }

  // Poll for report completion with exponential backoff
  async pollReportCompletion(apiKey, reportRequestID, maxAttempts = 20) {
    let attempt = 0;
    
    while (attempt < maxAttempts) {
      const status = await this.checkReportStatus(apiKey, reportRequestID);
      
      if (status.status === 'Complete') {
        return status;
      } else if (status.status === 'Error') {
        throw new Error('Report generation failed');
      }
      
      // Exponential backoff: 30s, 60s, 120s, 240s, then 300s (5 min)
      const delay = Math.min(30 * Math.pow(2, attempt), 300) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
      attempt++;
    }
    
    throw new Error('Report generation timed out');
  }

  // Poll for feed completion
  async pollFeedCompletion(apiKey, feedSubmissionID, maxAttempts = 10) {
    let attempt = 0;
    
    while (attempt < maxAttempts) {
      const status = await this.checkFeedStatus(apiKey, feedSubmissionID);
      
      if (['Completed', 'CompletedWithErrors'].includes(status.status)) {
        return status;
      } else if (status.status === 'Error') {
        throw new Error('Feed processing failed');
      }
      
      // Wait 60 seconds between checks
      await new Promise(resolve => setTimeout(resolve, 60000));
      attempt++;
    }
    
    throw new Error('Feed processing timed out');
  }
}

module.exports = new InformedService();