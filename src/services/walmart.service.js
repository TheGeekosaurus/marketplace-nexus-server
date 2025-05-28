const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');

/**
 * Handles token generation and API calls to Walmart Marketplace API
 */
class WalmartService {
  constructor() {
    this.apiUrl = config.walmart.apiUrl;
    this.apiVersion = config.walmart.apiVersion;
    this.tokenUrl = config.walmart.tokenUrl;
  }

  /**
   * Get access token from Walmart API
   * @param {string} clientId - Walmart API client ID
   * @param {string} clientSecret - Walmart API client secret
   * @returns {Promise<string>} - Access token
   */
  async getAccessToken(clientId, clientSecret) {
    try {
      // Create Basic auth header using client ID and secret
      const authString = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const correlationId = uuidv4();

      console.log('Attempting to get Walmart access token');
      console.log('Headers:', {
        'Authorization': `Basic ${authString.substring(0, 10)}...`, // Truncated for security
        'WM_SVC.NAME': 'Walmart Marketplace',
        'WM_QOS.CORRELATION_ID': correlationId,
        'Content-Type': 'application/x-www-form-urlencoded'
      });

      const response = await axios({
        method: 'post',
        url: this.tokenUrl,
        headers: {
          'Authorization': `Basic ${authString}`,
          'WM_SVC.NAME': 'Walmart Marketplace',
          'WM_QOS.CORRELATION_ID': correlationId,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        data: 'grant_type=client_credentials',
        timeout: config.walmart.requestTimeout
      });

      console.log('Token API response status:', response.status);
      
      if (!response.data || !response.data.access_token) {
        console.error('Invalid response from Walmart API:', response.data);
        throw new Error('Invalid response from Walmart API: Missing access_token');
      }

      return {
        accessToken: response.data.access_token,
        tokenType: response.data.token_type,
        expiresIn: response.data.expires_in
      };
    } catch (error) {
      console.error('Error getting Walmart access token:', error.message);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', JSON.stringify(error.response.data, null, 2));
        console.error('Response headers:', JSON.stringify(error.response.headers, null, 2));
      } else if (error.request) {
        console.error('No response received:', error.request);
      }
      throw new Error(`Failed to get Walmart access token: ${error.message}`);
    }
  }

