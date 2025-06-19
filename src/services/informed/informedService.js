const axios = require('axios');
const csv = require('csv-parser');
const { Readable } = require('stream');

class InformedService {
  constructor() {
    this.reportsBaseUrl = 'https://api.informed.co/reports';
    this.feedsBaseUrl = 'https://api.informed.co/v1/feed';
  }

  // Helper to create headers for GET requests
  createGetHeaders(apiKey) {
    return {
      'x-api-key': apiKey,
      'accept': 'application/json'
    };
  }

  // Helper to create headers for POST requests
  createPostHeaders(apiKey, contentType = 'application/json') {
    return {
      'x-api-key': apiKey,
      'accept': 'application/json',
      'Content-Type': contentType
    };
  }

  // Reports API Methods
  async requestMissingPricesReport(apiKey) {
    try {
      const response = await axios.get(`${this.reportsBaseUrl}/requestReport`, {
        headers: this.createGetHeaders(apiKey),
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
      const url = `${this.reportsBaseUrl}/requests/${reportRequestID}`;
      const headers = this.createGetHeaders(apiKey);
      
      console.log('Making request to:', url);
      console.log('Headers:', { ...headers, 'x-api-key': '[REDACTED]' });
      console.log('Report ID:', reportRequestID);
      
      const response = await axios.get(url, { headers });
      
      console.log('Response status:', response.status);
      console.log('Response data:', response.data);
      
      return response.data;
    } catch (error) {
      console.error('Error checking report status:');
      console.error('URL:', `${this.reportsBaseUrl}/requests/${reportRequestID}`);
      console.error('Headers:', { ...this.createGetHeaders(apiKey), 'x-api-key': '[REDACTED]' });
      console.error('Error response:', error.response?.data);
      console.error('Error status:', error.response?.status);
      console.error('Error message:', error.message);
      throw new Error(`Failed to check report status: ${error.response?.status} - ${error.response?.data?.message || error.message}`);
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
            itemId: row.ITEM_ID,
            title: row.TITLE,
            marketplaceId: row.MARKETPLACE_ID,
            minPrice: parseFloat(row.MIN_PRICE) || 0,
            stock: parseInt(row.STOCK) || 0,
            createdDate: row.CREATED_DATE
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
  async submitPriceUpdates(apiKey, updates) {
    const csvData = this.generatePriceUpdateCSV(updates);
    return this.submitFeed(apiKey, csvData);
  }

  async submitFeed(apiKey, csvData) {
    try {
      const response = await axios.post(this.feedsBaseUrl, csvData, {
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'text/csv',
          'accept': 'application/json'
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
      const response = await axios.get(`${this.feedsBaseUrl}/${feedSubmissionID}`, {
        headers: this.createGetHeaders(apiKey)
      });
      
      return response.data;
    } catch (error) {
      console.error('Error checking feed status:', error.response?.data || error.message);
      throw new Error(`Failed to check feed status: ${error.response?.data?.message || error.message}`);
    }
  }

  // CSV Generation Method
  generatePriceUpdateCSV(updates) {
    const headers = 'SKU,COST,CURRENCY,MIN_PRICE,CURRENT_SHIPPING,MARKETPLACE_ID\n';
    const rows = updates.map(update => 
      `${update.sku},${update.cost},USD,${update.minPrice},${update.shippingCost || ''},${update.marketplaceId}`
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
      
      if (status.Status === 'Complete') {
        return status;
      } else if (status.Status === 'Error') {
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