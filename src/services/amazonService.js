const axios = require('axios');
const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');

// Amazon SP-API endpoints
const ENDPOINTS = {
  'us-east-1': 'https://sellingpartnerapi-na.amazon.com'
};

// US Marketplace ID (Production)
const US_MARKETPLACE_ID = 'ATVPDKIKX0DER';

// LWA (Login with Amazon) endpoint
const LWA_ENDPOINT = 'https://api.amazon.com/auth/o2/token';

// Report types for inventory
const REPORT_TYPES = {
  ACTIVE_LISTINGS: 'GET_FLAT_FILE_OPEN_LISTINGS_DATA',
  ALL_LISTINGS: 'GET_MERCHANT_LISTINGS_ALL_DATA',
  ACTIVE_LISTINGS_ONLY: 'GET_MERCHANT_LISTINGS_DATA',
  INACTIVE_LISTINGS: 'GET_MERCHANT_LISTINGS_INACTIVE_DATA'
};

// Promisify zlib functions
const gunzip = promisify(zlib.gunzip);

class AmazonService {
  constructor() {
    this.baseURL = ENDPOINTS['us-east-1'];
    this.marketplaceId = US_MARKETPLACE_ID;
    this.clientId = process.env.AMAZON_LWA_CLIENT_ID;
    this.clientSecret = process.env.AMAZON_LWA_CLIENT_SECRET;
    this.appId = process.env.AMAZON_APP_ID;

    if (!this.clientId || !this.clientSecret || !this.appId) {
      console.error('Missing Amazon environment variables:', {
        clientId: !!this.clientId,
        clientSecret: !!this.clientSecret,
        appId: !!this.appId
      });
      throw new Error('Missing required Amazon environment variables');
    }
  }

  /**
   * Generate OAuth authorization URL for Amazon SP-API
   */
  generateAuthUrl(redirectUri) {
    const state = crypto.randomBytes(16).toString('hex');

    // Amazon SP-API uses simplified OAuth parameters
    const params = new URLSearchParams({
      application_id: this.appId,  // Changed from client_id to application_id
      version: 'beta',             // Required for draft applications
      state: state,
      redirect_uri: redirectUri
    });

    const authUrl = `https://sellercentral.amazon.com/apps/authorize/consent?${params.toString()}`;

    return { authUrl, state };
  }

