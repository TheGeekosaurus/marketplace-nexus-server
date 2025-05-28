/**
 * Utility functions for Walmart API integration
 */

const crypto = require('crypto');

/**
 * Calculate signature for Walmart API requests
 * @param {string} consumerId - Consumer ID (client ID)
 * @param {string} privateKey - Private key
 * @param {string} requestUrl - Request URL
 * @param {string} requestMethod - HTTP method (GET, POST, etc.)
 * @param {string} timestamp - Request timestamp
 * @returns {string} - Calculated signature
 */
function calculateSignature(consumerId, privateKey, requestUrl, requestMethod, timestamp) {
  const data = `${consumerId}\n${requestUrl}\n${requestMethod}\n${timestamp}\n`;
  const signature = crypto.createHmac('sha256', privateKey).update(data).digest('base64');
  return signature;
}

/**
 * Generate a UUID v4 string
 * @returns {string} - UUID string
 */
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Parse Walmart API error response
 * @param {object} error - Error object from axios
 * @returns {object} - Parsed error object
 */
function parseWalmartError(error) {
  if (error.response && error.response.data) {
    const { data } = error.response;
    
    if (data.errors && Array.isArray(data.errors)) {
      // Format Walmart specific error structure
      return {
        status: error.response.status,
        code: data.errors[0].code || 'UNKNOWN_ERROR',
        message: data.errors[0].message || error.message,
        info: data.errors[0].info || {},
        details: data.errors.map(err => ({
          code: err.code,
          message: err.message,
          field: err.field,
          info: err.info
        }))
      };
    }
    
    return {
      status: error.response.status,
      message: data.message || error.message,
      data
    };
  }
  
  return {
    status: 500,
    message: error.message,
    code: 'INTERNAL_ERROR'
  };
}

/**
 * Helper to extract specific fields from Walmart item response
 * @param {object} item - Walmart item object
 * @returns {object} - Simplified item object
 */
function simplifyWalmartItem(item) {
  if (!item) return null;
  
  return {
    id: item.wpid || item.sku,  // Use wpid as primary ID since itemId is not in response
    sku: item.sku,
    wpid: item.wpid,
    upc: item.upc,
    gtin: item.gtin,
    productName: item.productName,
    price: parseFloat(item.price?.amount) || 0,
    publishedStatus: item.publishedStatus,
    lifecycleStatus: item.lifecycleStatus,
    inventoryCount: 0,  // Will be updated by background inventory sync
    availability: item.availability,  // Keep original availability status
    imageUrl: null,  // Not provided in getAllItems response
    createdDate: item.createdDate,
    lastModifiedDate: item.lastModifiedDate
  };
}

module.exports = {
  calculateSignature,
  generateUUID,
  parseWalmartError,
  simplifyWalmartItem
};
