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
}

module.exports = new AmazonService();
