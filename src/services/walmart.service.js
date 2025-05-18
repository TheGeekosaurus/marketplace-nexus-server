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

      const response = await axios.post(
        this.tokenUrl,
        'grant_type=client_credentials',
        {
          headers: {
            'Authorization': `Basic ${authString}`,
            'WM_SVC.NAME': 'Walmart Marketplace',
            'WM_QOS.CORRELATION_ID': uuidv4(),
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          timeout: config.walmart.requestTimeout
        }
      );

      if (!response.data || !response.data.access_token) {
        throw new Error('Invalid response from Walmart API');
      }

      return {
        accessToken: response.data.access_token,
        tokenType: response.data.token_type,
        expiresIn: response.data.expires_in
      };
    } catch (error) {
      console.error('Error getting Walmart access token:', error.message);
      if (error.response) {
        console.error('Response data:', error.response.data);
        console.error('Response status:', error.response.status);
      }
      throw new Error(`Failed to get Walmart access token: ${error.message}`);
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
      await this.getAccessToken(clientId, clientSecret);
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

      const response = await axios.get(
        `${this.apiUrl}/${this.apiVersion}/items`,
        {
          headers: this._getHeaders(accessToken),
          params: {
            limit,
            offset,
            status
          },
          timeout: config.walmart.requestTimeout
        }
      );

      return response.data;
    } catch (error) {
      console.error('Error fetching Walmart listings:', error.message);
      if (error.response) {
        console.error('Response data:', error.response.data);
        console.error('Response status:', error.response.status);
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
      const response = await axios.get(
        `${this.apiUrl}/${this.apiVersion}/items/${itemId}`,
        {
          headers: this._getHeaders(accessToken),
          timeout: config.walmart.requestTimeout
        }
      );

      return response.data;
    } catch (error) {
      console.error(`Error fetching Walmart listing ${itemId}:`, error.message);
      if (error.response) {
        console.error('Response data:', error.response.data);
        console.error('Response status:', error.response.status);
      }
      throw new Error(`Failed to fetch Walmart listing ${itemId}: ${error.message}`);
    }
  }

  /**
   * Generate headers for Walmart API requests
   * @param {string} accessToken - Walmart API access token
   * @returns {object} - Headers object
   * @private
   */
  _getHeaders(accessToken) {
    return {
      'Authorization': `Bearer ${accessToken}`,
      'WM_SVC.NAME': 'Walmart Marketplace',
      'WM_QOS.CORRELATION_ID': uuidv4(),
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };
  }
}

module.exports = new WalmartService();
