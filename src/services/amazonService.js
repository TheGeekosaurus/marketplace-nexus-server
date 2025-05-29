const axios = require('axios');
const crypto = require('crypto');

// Amazon SP-API endpoints
const ENDPOINTS = {
  'us-east-1': 'https://sellingpartnerapi-na.amazon.com'
};

// US Marketplace ID (Production)
const US_MARKETPLACE_ID = 'ATVPDKIKX0DER';

// LWA (Login with Amazon) endpoint
const LWA_ENDPOINT = 'https://api.amazon.com/auth/o2/token';

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
   * Validate connection and get seller info
   * WITH EXTENSIVE DEBUG LOGGING
   */
  async validateConnection(refreshToken) {
    try {
      const accessToken = await this.getAccessToken(refreshToken);

      console.log('Making SP-API call to get seller info...');
      console.log('Using endpoint:', `${this.baseURL}/sellers/v1/marketplaceParticipations`);
      console.log('Access token length:', accessToken?.length);
      
      // Simple API call with just LWA token - no AWS signing needed!
      const response = await axios.get(`${this.baseURL}/sellers/v1/marketplaceParticipations`, {
        headers: {
          'x-amz-access-token': accessToken,
          'Content-Type': 'application/json'
        }
      });

      console.log('=== AMAZON SP-API RESPONSE DEBUG ===');
      console.log('Response status:', response.status);
      console.log('Response headers:', JSON.stringify(response.headers, null, 2));
      console.log('Full response data:', JSON.stringify(response.data, null, 2));
      console.log('=====================================');

      // Let's try multiple ways to find the seller ID
      let sellerId = null;
      const data = response.data;

      console.log('Attempting to find seller ID...');
      
      // Method 1: Standard payload structure
      if (data.payload && Array.isArray(data.payload)) {
        console.log('Found payload array with', data.payload.length, 'items');
        
        for (let i = 0; i < data.payload.length; i++) {
          const item = data.payload[i];
          console.log(`Payload item ${i}:`, JSON.stringify(item, null, 2));
          
          // Try different paths
          const possibleSellerIds = [
            item?.participation?.sellerId,
            item?.sellerId,
            item?.seller?.sellerId,
            item?.sellerPartnerId,
            item?.marketplaceParticipation?.sellerId,
            item?.marketplace?.sellerId
          ];
          
          for (const id of possibleSellerIds) {
            if (id) {
              console.log('Found seller ID via path:', id);
              sellerId = id;
              break;
            }
          }
          
          if (sellerId) break;
        }
      }

      // Method 2: Direct properties
      if (!sellerId) {
        console.log('Trying direct properties...');
        const directPaths = [
          data.sellerId,
          data.seller?.sellerId,
          data.sellerPartnerId,
          data.participations?.[0]?.sellerId
        ];
        
        for (const id of directPaths) {
          if (id) {
            console.log('Found seller ID via direct path:', id);
            sellerId = id;
            break;
          }
        }
      }

      // Method 3: Deep search
      if (!sellerId) {
        console.log('Performing deep search for seller ID...');
        const searchForSellerId = (obj, path = '') => {
          if (typeof obj !== 'object' || obj === null) return null;
          
          for (const [key, value] of Object.entries(obj)) {
            const currentPath = path ? `${path}.${key}` : key;
            
            // Check if this key contains 'seller' and the value looks like an ID
            if (key.toLowerCase().includes('seller') && typeof value === 'string' && value.length > 5) {
              console.log(`Potential seller ID at ${currentPath}:`, value);
              return value;
            }
            
            // Recursively search
            if (typeof value === 'object') {
              const found = searchForSellerId(value, currentPath);
              if (found) return found;
            }
          }
          return null;
        };
        
        sellerId = searchForSellerId(data);
      }

      if (!sellerId) {
        console.error('❌ Could not find seller ID anywhere in response');
        console.error('Please check the debug output above and look for any ID-like strings');
        throw new Error('Could not determine seller ID from Amazon response. Check server logs for full response structure.');
      }

      console.log('✅ Successfully found seller ID:', sellerId);

      return {
        sellerId,
        marketplaceId: this.marketplaceId,
        isValid: true
      };
    } catch (error) {
      console.error('❌ Error validating Amazon connection:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message
      });
      
      // If it's a 403, the app might not have proper permissions
      if (error.response?.status === 403) {
        throw new Error('Access denied. Your app may not have proper permissions or may not be authorized correctly.');
      }
      
      throw new Error('Invalid Amazon authorization or connection expired');
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
}

module.exports = new AmazonService();
