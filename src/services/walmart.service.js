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
   * Extract WPID from Walmart URL
   * @param {string} url - Walmart product URL
   * @returns {string|null} - WPID or null if not found
   */
  extractWalmartWPID(url) {
    const match = url.match(/\/ip\/[^\/]+\/(\d+)/);
    return match ? match[1] : null;
  }

  /**
   * Search Walmart items by UPC or GTIN using the Item Search API
   * @param {string} accessToken - Walmart API access token
   * @param {string} productId - UPC or GTIN to search for
   * @param {string} productIdType - Type of product ID ('UPC' or 'GTIN')
   * @returns {Promise<object>} - Search results
   */
  async searchItemsByUPCOrGTIN(accessToken, productId, productIdType) {
    try {
      const correlationId = uuidv4();
      
      console.log(`Searching Walmart items by ${productIdType}: ${productId}`);
      
      // Use the correct parameter name based on the API documentation
      const queryParam = productIdType.toLowerCase() === 'upc' ? 'upc' : 'gtin';
      
      const response = await axios({
        method: 'get',
        url: `${this.apiUrl}/${this.apiVersion}/items/walmart/search`,
        headers: {
          'WM_SEC.ACCESS_TOKEN': accessToken,
          'WM_SVC.NAME': 'Walmart Marketplace',
          'WM_QOS.CORRELATION_ID': correlationId,
          'Accept': 'application/json'
        },
        params: {
          [queryParam]: productId
        },
        timeout: config.walmart.requestTimeout
      });

      console.log(`Found ${response.data.items?.length || 0} items for ${productIdType} ${productId}`);
      return response.data;
    } catch (error) {
      console.error(`Error searching by ${productIdType} ${productId}:`, error.message);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', JSON.stringify(error.response.data, null, 2));
      }
      throw new Error(`Failed to search items by ${productIdType}: ${error.message}`);
    }
  }

  /**
   * Search Walmart items by query string using the Item Search API
   * @param {string} accessToken - Walmart API access token
   * @param {string} query - Query string to search for
   * @returns {Promise<object>} - Search results
   */
  async searchItemsByQuery(accessToken, query) {
    try {
      const correlationId = uuidv4();
      
      console.log(`Searching Walmart items by query: ${query}`);
      
      const response = await axios({
        method: 'get',
        url: `${this.apiUrl}/${this.apiVersion}/items/walmart/search`,
        headers: {
          'WM_SEC.ACCESS_TOKEN': accessToken,
          'WM_SVC.NAME': 'Walmart Marketplace',
          'WM_QOS.CORRELATION_ID': correlationId,
          'Accept': 'application/json'
        },
        params: {
          query: query
        },
        timeout: config.walmart.requestTimeout
      });

      console.log(`Found ${response.data.items?.length || 0} items for query "${query}"`);
      return response.data;
    } catch (error) {
      console.error(`Error searching by query ${query}:`, error.message);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', JSON.stringify(error.response.data, null, 2));
      }
      throw new Error(`Failed to search items by query: ${error.message}`);
    }
  }

  /**
   * Search Walmart catalog by WPID using the Item Search API
   * @param {string} accessToken - Walmart API access token
   * @param {string} wpid - Walmart Product ID from URL
   * @returns {Promise<object>} - Search results
   */
  async searchCatalogByWPID(accessToken, wpid) {
    try {
      const correlationId = uuidv4();
      
      console.log(`Searching Walmart catalog by WPID: ${wpid}`);
      
      const response = await axios({
        method: 'get',
        url: `${this.apiUrl}/${this.apiVersion}/items/walmart/search`,
        headers: {
          'WM_SEC.ACCESS_TOKEN': accessToken,
          'WM_SVC.NAME': 'Walmart Marketplace',
          'WM_QOS.CORRELATION_ID': correlationId,
          'Accept': 'application/json'
        },
        params: {
          query: wpid  // Search by item ID/WPID
        },
        timeout: config.walmart.requestTimeout
      });

      console.log(`Found ${response.data.items?.length || 0} items for WPID ${wpid}`);
      return response.data;
    } catch (error) {
      console.error(`Error searching by WPID ${wpid}:`, error.message);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', JSON.stringify(error.response.data, null, 2));
      }
      throw new Error(`Failed to find product with WPID ${wpid}: ${error.message}`);
    }
  }

  /**
   * Create an offer for an existing Walmart item (Legacy method - kept for compatibility)
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
   * Create OSBM offer using v5.0 specification
   * @param {string} accessToken - Walmart API access token
   * @param {object} offerData - Offer data
   * @returns {Promise<object>} - Feed response
   */
  async createOSBMOffer(accessToken, offerData) {
    try {
      const correlationId = uuidv4();
      const requestId = `REQ_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const batchId = `BATCH_${Date.now()}`;
      
      // OSBM v4.2 feed structure - Offer Setup by Match
      const feedPayload = {
        MPItemFeedHeader: {
          processMode: 'REPLACE',
          subset: 'EXTERNAL',
          locale: 'en',
          sellingChannel: 'mpsetupbymatch',
          version: '4.2'
        },
        MPItem: [{
          Item: {
            sku: offerData.sku,
            condition: 'New', // Default to New condition
            productIdentifiers: {
              productIdType: offerData.productIdType || 'UPC', // Use the actual type that found the product
              productId: offerData.productId
            },
            ShippingWeight: offerData.shippingWeight || 1,
            price: offerData.price
          }
        }]
      };

      // Add shipping template if provided
      if (offerData.shippingTemplate) {
        feedPayload.MPItem[0].shippingTemplate = offerData.shippingTemplate;
      }

      console.log('OSBM v4.2 Feed Payload:', JSON.stringify(feedPayload, null, 2));

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

      return {
        ...response.data,
        requestId,
        batchId
      };
    } catch (error) {
      console.error('Error creating OSBM offer:', error.message);
      if (error.response) {
        console.error('Response data:', JSON.stringify(error.response.data, null, 2));
      }
      throw new Error(`Failed to create OSBM offer: ${error.message}`);
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
   * Get detailed feed status including item-level information
   * @param {string} accessToken - Walmart API access token
   * @param {string} feedId - Feed ID
   * @returns {Promise<object>} - Detailed feed status
   */
  async getFeedStatusDetailed(accessToken, feedId) {
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
        params: {
          includeDetails: 'true', // String value as per docs
          offset: '0',
          limit: '50'
        },
        timeout: config.walmart.requestTimeout
      });

      console.log(`Feed ${feedId} detailed status:`, JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error) {
      console.error(`Error getting detailed feed status ${feedId}:`, error.message);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', JSON.stringify(error.response.data, null, 2));
      }
      throw error;
    }
  }

  /**
   * Monitor feed status with polling until completion
   * @param {string} accessToken - Walmart API access token
   * @param {string} feedId - Feed ID to monitor
   * @param {number} maxAttempts - Maximum polling attempts (default: 30)
   * @param {number} intervalSeconds - Seconds between polls (default: 60)
   * @returns {Promise<object>} - Final feed status
   */
  async monitorFeedStatus(accessToken, feedId, maxAttempts = 30, intervalSeconds = 60) {
    console.log(`Starting feed monitoring for ${feedId}, max attempts: ${maxAttempts}`);
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const status = await this.getFeedStatusDetailed(accessToken, feedId);
        
        console.log(`Attempt ${attempt}/${maxAttempts} - Feed ${feedId} status: ${status.feedStatus}`);
        
        switch (status.feedStatus) {
          case 'PROCESSED':
            console.log(`Feed ${feedId} completed successfully`);
            return {
              success: true,
              status: 'COMPLETED',
              feedStatus: status,
              message: 'Offer created successfully'
            };
            
          case 'ERROR':
            console.error(`Feed ${feedId} failed with errors:`, status);
            const extractedErrors = this.extractFeedErrors(status);
            console.error('Extracted errors:', extractedErrors);
            return {
              success: false,
              status: 'FAILED',
              feedStatus: status,
              message: 'Offer creation failed',
              errors: extractedErrors
            };
            
          case 'PROCESSING':
          case 'RECEIVED':
          case 'INPROGRESS':
            if (attempt === maxAttempts) {
              return {
                success: false,
                status: 'TIMEOUT',
                feedStatus: status,
                message: 'Feed processing timeout - check status manually'
              };
            }
            
            // Wait before next attempt
            await this.sleep(intervalSeconds * 1000);
            break;
            
          default:
            console.warn(`Unknown feed status: ${status.feedStatus}`);
            // For unknown statuses, check if it's the last attempt
            if (attempt === maxAttempts) {
              return {
                success: false,
                status: 'UNKNOWN',
                feedStatus: status,
                message: `Feed ended with unknown status: ${status.feedStatus}`
              };
            }
            await this.sleep(intervalSeconds * 1000);
            break;
        }
      } catch (error) {
        console.error(`Error checking feed status (attempt ${attempt}):`, error.message);
        
        if (attempt === maxAttempts) {
          return {
            success: false,
            status: 'ERROR',
            message: `Failed to monitor feed: ${error.message}`
          };
        }
        
        await this.sleep(intervalSeconds * 1000);
      }
    }
  }

  /**
   * Extract user-friendly error messages from feed response
   * @param {object} feedStatus - Feed status response
   * @returns {Array} - Array of error objects
   */
  extractFeedErrors(feedStatus) {
    const errors = [];
    
    // Check itemDetails.itemIngestionStatus array
    if (feedStatus.itemDetails?.itemIngestionStatus && Array.isArray(feedStatus.itemDetails.itemIngestionStatus)) {
      feedStatus.itemDetails.itemIngestionStatus.forEach(item => {
        if (item.ingestionErrors?.ingestionError && Array.isArray(item.ingestionErrors.ingestionError)) {
          item.ingestionErrors.ingestionError.forEach(error => {
            errors.push({
              sku: item.sku,
              errorType: error.type,
              errorCode: error.code,
              errorMessage: error.description,
              ingestionStatus: item.ingestionStatus
            });
          });
        }
      });
    }
    
    // Also check top-level ingestionErrors if present
    if (feedStatus.ingestionErrors?.ingestionError && Array.isArray(feedStatus.ingestionErrors.ingestionError)) {
      feedStatus.ingestionErrors.ingestionError.forEach(error => {
        errors.push({
          errorType: error.type,
          errorCode: error.code,
          errorMessage: error.description
        });
      });
    }
    
    return errors;
  }

  /**
   * Utility sleep function
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise} - Promise that resolves after delay
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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
      
      // Official Walmart API payload structure according to documentation
      const payload = {
        sku: sku,
        pricing: [
          {
            currentPriceType: "BASE",
            currentPrice: {
              currency: "USD",
              amount: parseFloat(price)  // Ensure it's a number, not string
            }
          }
        ]
      };
      
      console.log(`Updating price for SKU ${sku} to $${price}`);
      console.log('Payload:', JSON.stringify(payload, null, 2));
      
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

      console.log(`Price update response for SKU ${sku}:`, JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error) {
      console.error(`Error updating price for SKU ${sku}:`, error.message);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', JSON.stringify(error.response.data, null, 2));
        console.error('Response headers:', JSON.stringify(error.response.headers, null, 2));
        
        // Extract detailed error information from Walmart's response
        const errorData = error.response.data;
        let errorMessage = `Failed to update price for SKU ${sku}`;
        
        if (errorData?.payload?.errors && errorData.payload.errors.length > 0) {
          const firstError = errorData.payload.errors[0];
          errorMessage += `: ${firstError.description || firstError.code || 'Unknown error'}`;
          
          // Log all errors for debugging
          errorData.payload.errors.forEach((err, index) => {
            console.error(`Error ${index + 1}:`, {
              code: err.code,
              description: err.description,
              info: err.info,
              severity: err.severity,
              category: err.category
            });
          });
        } else if (errorData?.message) {
          errorMessage += `: ${errorData.message}`;
        }
        
        throw new Error(errorMessage);
      }
      throw new Error(`Failed to update price for SKU ${sku}: ${error.message}`);
    }
  }

  /**
   * Update inventory for a specific SKU
   * @param {string} accessToken - Walmart API access token
   * @param {string} sku - SKU to update inventory for
   * @param {number} quantity - New inventory quantity
   * @param {string} [unit] - Unit of measurement (default: 'EACH')
   * @param {string} [inventoryAvailableDate] - When inventory is available (default: today)
   * @returns {Promise<object>} - Update response
   */
  async updateInventory(accessToken, sku, quantity, unit = 'EACH', inventoryAvailableDate = null) {
    try {
      const correlationId = uuidv4();
      
      const payload = {
        sku: sku,
        quantity: {
          unit: unit,
          amount: quantity
        }
      };
      
      // Only add inventoryAvailableDate if explicitly provided
      if (inventoryAvailableDate) {
        payload.inventoryAvailableDate = inventoryAvailableDate;
      }
      
      console.log(`Updating inventory for SKU ${sku} to ${quantity} ${unit}`);
      
      const response = await axios({
        method: 'put',
        url: `${this.apiUrl}/${this.apiVersion}/inventory`,
        headers: {
          'WM_SEC.ACCESS_TOKEN': accessToken,
          'WM_SVC.NAME': 'Walmart Marketplace',
          'WM_QOS.CORRELATION_ID': correlationId,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        params: {
          sku: sku
        },
        data: payload,
        timeout: config.walmart.requestTimeout
      });

      console.log(`Inventory update response for SKU ${sku}:`, response.data);
      return response.data;
    } catch (error) {
      console.error(`Error updating inventory for SKU ${sku}:`, error.message);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', JSON.stringify(error.response.data, null, 2));
        console.error('Response headers:', error.response.headers);
        
        // Throw error with Walmart's actual error message
        const walmartError = error.response.data;
        const errorMessage = walmartError?.errors?.[0]?.description || 
                           walmartError?.error?.description || 
                           walmartError?.message || 
                           error.message;
        throw new Error(`Failed to update inventory for SKU ${sku}: ${errorMessage} (Status: ${error.response.status})`);
      }
      throw new Error(`Failed to update inventory for SKU ${sku}: ${error.message}`);
    }
  }

  /**
   * Complete OSBM workflow: Extract WPID → Search → Validate → Create Offer → Monitor
   * @param {string} accessToken - Walmart API access token
   * @param {object} offerRequest - Complete offer request
   * @returns {Promise<object>} - Complete workflow result
   */
  async createOfferComplete(accessToken, offerRequest) {
    const {
      walmartUrl,
      sku,
      price,
      quantity = 100,
      fulfillmentLagTime = 1,
      productId,
      productIdType
    } = offerRequest;
    
    try {
      console.log('Starting complete OSBM workflow for:', { walmartUrl, sku, price, productId, productIdType });
      
      let catalogProduct = null;
      let searchMethod = 'none';
      
      // Strategy 1: If we have a source UPC/GTIN from BlueCart, use the Item Search API (most accurate)
      if (productId && productIdType) {
        console.log(`Searching Walmart items by ${productIdType}: ${productId}`);
        searchMethod = `${productIdType.toLowerCase()}_search`;
        
        try {
          const searchResult = await this.searchItemsByUPCOrGTIN(accessToken, productId, productIdType);
          if (searchResult.items && searchResult.items.length > 0) {
            catalogProduct = searchResult.items[0];
            console.log(`Found product via ${productIdType} search:`, {
              title: catalogProduct.title,
              itemId: catalogProduct.itemId,
              brand: catalogProduct.brand,
              properties: catalogProduct.properties // Log properties to see available identifiers
            });
          }
        } catch (searchError) {
          console.log(`Item search by ${productIdType} failed:`, searchError.message);
        }
      }
      
      // Strategy 2: Fallback to query search using WPID if UPC search failed and we have Walmart URL
      if (!catalogProduct && walmartUrl) {
        console.log('UPC search failed, trying WPID extraction from URL...');
        const wpid = this.extractWalmartWPID(walmartUrl);
        if (wpid) {
          console.log(`Extracted WPID: ${wpid}, searching items...`);
          searchMethod = 'wpid_query_search';
          
          try {
            const searchResult = await this.searchItemsByQuery(accessToken, wpid);
            if (searchResult.items && searchResult.items.length > 0) {
              // Find the item that matches the WPID exactly
              catalogProduct = searchResult.items.find(item => 
                item.itemId === wpid || item.itemId === parseInt(wpid)
              ) || searchResult.items[0];
              console.log('Found product via WPID query search:', {
                title: catalogProduct.title,
                itemId: catalogProduct.itemId,
                brand: catalogProduct.brand
              });
            }
          } catch (queryError) {
            console.log('WPID query search failed:', queryError.message);
          }
        }
      }
      
      if (!catalogProduct) {
        throw new Error(`Product not found in Walmart catalog using ${searchMethod}. Make sure the UPC/GTIN from the source product matches a product in Walmart's catalog.`);
      }
      
      // Step 3: Use the same product identifier that successfully found the product
      let finalProductId = productId;
      let finalProductIdType = productIdType;
      
      // If we found the product with our search, use the same identifier
      if (productId && productIdType) {
        console.log(`Using the same identifier that found the product: ${productIdType} = ${productId}`);
        finalProductId = productId;
        finalProductIdType = productIdType;
      } else {
        // Only for WPID-only searches, try to get identifier from catalog
        if (catalogProduct.properties) {
          console.log('Catalog product properties:', catalogProduct.properties);
          
          if (catalogProduct.properties.gtin) {
            finalProductId = catalogProduct.properties.gtin;
            finalProductIdType = 'GTIN';
            console.log(`Using catalog GTIN: ${finalProductId}`);
          } else if (catalogProduct.properties.upc) {
            finalProductId = catalogProduct.properties.upc;
            finalProductIdType = 'UPC';
            console.log(`Using catalog UPC: ${finalProductId}`);
          }
        }
      }
      
      if (!finalProductId) {
        throw new Error('Product missing UPC/GTIN in catalog - cannot create offer');
      }
      
      console.log(`Final product identifier: ${finalProductIdType} = ${finalProductId}`);
      
      // Step 4: Prepare offer data
      const offerData = {
        sku,
        price,
        quantity,
        fulfillmentLagTime,
        productId: finalProductId,
        productIdType: finalProductIdType
      };
      
      // Step 5: Create OSBM offer
      console.log('Creating OSBM offer with data:', offerData);
      const feedResponse = await this.createOSBMOffer(accessToken, offerData);
      
      console.log(`Feed submitted: ${feedResponse.feedId}`);
      
      // Step 6: Monitor until completion (shortened for testing - 5 attempts, 30 seconds)
      const finalResult = await this.monitorFeedStatus(
        accessToken, 
        feedResponse.feedId,
        5,  // 5 attempts for initial testing
        30  // 30 seconds between attempts
      );
      
      return {
        ...finalResult,
        feedId: feedResponse.feedId,
        product: {
          wpid: catalogProduct.itemId || null,
          title: catalogProduct.title,
          itemId: catalogProduct.itemId,
          brand: catalogProduct.brand,
          searchMethod: searchMethod
        },
        offer: offerData
      };
      
    } catch (error) {
      console.error('Complete OSBM workflow failed:', error.message);
      return {
        success: false,
        status: 'ERROR',
        message: error.message,
        error: error
      };
    }
  }
}

module.exports = new WalmartService();
