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
   */
  async validateConnection(refreshToken) {
    try {
      const accessToken = await this.getAccessToken(refreshToken);

      // Test API call to get seller info
      const response = await axios.get(`${this.baseURL}/sellers/v1/marketplaceParticipations`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'x-amz-access-token': accessToken,
          'Content-Type': 'application/json'
        }
      });

      // Extract seller ID from response
      const sellerId = response.data.payload?.[0]?.sellerId;

      if (!sellerId) {
        throw new Error('Could not determine seller ID from Amazon response');
      }

      return {
        sellerId,
        marketplaceId: this.marketplaceId,
        isValid: true
      };
    } catch (error) {
      console.error('Error validating Amazon connection:', error.response?.data || error.message);
      throw new Error('Invalid Amazon authorization or connection expired');
    }
  }

  async getListings(refreshToken, sellerId, options = {}) {
    try {
      const { limit = 20, nextToken } = options;
      const accessToken = await this.getAccessToken(refreshToken);

      const params = new URLSearchParams({
        marketplaceIds: this.marketplaceId,
        pageSize: limit.toString()
      });

      if (nextToken) {
        params.append('pageToken', nextToken);
      }

      const url = `${this.baseURL}/listings/2021-08-01/items/${sellerId}?${params.toString()}`;

      const response = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'x-amz-access-token': accessToken,
          'Content-Type': 'application/json'
        }
      });

      // Transform response
      const listings = response.data.items?.map(item => ({
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
      })) || [];

      return {
        success: true,
        count: listings.length,
        totalCount: response.data.pagination?.totalResultCount || listings.length,
        nextToken: response.data.pagination?.nextPageToken,
        data: listings
      };
    } catch (error) {
      console.error('Error fetching Amazon listings:', error.response?.data || error.message);
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