  /**
   * Exchange authorization code for refresh token
   */
  async exchangeCodeForTokens(authorizationCode, redirectUri) {
    try {
      const response = await axios.post(LWA_ENDPOINT, {
        grant_type: 'authorization_code',
        code: authorizationCode,
        redirect_uri: redirectUri,
        client_id: this.clientId,
        client_secret: this.clientSecret
      }, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      return {
        refreshToken: response.data.refresh_token,
        accessToken: response.data.access_token,
        expiresIn: response.data.expires_in
      };
    } catch (error) {
      console.error('Error exchanging authorization code:', error.response?.data || error.message);
      throw new Error('Failed to exchange authorization code for tokens');
    }
  }

  /**
   * Get access token from refresh token
   */
  async getAccessToken(refreshToken) {
    try {
      const response = await axios.post(LWA_ENDPOINT, {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret
      }, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      return response.data.access_token;
    } catch (error) {
      console.error('Error getting access token:', error.response?.data || error.message);
      throw new Error('Failed to get access token');
    }
  }

  /**
   * Get seller ID using the official Product Fees API method
   * This is the documented way that many Amazon SP-API developers use
   */
  async getSellerIdFromFeesAPI(accessToken) {
    try {
      console.log('Getting seller ID from Product Fees API...');
      
      // Use any common ASIN for the fees estimate
      // This will return an error, but the error response contains our seller ID
      const commonASIN = 'B08WJ81ZS1'; // Any valid ASIN works
      
      const requestBody = {
        FeesEstimateRequest: {
          MarketplaceId: this.marketplaceId,
          IsAmazonFulfilled: true,
          PriceToEstimateFees: {
            ListingPrice: {
              CurrencyCode: "USD",
              Amount: 10
            },
            Shipping: {
              CurrencyCode: "USD", 
              Amount: 0
            }
          },
          Identifier: commonASIN
        }
      };

      const response = await axios.post(
        `${this.baseURL}/products/fees/v0/items/${commonASIN}/feesEstimate`,
        requestBody,
        {
          headers: {
            'x-amz-access-token': accessToken,
            'Content-Type': 'application/json'
          }
        }
      );

      // Extract seller ID from response (even if there's an error)
      const sellerId = response.data?.payload?.FeesEstimateResult?.FeesEstimateIdentifier?.SellerId;
      
      if (sellerId) {
        console.log('✅ Found seller ID from fees API response:', sellerId);
        return sellerId;
      }

      throw new Error('Seller ID not found in fees API response');
      
    } catch (error) {
      // Even if the API returns an error, check if seller ID is in the error response
      const sellerId = error.response?.data?.payload?.FeesEstimateResult?.FeesEstimateIdentifier?.SellerId;
      
      if (sellerId) {
        console.log('✅ Found seller ID from fees API error response:', sellerId);
        return sellerId;
      }
      
      console.error('Could not extract seller ID from fees API:', {
        status: error.response?.status,
        data: error.response?.data
      });
      
      throw new Error('Could not determine seller ID from Product Fees API');
    }
  }

  /**
   * Test that the seller ID works with the listings API
   */
  async testSellerIdWithListings(accessToken, sellerId) {
    try {
      console.log('Testing listings API access with seller ID...');
      
      const params = new URLSearchParams({
        marketplaceIds: this.marketplaceId,
        pageSize: '1'
      });

      const url = `${this.baseURL}/listings/2021-08-01/items/${sellerId}?${params.toString()}`;

      const response = await axios.get(url, {
        headers: {
          'x-amz-access-token': accessToken,
          'Content-Type': 'application/json'
        }
      });

      console.log('✅ Listings API test successful - seller ID is valid for syncing');
      console.log('Found', response.data.items?.length || 0, 'listing(s)');
      
      return true;
    } catch (error) {
      if (error.response?.status === 403) {
        throw new Error('Access denied to listings API. Your app may need additional permissions.');
      }
      
      // Even if there are no listings, a 200 response with empty items array is still success
      if (error.response?.status === 200) {
        console.log('✅ Listings API accessible (no listings found, which is normal for new accounts)');
        return true;
      }
      
      console.error('Listings API test failed:', error.response?.status, error.message);
      throw new Error('Seller ID obtained but listings API access failed');
    }
  }

  /**
   * Validate connection and get seller info - THE RIGHT WAY
   */
  async validateConnection(refreshToken) {
    try {
      const accessToken = await this.getAccessToken(refreshToken);

      console.log('Getting Amazon seller ID using Product Fees API method...');
      
      // Use the official method to get seller ID
      const sellerId = await this.getSellerIdFromFeesAPI(accessToken);
      
      console.log('✅ Successfully obtained seller ID:', sellerId);

      // Test that the seller ID works with listings API
      console.log('Testing seller ID with listings API...');
      await this.testSellerIdWithListings(accessToken, sellerId);

      return {
        sellerId,
        marketplaceId: this.marketplaceId,
        isValid: true
      };
    } catch (error) {
      console.error('❌ Error validating Amazon connection:', error.message);
      throw new Error(error.message);
    }
  }

  async getListings(refreshToken, sellerId, options = {}) {
    try {
      const { limit = 20, nextToken } = options;
      
      console.log('=== AMAZON GET LISTINGS DEBUG ===');
      console.log('Input parameters:', {
        hasRefreshToken: !!refreshToken,
        sellerId,
        limit,
        hasNextToken: !!nextToken,
        timestamp: new Date().toISOString()
      });
      
      const accessToken = await this.getAccessToken(refreshToken);
      console.log('Access token obtained, length:', accessToken?.length);

      const params = new URLSearchParams({
        marketplaceIds: this.marketplaceId,
        pageSize: limit.toString()
      });

      if (nextToken) {
        params.append('pageToken', nextToken);
      }

      const url = `${this.baseURL}/listings/2021-08-01/items/${sellerId}?${params.toString()}`;
      console.log('Request URL:', url);

      const response = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'x-amz-access-token': accessToken,
          'Content-Type': 'application/json'
        }
      });

      console.log('=== AMAZON LISTINGS RESPONSE DEBUG ===');
      console.log('Response status:', response.status);
      console.log('Response headers:', JSON.stringify(response.headers, null, 2));
      console.log('Response data structure:', {
        hasItems: !!response.data.items,
        itemsLength: response.data.items?.length || 0,
        hasPagination: !!response.data.pagination,
        totalResultCount: response.data.pagination?.totalResultCount,
        hasNextPageToken: !!response.data.pagination?.nextPageToken
      });
      
      // Log first item as sample
      if (response.data.items && response.data.items.length > 0) {
        console.log('Sample item (first):', JSON.stringify(response.data.items[0], null, 2));
      }
      console.log('======================================');

      // Transform response
      const listings = response.data.items?.map(item => {
        const transformed = {
          sku: item.sku,
          asin: item.asin,
          fnsku: item.fnsku,
          productName: item.summaries?.[0]?.itemName || 'Unknown Product',
          price: parseFloat(item.offers?.[0]?.listingPrice?.amount || 0),
          quantity: parseInt(item.offers?.[0]?.fulfillableQuantity || 0),
          status: item.summaries?.[0]?.status || 'UNKNOWN',
          condition: item.summaries?.[0]?.conditionType || 'NEW',
          imageUrl: item.summaries?.[0]?.mainImage?.link,
          lastUpdated: item.summaries?.[0]?.lastUpdatedDate || new Date().toISOString(),
          fulfillmentChannel: item.offers?.[0]?.fulfillmentChannel
        };
        
        // Log transformation issues
        if (!item.sku) console.warn('Item missing SKU:', item);
        if (!item.summaries?.[0]?.itemName) console.warn('Item missing product name for SKU:', item.sku);
        
        return transformed;
      }) || [];

      console.log(`Transformed ${listings.length} listings`);

      return {
        success: true,
        count: listings.length,
        totalCount: response.data.pagination?.totalResultCount || listings.length,
        nextToken: response.data.pagination?.nextPageToken,
        data: listings
      };
    } catch (error) {
      console.error('=== AMAZON LISTINGS ERROR ===');
      console.error('Error fetching Amazon listings:', {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        config: {
          url: error.config?.url,
          method: error.config?.method,
          headers: {
            ...error.config?.headers,
            'Authorization': error.config?.headers?.Authorization ? '[REDACTED]' : undefined,
            'x-amz-access-token': error.config?.headers?.['x-amz-access-token'] ? '[REDACTED]' : undefined
          }
        }
      });
      console.error('=============================');
      throw new Error('Failed to fetch Amazon listings');
    }
  }

  async getListingBySku(refreshToken, sellerId, sku) {
    try {
      const accessToken = await this.getAccessToken(refreshToken);

      const params = new URLSearchParams({
        marketplaceIds: this.marketplaceId
      });

      const url = `${this.baseURL}/listings/2021-08-01/items/${sellerId}/${sku}?${params.toString()}`;

      const response = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'x-amz-access-token': accessToken,
          'Content-Type': 'application/json'
        }
      });

      const item = response.data;
      return {
        sku: item.sku,
        asin: item.asin,
        fnsku: item.fnsku,
        productName: item.summaries?.[0]?.itemName || 'Unknown Product',
        price: parseFloat(item.offers?.[0]?.listingPrice?.amount || 0),
        quantity: parseInt(item.offers?.[0]?.fulfillableQuantity || 0),
        status: item.summaries?.[0]?.status || 'UNKNOWN',
        condition: item.summaries?.[0]?.conditionType || 'NEW',
        imageUrl: item.summaries?.[0]?.mainImage?.link,
        lastUpdated: item.summaries?.[0]?.lastUpdatedDate || new Date().toISOString(),
        fulfillmentChannel: item.offers?.[0]?.fulfillmentChannel
      };
    } catch (error) {
      console.error('Error fetching Amazon listing:', error.response?.data || error.message);
      throw new Error(`Failed to fetch Amazon listing for SKU: ${sku}`);
    }
  }

  /**
   * Request a listings report from Amazon
   * @param {string} refreshToken - The refresh token for authentication
   * @param {string} reportType - The type of report to request
   * @returns {Promise<{reportId: string}>} The report ID
   */
  async requestListingsReport(refreshToken, reportType = REPORT_TYPES.ALL_LISTINGS) {
    try {
      console.log('=== REQUESTING AMAZON LISTINGS REPORT ===');
      console.log('Report type:', reportType);
      
      const accessToken = await this.getAccessToken(refreshToken);
      
      const requestBody = {
        reportType: reportType,
        marketplaceIds: [this.marketplaceId]
      };
      
      console.log('Request body:', JSON.stringify(requestBody, null, 2));
      
      const response = await axios.post(
        `${this.baseURL}/reports/2021-06-30/reports`,
        requestBody,
        {
          headers: {
            'x-amz-access-token': accessToken,
            'Content-Type': 'application/json'
          }
        }
      );
      
      console.log('Report requested successfully:', response.data);
      console.log('=========================================');
      
      return {
        reportId: response.data.reportId
      };
    } catch (error) {
      console.error('=== ERROR REQUESTING REPORT ===');
      console.error('Error details:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data
      });
      console.error('===============================');
      throw new Error('Failed to request Amazon listings report');
    }
  }

  /**
   * Check the status of a report
   * @param {string} refreshToken - The refresh token for authentication
   * @param {string} reportId - The report ID to check
   * @returns {Promise<{status: string, reportDocumentId?: string}>} The report status
   */
  async getReportStatus(refreshToken, reportId) {
    try {
      const accessToken = await this.getAccessToken(refreshToken);
      
      const response = await axios.get(
        `${this.baseURL}/reports/2021-06-30/reports/${reportId}`,
        {
          headers: {
            'x-amz-access-token': accessToken,
            'Content-Type': 'application/json'
          }
        }
      );
      
      const { processingStatus, reportDocumentId } = response.data;
      
      console.log(`Report ${reportId} status: ${processingStatus}`);
      
      return {
        status: processingStatus,
        reportDocumentId: reportDocumentId || null
      };
    } catch (error) {
      console.error('Error checking report status:', error.response?.data || error.message);
      throw new Error('Failed to check report status');
    }
  }

  /**
   * Get the download URL for a completed report
   * @param {string} refreshToken - The refresh token for authentication
   * @param {string} reportDocumentId - The report document ID
   * @returns {Promise<{url: string, compressionAlgorithm?: string}>} The download URL
   */
  async getReportDownloadUrl(refreshToken, reportDocumentId) {
    try {
      const accessToken = await this.getAccessToken(refreshToken);
      
      const response = await axios.get(
        `${this.baseURL}/reports/2021-06-30/documents/${reportDocumentId}`,
        {
          headers: {
            'x-amz-access-token': accessToken,
            'Content-Type': 'application/json'
          }
        }
      );
      
      return {
        url: response.data.url,
        compressionAlgorithm: response.data.compressionAlgorithm
      };
    } catch (error) {
      console.error('Error getting report download URL:', error.response?.data || error.message);
      throw new Error('Failed to get report download URL');
    }
  }

  /**
   * Download and parse a report
   * @param {string} downloadUrl - The URL to download the report from
   * @param {string} compressionAlgorithm - The compression algorithm used
   * @returns {Promise<Array>} The parsed listings data
   */
  async downloadAndParseReport(downloadUrl, compressionAlgorithm) {
    try {
      console.log('=== DOWNLOADING REPORT ===');
      console.log('Compression:', compressionAlgorithm || 'none');
      
      // Download the report
      const response = await axios.get(downloadUrl, {
        responseType: 'arraybuffer'
      });
      
      let reportData = response.data;
      
      // Decompress if needed
      if (compressionAlgorithm === 'GZIP') {
        console.log('Decompressing GZIP data...');
        reportData = await gunzip(reportData);
      }
      
      // Convert to string
      const reportText = reportData.toString('utf-8');
      console.log('Report size:', reportText.length, 'characters');
      
      // Parse tab-delimited data
      const listings = this.parseTabDelimitedReport(reportText);
      console.log('Parsed', listings.length, 'listings');
      console.log('=========================');
      
      return listings;
    } catch (error) {
      console.error('Error downloading/parsing report:', error.message);
      throw new Error('Failed to download or parse report');
    }
  }

  /**
   * Parse tab-delimited report data
   * @param {string} reportText - The raw report text
   * @returns {Array} Parsed listings
   */
  parseTabDelimitedReport(reportText) {
    const lines = reportText.trim().split('\n');
    if (lines.length === 0) return [];
    
    // First line contains headers
    const headers = lines[0].split('\t').map(h => h.trim());
    const listings = [];
    
    console.log('Report headers:', headers.join(', '));
    console.log('Total lines in report:', lines.length);
    
    // Parse each data line
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split('\t');
      const listing = {};
      
      // Skip empty lines
      if (values.length === 1 && values[0].trim() === '') {
        continue;
      }
      
      // Map each value to its header
      headers.forEach((header, index) => {
        listing[header] = values[index] || '';
      });
      
      // Debug first few listings
      if (i <= 3) {
        console.log(`Listing ${i} data:`, {
          sku: listing['sku'],
          asin: listing['asin'],
          price: listing['price'],
          quantity: listing['quantity'],
          valuesLength: values.length,
          headersLength: headers.length
        });
      }
      
      // Only add if we have a SKU (check both possible column names)
      if (listing['seller-sku'] || listing['sku']) {
        // Transform to our standard format - Enhanced for GET_MERCHANT_LISTINGS_ALL_DATA
        const quantity = parseInt(listing['quantity'] || listing['available-quantity'] || 0);
        const transformed = {
          sku: listing['seller-sku'] || listing['sku'],
          asin: listing['asin1'] || listing['asin2'] || listing['asin3'] || listing['asin'] || '',
          productName: listing['item-name'] || listing['product-name'] || listing['title'] || 'Unknown Product',
          price: parseFloat(listing['price'] || listing['list-price'] || 0),
          quantity: quantity,
          status: quantity > 0 ? 'ACTIVE' : 'INACTIVE', // Base status on inventory level
          condition: listing['item-condition'] || listing['condition'] || 'new',
          imageUrl: listing['image-url'] || listing['main-image-url'] || null,
          description: listing['item-description'] || listing['description'] || '',
          openDate: listing['open-date'] || listing['created-date'] || null,
          fulfillmentChannel: listing['fulfillment-channel'] || listing['fulfillment-type'] || 'DEFAULT',
          
          // Enhanced fields from GET_MERCHANT_LISTINGS_ALL_DATA
          listingId: listing['listing-id'] || null,
          productIdType: listing['product-id-type'] || null,
          productId: listing['product-id'] || null,
          itemNote: listing['item-note'] || '',
          shippingFee: parseFloat(listing['zshop-shipping-fee'] || 0),
          expeditedShipping: listing['expedited-shipping'] === 'Y' || listing['expedited-shipping'] === 'true',
          willShipInternationally: listing['will-ship-internationally'] === 'Y' || listing['will-ship-internationally'] === 'true',
          itemIsMarketplace: listing['item-is-marketplace'] === 'Y' || listing['item-is-marketplace'] === 'true',
          merchantShippingGroup: listing['merchant-shipping-group'] || null,
          category: listing['zshop-category1'] || null,
          browsePath: listing['zshop-browse-path'] || null,
          storefrontFeature: listing['zshop-storefront-feature'] || null,
          boldface: listing['zshop-boldface'] === 'Y' || listing['zshop-boldface'] === 'true',
          bidForFeaturedPlacement: listing['bid-for-featured-placement'] === 'Y' || listing['bid-for-featured-placement'] === 'true',
          addDelete: listing['add-delete'] || null,
          pendingQuantity: parseInt(listing['pending-quantity'] || 0),
          
          rawData: listing // Keep original data for reference
        };
        
        listings.push(transformed);
      } else {
        // Debug why listing was skipped
        if (i <= 3) {
          console.log(`Listing ${i} skipped - no SKU found:`, {
            availableKeys: Object.keys(listing),
            skuValue: listing['sku'],
            sellerSkuValue: listing['seller-sku']
          });
        }
      }
    }
    
    console.log(`Successfully parsed ${listings.length} listings from ${lines.length - 1} data lines`);
    return listings;
  }

  /**
   * Main method to get all listings using Reports API
   * Replaces the paginated getListings method
   */
  async getListingsViaReports(refreshToken, sellerId, options = {}) {
    try {
      const { reportType = REPORT_TYPES.ALL_LISTINGS } = options;
      
      console.log('=== FETCHING LISTINGS VIA REPORTS API ===');
      console.log('Seller ID:', sellerId);
      console.log('Report type:', reportType);
      console.log('Timestamp:', new Date().toISOString());
      
      // Step 1: Request the report
      const { reportId } = await this.requestListingsReport(refreshToken, reportType);
      console.log('Report requested, ID:', reportId);
      
      // Step 2: Poll for completion (max 15 minutes)
      const maxWaitTime = 15 * 60 * 1000; // 15 minutes
      const pollInterval = 10 * 1000; // 10 seconds
      const startTime = Date.now();
      
      let reportDocumentId = null;
      let reportStatus = 'IN_PROGRESS';
      
      while (Date.now() - startTime < maxWaitTime) {
        const statusResult = await this.getReportStatus(refreshToken, reportId);
        reportStatus = statusResult.status;
        
        if (reportStatus === 'DONE') {
          reportDocumentId = statusResult.reportDocumentId;
          break;
        } else if (reportStatus === 'CANCELLED' || reportStatus === 'FATAL') {
          throw new Error(`Report failed with status: ${reportStatus}`);
        }
        
        console.log(`Report status: ${reportStatus}, waiting ${pollInterval/1000}s...`);
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
      
      if (!reportDocumentId) {
        throw new Error('Report processing timeout');
      }
      
      console.log('Report ready, document ID:', reportDocumentId);
      
      // Step 3: Get download URL
      const { url, compressionAlgorithm } = await this.getReportDownloadUrl(refreshToken, reportDocumentId);
      
      // Step 4: Download and parse
      const listings = await this.downloadAndParseReport(url, compressionAlgorithm);
      
      console.log('=========================================');
      
      // Return in the same format as the old getListings method
      return {
        success: true,
        count: listings.length,
        totalCount: listings.length,
        nextToken: null, // Reports API doesn't use pagination
        data: listings
      };
    } catch (error) {
      console.error('=== ERROR IN REPORTS API ===');
      console.error(error);
      console.error('============================');
      throw error;
    }
  }

  /**
   * Updated getListings method that uses Reports API
   * Maintains backward compatibility
   */
  async getListings(refreshToken, sellerId, options = {}) {
    try {
      // Use Reports API instead of the paginated approach
      return await this.getListingsViaReports(refreshToken, sellerId, options);
    } catch (error) {
      console.error('Error in getListings:', error.message);
      // Fallback to old method if Reports API fails
      console.warn('Falling back to paginated listings API...');
      return await this.getListingsLegacy(refreshToken, sellerId, options);
    }
  }

  /**
   * Legacy getListings method (renamed from original)
   * Kept for fallback purposes
   */
  async getListingsLegacy(refreshToken, sellerId, options = {}) {
    try {
      const { limit = 20, nextToken } = options;
      
      console.log('=== AMAZON GET LISTINGS DEBUG ===');
      console.log('Input parameters:', {
        hasRefreshToken: !!refreshToken,
        sellerId,
        limit,
        hasNextToken: !!nextToken,
        timestamp: new Date().toISOString()
      });
      
      const accessToken = await this.getAccessToken(refreshToken);
      console.log('Access token obtained, length:', accessToken?.length);

      const params = new URLSearchParams({
        marketplaceIds: this.marketplaceId,
        pageSize: limit.toString()
      });

      if (nextToken) {
        params.append('pageToken', nextToken);
      }

      const url = `${this.baseURL}/listings/2021-08-01/items/${sellerId}?${params.toString()}`;
      console.log('Request URL:', url);

      const response = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'x-amz-access-token': accessToken,
          'Content-Type': 'application/json'
        }
      });

      console.log('=== AMAZON LISTINGS RESPONSE DEBUG ===');
      console.log('Response status:', response.status);
      console.log('Response headers:', JSON.stringify(response.headers, null, 2));
      console.log('Response data structure:', {
        hasItems: !!response.data.items,
        itemsLength: response.data.items?.length || 0,
        hasPagination: !!response.data.pagination,
        totalResultCount: response.data.pagination?.totalResultCount,
        hasNextPageToken: !!response.data.pagination?.nextPageToken
      });
      
      // Log first item as sample
      if (response.data.items && response.data.items.length > 0) {
        console.log('Sample item (first):', JSON.stringify(response.data.items[0], null, 2));
      }
      console.log('======================================');

      // Transform response
      const listings = response.data.items?.map(item => {
        const transformed = {
          sku: item.sku,
          asin: item.asin,
          fnsku: item.fnsku,
          productName: item.summaries?.[0]?.itemName || 'Unknown Product',
          price: parseFloat(item.offers?.[0]?.listingPrice?.amount || 0),
          quantity: parseInt(item.offers?.[0]?.fulfillableQuantity || 0),
          status: item.summaries?.[0]?.status || 'UNKNOWN',
          condition: item.summaries?.[0]?.conditionType || 'NEW',
          imageUrl: item.summaries?.[0]?.mainImage?.link,
          lastUpdated: item.summaries?.[0]?.lastUpdatedDate || new Date().toISOString(),
          fulfillmentChannel: item.offers?.[0]?.fulfillmentChannel
        };
        
        // Log transformation issues
        if (!item.sku) console.warn('Item missing SKU:', item);
        if (!item.summaries?.[0]?.itemName) console.warn('Item missing product name for SKU:', item.sku);
        
        return transformed;
      }) || [];

      console.log(`Transformed ${listings.length} listings`);

      return {
        success: true,
        count: listings.length,
        totalCount: response.data.pagination?.totalResultCount || listings.length,
        nextToken: response.data.pagination?.nextPageToken,
        data: listings
      };
    } catch (error) {
      console.error('=== AMAZON LISTINGS ERROR ===');
      console.error('Error fetching Amazon listings:', {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        config: {
          url: error.config?.url,
          method: error.config?.method,
          headers: {
            ...error.config?.headers,
            'Authorization': error.config?.headers?.Authorization ? '[REDACTED]' : undefined,
            'x-amz-access-token': error.config?.headers?.['x-amz-access-token'] ? '[REDACTED]' : undefined
          }
        }
      });
      console.error('=============================');
      throw new Error('Failed to fetch Amazon listings');
    }
  }

  /**
   * Update inventory for a specific SKU using patchListingsItem API
   * @param {string} refreshToken - Amazon refresh token
   * @param {string} sellerId - Amazon seller ID
   * @param {string} sku - Product SKU to update
   * @param {number} quantity - New inventory quantity
   * @param {string} [productType] - Amazon product type (default: 'PRODUCT')
   * @param {string} [marketplaceId] - Amazon marketplace ID (default: US)
   * @returns {Promise<object>} - Update response
   */
  async updateInventory(refreshToken, sellerId, sku, quantity, productType = 'PRODUCT', marketplaceId = US_MARKETPLACE_ID) {
    try {
      console.log(`Updating Amazon inventory for SKU ${sku} to ${quantity} units`);
      
      // Get access token
      const accessToken = await this.getAccessToken(refreshToken);
      
      // Prepare the JSON Patch payload for inventory update
      const payload = {
        productType: productType,
        patches: [
          {
            op: 'merge',
            path: '/attributes/fulfillment_availability',
            value: [
              {
                fulfillment_channel_code: 'DEFAULT',
                quantity: quantity
              }
            ]
          }
        ]
      };

      console.log('Amazon inventory update payload:', JSON.stringify(payload, null, 2));

      // Make the PATCH request
      const response = await axios({
        method: 'patch',
        url: `${this.baseURL}/listings/2020-09-01/items/${sellerId}/${encodeURIComponent(sku)}`,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'x-amz-access-token': accessToken,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'MarketBridge/1.0'
        },
        params: {
          marketplaceIds: marketplaceId,
          issueLocale: 'en_US'
        },
        data: payload
      });

      console.log(`Amazon inventory update response for SKU ${sku}:`, {
        status: response.data.status,
        submissionId: response.data.submissionId,
        issues: response.data.issues
      });

      // Check if the update was accepted
      if (response.data.status === 'ACCEPTED') {
        return {
          success: true,
          sku: response.data.sku,
          submissionId: response.data.submissionId,
          status: response.data.status,
          message: 'Inventory update submitted successfully'
        };
      } else {
        // Log issues but don't throw error - Amazon may still process it
        console.warn(`Amazon inventory update issues for SKU ${sku}:`, response.data.issues);
        return {
          success: false,
          sku: response.data.sku,
          submissionId: response.data.submissionId,
          status: response.data.status,
          issues: response.data.issues,
          message: 'Inventory update submitted with issues'
        };
      }
    } catch (error) {
      console.error(`Error updating Amazon inventory for SKU ${sku}:`, {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data
      });
      
      // Extract Amazon's actual error message
      if (error.response?.data) {
        const amazonError = error.response.data;
        const errorDetails = amazonError.errors?.[0]?.message || 
                           amazonError.error?.description || 
                           amazonError.message || 
                           JSON.stringify(amazonError);
        throw new Error(`Failed to update Amazon inventory for SKU ${sku}: ${errorDetails} (Status: ${error.response.status})`);
      }
      
      throw new Error(`Failed to update Amazon inventory for SKU ${sku}: ${error.message}`);
    }
  }
}

module.exports = new AmazonService();
