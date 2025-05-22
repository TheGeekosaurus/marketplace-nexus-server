// services/amazonService.js
  const axios = require('axios');

  // Amazon SP-API endpoints
  const ENDPOINTS = {
    'us-east-1': 'https://sellingpartnerapi-na.amazon.com',
    'eu-west-1': 'https://sellingpartnerapi-eu.amazon.com',
    'us-west-2': 'https://sellingpartnerapi-fe.amazon.com'
  };

  // US Marketplace ID
  const US_MARKETPLACE_ID = 'ATVPDKIKX0DER';

  class AmazonService {
    constructor() {
      this.baseURL = ENDPOINTS['us-east-1']; // US only for now
      this.marketplaceId = US_MARKETPLACE_ID;
    }

    /**
     * Exchange refresh token for access token
     */
    async getAccessToken(credentials) {
      try {
        const response = await axios.post('https://api.amazon.com/auth/o2/token', {
          grant_type: 'refresh_token',
          refresh_token: credentials.refreshToken,
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret
        }, {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        });

        return response.data.access_token;
      } catch (error) {
        console.error('Error getting Amazon access token:', error.response?.data || error.message);
        throw new Error('Failed to authenticate with Amazon SP-API');
      }
    }

    /**
     * Validate credentials by attempting to get seller info
     */
    async validateCredentials(credentials) {
      try {
        const accessToken = await this.getAccessToken(credentials);

        // Test the credentials by making a simple API call
        const response = await axios.get(`${this.baseURL}/sellers/v1/marketplaceParticipations`, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'x-amz-access-token': accessToken,
            'Content-Type': 'application/json'
          }
        });

        return {
          sellerId: credentials.sellerId,
          marketplaceId: this.marketplaceId,
          isValid: true
        };
      } catch (error) {
        console.error('Error validating Amazon credentials:', error.response?.data || error.message);
        throw new Error('Invalid Amazon SP-API credentials');
      }
    }

    /**
     * Get seller listings
     */
    async getListings(credentials, options = {}) {
      try {
        const { limit = 20, nextToken, status = 'ACTIVE' } = options;
        const accessToken = await this.getAccessToken(credentials);

        const params = {
          marketplaceIds: this.marketplaceId,
          pageSize: limit
        };

        if (nextToken) {
          params.pageToken = nextToken;
        }

        const response = await axios.get(`${this.baseURL}/listings/2021-08-01/items/${credentials.sellerId}`, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'x-amz-access-token': accessToken,
            'Content-Type': 'application/json'
          },
          params
        });

        // Transform the response to match our expected format
        const listings = response.data.items?.map(item => ({
          sku: item.sku,
          asin: item.asin,
          fnsku: item.fnsku,
          productName: item.summaries?.[0]?.itemName || 'Unknown Product',
          price: item.offers?.[0]?.listingPrice?.amount || 0,
          quantity: item.offers?.[0]?.fulfillableQuantity || 0,
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

    /**
     * Get a specific listing by SKU
     */
    async getListingBySku(credentials, sku) {
      try {
        const accessToken = await this.getAccessToken(credentials);

        const response = await
  axios.get(`${this.baseURL}/listings/2021-08-01/items/${credentials.sellerId}/${sku}`, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'x-amz-access-token': accessToken,
            'Content-Type': 'application/json'
          },
          params: {
            marketplaceIds: this.marketplaceId
          }
        });

        const item = response.data;
        return {
          sku: item.sku,
          asin: item.asin,
          fnsku: item.fnsku,
          productName: item.summaries?.[0]?.itemName || 'Unknown Product',
          price: item.offers?.[0]?.listingPrice?.amount || 0,
          quantity: item.offers?.[0]?.fulfillableQuantity || 0,
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