  /**
   * Get token details to verify permissions
   * @param {string} accessToken - Walmart API access token 
   * @returns {Promise<object>} - Token detail information
   */
  async getTokenDetail(accessToken) {
    try {
      const correlationId = uuidv4();
      
      const response = await axios({
        method: 'get',
        url: `${this.apiUrl}/${this.apiVersion}/token/detail`,
        headers: {
          'WM_SEC.ACCESS_TOKEN': accessToken,
          'WM_SVC.NAME': 'Walmart Marketplace',
          'WM_QOS.CORRELATION_ID': correlationId,
          'Accept': 'application/json'
        },
        timeout: config.walmart.requestTimeout
      });

      return response.data;
    } catch (error) {
      console.error('Error getting token details:', error.message);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', JSON.stringify(error.response.data, null, 2));
      }
      throw new Error(`Failed to get token details: ${error.message}`);
    }
  }

  /**
   * Validate the API credentials
   * @param {string} clientId - Walmart API client ID
   * @param {string} clientSecret - Walmart API client secret
   * @returns {Promise<boolean>} - Whether credentials are valid
   */
  async validateCredentials(clientId, clientSecret) {
    try {
      const tokenData = await this.getAccessToken(clientId, clientSecret);
      
      // Optionally verify token by getting token details
      try {
        await this.getTokenDetail(tokenData.accessToken);
      } catch (detailError) {
        console.warn('Could not get token details, but token was generated:', detailError.message);
        // Continue anyway since we got the token successfully
      }
      
      return true;
    } catch (error) {
      console.error('Invalid Walmart credentials:', error.message);
      return false;
    }
  }

  /**
   * Get all listings from Walmart seller account
   * @param {string} accessToken - Walmart API access token
   * @param {object} options - Query parameters for the API call
   * @returns {Promise<object>} - Listings data
   */
  async getListings(accessToken, options = {}) {
    try {
      const { limit = 20, offset = 0, status = 'PUBLISHED' } = options;
      const correlationId = uuidv4();

      const response = await axios({
        method: 'get',
        url: `${this.apiUrl}/${this.apiVersion}/items`,
        headers: {
          'WM_SEC.ACCESS_TOKEN': accessToken,
          'WM_SVC.NAME': 'Walmart Marketplace',
          'WM_QOS.CORRELATION_ID': correlationId,
          'Accept': 'application/json'
        },
        params: {
          limit,
          offset,
          status
        },
        timeout: config.walmart.requestTimeout
      });

      return response.data;
    } catch (error) {
      console.error('Error fetching Walmart listings:', error.message);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', JSON.stringify(error.response.data, null, 2));
      }
      throw new Error(`Failed to fetch Walmart listings: ${error.message}`);
    }
  }

  /**
   * Get a specific listing by ID
   * @param {string} accessToken - Walmart API access token
   * @param {string} itemId - Walmart item ID
   * @returns {Promise<object>} - Listing data
   */
  async getListingById(accessToken, itemId) {
    try {
      const correlationId = uuidv4();
      
      const response = await axios({
        method: 'get',
        url: `${this.apiUrl}/${this.apiVersion}/items/${itemId}`,
        headers: {
          'WM_SEC.ACCESS_TOKEN': accessToken,
          'WM_SVC.NAME': 'Walmart Marketplace',
          'WM_QOS.CORRELATION_ID': correlationId,
          'Accept': 'application/json'
        },
        timeout: config.walmart.requestTimeout
      });

      return response.data;
    } catch (error) {
      console.error(`Error fetching Walmart listing ${itemId}:`, error.message);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', JSON.stringify(error.response.data, null, 2));
      }
      throw new Error(`Failed to fetch Walmart listing ${itemId}: ${error.message}`);
    }
  }

  /**
   * Search Walmart catalog for items
   * @param {string} accessToken - Walmart API access token
   * @param {object} searchParams - Search parameters
   * @returns {Promise<object>} - Search results
   */
  async searchCatalog(accessToken, searchParams) {
    try {
      const correlationId = uuidv4();
      const { query, gtin, upc, itemId, sku, wpid, isbn, ean, productName } = searchParams;
      
      // Build request body - Walmart catalog search uses POST
      const requestBody = {};
      
      // Query parameters (allowed fields according to docs)
      const queryFields = {};
      if (itemId) queryFields.itemId = itemId;
      if (productName) queryFields.productName = productName;
      if (sku) queryFields.sku = sku;
      if (gtin) queryFields.gtin = gtin;
      if (wpid) queryFields.wpid = wpid;
      if (upc) queryFields.upc = upc;
      if (isbn) queryFields.isbn = isbn;
      if (ean) queryFields.ean = ean;
      
      // If we have query fields, add them to the request
      if (Object.keys(queryFields).length > 0) {
        requestBody.query = queryFields;
      }
      
      // Handle legacy query parameter (string query)
      if (query && typeof query === 'string') {
        requestBody.query = { productName: query };
      }
      
      // Ensure we have at least one search parameter
      if (!requestBody.query) {
        throw new Error('At least one query parameter (itemId, productName, sku, gtin, wpid, upc, isbn, ean) is required');
      }
      
      console.log('Walmart catalog search request:', JSON.stringify(requestBody, null, 2));
      
      const response = await axios({
        method: 'post',
        url: `${this.apiUrl}/${this.apiVersion}/items/catalog/search`,
        headers: {
          'WM_SEC.ACCESS_TOKEN': accessToken,
          'WM_SVC.NAME': 'Walmart Marketplace',
          'WM_QOS.CORRELATION_ID': correlationId,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        data: requestBody,
        timeout: config.walmart.requestTimeout
      });

      return response.data;
    } catch (error) {
      console.error('Error searching Walmart catalog:', error.message);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', JSON.stringify(error.response.data, null, 2));
      }
      throw new Error(`Failed to search Walmart catalog: ${error.message}`);
    }
  }

  /**
   * Create an offer for an existing Walmart item
   * @param {string} accessToken - Walmart API access token
   * @param {object} offerData - Offer data including SKU, price, condition, etc
   * @returns {Promise<object>} - Feed response
   */
  async createOffer(accessToken, offerData) {
    try {
      const correlationId = uuidv4();
      
      // Build the feed payload for MP_ITEM_MATCH
      const feedPayload = {
        MPItemFeedHeader: {
          processMode: 'REPLACE',
          subset: 'EXTERNAL',
          locale: 'en',
          sellingChannel: 'marketplace',
          version: '1.0'
        },
        MPItem: [{
          Item: {
            sku: offerData.sku,
            condition: offerData.condition || 'New',
            price: {
              currency: 'USD',
              amount: offerData.price
            },
            shippingWeight: {
              unit: 'LB',
              value: offerData.shippingWeight || 1
            },
            productIdentifiers: {
              productIdType: offerData.productIdType || 'UPC',
              productId: offerData.productId
            }
          }
        }]
      };

      // Add image URL if provided
      if (offerData.mainImageUrl) {
        feedPayload.MPItem[0].Item.mainImageUrl = offerData.mainImageUrl;
      }

      const response = await axios({
        method: 'post',
        url: `${this.apiUrl}/${this.apiVersion}/feeds`,
        headers: {
          'WM_SEC.ACCESS_TOKEN': accessToken,
          'WM_SVC.NAME': 'Walmart Marketplace',
          'WM_QOS.CORRELATION_ID': correlationId,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        params: {
          feedType: 'MP_ITEM_MATCH'
        },
        data: feedPayload,
        timeout: config.walmart.requestTimeout
      });

      return response.data;
    } catch (error) {
      console.error('Error creating Walmart offer:', error.message);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', JSON.stringify(error.response.data, null, 2));
      }
      throw new Error(`Failed to create Walmart offer: ${error.message}`);
    }
  }

  /**
   * Get feed status to check offer creation progress
   * @param {string} accessToken - Walmart API access token
   * @param {string} feedId - Feed ID from createOffer response
   * @returns {Promise<object>} - Feed status
   */
  async getFeedStatus(accessToken, feedId) {
    try {
      const correlationId = uuidv4();
      
      const response = await axios({
        method: 'get',
        url: `${this.apiUrl}/${this.apiVersion}/feeds/${feedId}`,
        headers: {
          'WM_SEC.ACCESS_TOKEN': accessToken,
          'WM_SVC.NAME': 'Walmart Marketplace',
          'WM_QOS.CORRELATION_ID': correlationId,
          'Accept': 'application/json'
        },
        timeout: config.walmart.requestTimeout
      });

      return response.data;
    } catch (error) {
      console.error(`Error getting feed status ${feedId}:`, error.message);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', JSON.stringify(error.response.data, null, 2));
      }
      throw new Error(`Failed to get feed status: ${error.message}`);
    }
  }

  /**
   * Get inventory for a specific SKU
   * @param {string} accessToken - Walmart API access token
   * @param {string} sku - SKU to get inventory for
   * @returns {Promise<object>} - Inventory data
   */
  async getInventory(accessToken, sku) {
    try {
      const correlationId = uuidv4();
      
      const response = await axios({
        method: 'get',
        url: `${this.apiUrl}/${this.apiVersion}/inventory`,
        headers: {
          'WM_SEC.ACCESS_TOKEN': accessToken,
          'WM_SVC.NAME': 'Walmart Marketplace',
          'WM_QOS.CORRELATION_ID': correlationId,
          'Accept': 'application/json'
        },
        params: {
          sku: sku
        },
        timeout: config.walmart.requestTimeout
      });

      return response.data;
    } catch (error) {
      console.error(`Error getting inventory for SKU ${sku}:`, error.message);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', JSON.stringify(error.response.data, null, 2));
      }
      throw new Error(`Failed to get inventory for SKU ${sku}: ${error.message}`);
    }
  }

  /**
   * Update price for a specific SKU
   * @param {string} accessToken - Walmart API access token
   * @param {string} sku - SKU to update price for
   * @param {number} price - New price
   * @returns {Promise<object>} - Update response
   */
  async updatePrice(accessToken, sku, price) {
    try {
      const correlationId = uuidv4();
      
      const payload = {
        sku: sku,
        pricing: [
          {
            currentPriceType: "BASE",
            currentPrice: {
              currency: "USD",
              amount: price
            }
          }
        ]
      };
      
      console.log(`Updating price for SKU ${sku} to $${price}`);
      
      const response = await axios({
        method: 'put',
        url: `${this.apiUrl}/${this.apiVersion}/price`,
        headers: {
          'WM_SEC.ACCESS_TOKEN': accessToken,
          'WM_SVC.NAME': 'Walmart Marketplace',
          'WM_QOS.CORRELATION_ID': correlationId,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        data: payload,
        timeout: config.walmart.requestTimeout
      });

      console.log(`Price update response for SKU ${sku}:`, response.data);
      return response.data;
    } catch (error) {
      console.error(`Error updating price for SKU ${sku}:`, error.message);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', JSON.stringify(error.response.data, null, 2));
      }
      throw new Error(`Failed to update price for SKU ${sku}: ${error.message}`);
    }
  }
}

module.exports = new WalmartService();
