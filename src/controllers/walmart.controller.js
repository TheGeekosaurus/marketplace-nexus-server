const asyncHandler = require('express-async-handler');
const Joi = require('joi');
const walmartService = require('../services/walmart.service');
const { simplifyWalmartItem } = require('../utils/walmart.utils');

/**
 * Validates and authenticates Walmart API credentials
 * @route POST /api/walmart/auth
 * @access Public
 */
const authenticateWalmart = asyncHandler(async (req, res) => {
  // Validate request body
  const schema = Joi.object({
    clientId: Joi.string().required(),
    clientSecret: Joi.string().required()
  });

  const { error, value } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({ message: error.details[0].message });
  }

  const { clientId, clientSecret } = value;

  // Validate credentials with Walmart API
  const isValid = await walmartService.validateCredentials(clientId, clientSecret);

  if (!isValid) {
    return res.status(401).json({ 
      success: false,
      message: 'Invalid Walmart API credentials' 
    });
  }

  // Get token for future use
  const tokenData = await walmartService.getAccessToken(clientId, clientSecret);

  // Return success response
  return res.status(200).json({
    success: true,
    message: 'Walmart API credentials validated successfully',
    data: {
      accessToken: tokenData.accessToken,
      expiresIn: tokenData.expiresIn
    }
  });
});

/**
 * Get all listings from Walmart seller account
 * @route GET /api/walmart/listings
 * @access Private
 */
const getListings = asyncHandler(async (req, res) => {
  // Extract credentials from request (typically would be from authenticated session)
  // For this example, we require sending credentials with every request
  const schema = Joi.object({
    clientId: Joi.string().required(),
    clientSecret: Joi.string().required(),
    limit: Joi.number().integer().min(1).max(200).default(20),
    offset: Joi.number().integer().min(0).default(0),
    status: Joi.string().valid('PUBLISHED', 'UNPUBLISHED', 'ALL').default('PUBLISHED')
  });

  // Validate params from both query and headers
  const { error, value } = schema.validate({
    ...req.query,
    clientId: req.headers.clientid,
    clientSecret: req.headers.clientsecret
  });

  if (error) {
    return res.status(400).json({ message: error.details[0].message });
  }

  const { clientId, clientSecret, limit, offset, status } = value;
  
  try {
    // Get access token
    const tokenData = await walmartService.getAccessToken(clientId, clientSecret);
    
    // Get listings
    const listings = await walmartService.getListings(tokenData.accessToken, {
      limit,
      offset,
      status
    });

    // Transform response to a more consumable format
    const formattedListings = listings.ItemResponse 
      ? listings.ItemResponse.map(item => simplifyWalmartItem(item))
      : [];

    return res.status(200).json({
      success: true,
      count: formattedListings.length,
      totalCount: listings.totalItems || 0,
      offset,
      limit,
      data: formattedListings
    });
  } catch (error) {
    console.error('Error in getListings controller:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to get listings',
      error: error.response ? error.response.data : null
    });
  }
});

/**
 * Get a specific listing by ID
 * @route GET /api/walmart/listing/:id
 * @access Private
 */
const getListingById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ message: 'Listing ID is required' });
  }

  // Extract credentials from request
  const schema = Joi.object({
    clientId: Joi.string().required(),
    clientSecret: Joi.string().required()
  });

  const { error, value } = schema.validate({
    clientId: req.headers.clientid,
    clientSecret: req.headers.clientsecret
  });

  if (error) {
    return res.status(400).json({ message: error.details[0].message });
  }

  const { clientId, clientSecret } = value;

  try {
    // Get access token
    const tokenData = await walmartService.getAccessToken(clientId, clientSecret);
    
    // Get listing details
    const listing = await walmartService.getListingById(tokenData.accessToken, id);

    return res.status(200).json({
      success: true,
      data: simplifyWalmartItem(listing)
    });
  } catch (error) {
    console.error('Error in getListingById controller:', error);
    return res.status(500).json({
      success: false,
      message: error.message || `Failed to get listing with ID ${id}`,
      error: error.response ? error.response.data : null
    });
  }
});

/**
 * Create an offer for an existing Walmart item
 * @route POST /api/walmart/create-offer
 * @access Private
 */
const createOffer = asyncHandler(async (req, res) => {
  // Validate request body
  const schema = Joi.object({
    credentials: Joi.object({
      clientId: Joi.string().required(),
      clientSecret: Joi.string().required()
    }).required(),
    offerData: Joi.object({
      sku: Joi.string().required(),
      price: Joi.number().positive().required(),
      productId: Joi.string().required(), // UPC or GTIN
      productIdType: Joi.string().valid('UPC', 'GTIN', 'ISBN', 'EAN').default('UPC'),
      condition: Joi.string().valid('New', 'Refurbished', 'Used').default('New'),
      shippingWeight: Joi.number().positive().default(1),
      mainImageUrl: Joi.string().uri().optional()
    }).required()
  });

  const { error, value } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({ 
      success: false,
      message: error.details[0].message 
    });
  }

  const { credentials, offerData } = value;

  try {
    // Get access token
    const tokenData = await walmartService.getAccessToken(
      credentials.clientId, 
      credentials.clientSecret
    );
    
    // Create the offer
    const feedResponse = await walmartService.createOffer(
      tokenData.accessToken, 
      offerData
    );

    // Return feed ID for tracking
    return res.status(200).json({
      success: true,
      message: 'Offer creation initiated successfully',
      data: {
        feedId: feedResponse.feedId,
        feedStatus: feedResponse.feedStatus || 'RECEIVED',
        feedSubmissionDate: feedResponse.feedSubmissionDate || new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error creating Walmart offer:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to create offer',
      error: error.response ? error.response.data : null
    });
  }
});

/**
 * Get feed status to check offer creation progress
 * @route GET /api/walmart/feed/:feedId
 * @access Private
 */
const getFeedStatus = asyncHandler(async (req, res) => {
  const { feedId } = req.params;

  if (!feedId) {
    return res.status(400).json({ message: 'Feed ID is required' });
  }

  // Extract credentials from request
  const schema = Joi.object({
    clientId: Joi.string().required(),
    clientSecret: Joi.string().required()
  });

  const { error, value } = schema.validate({
    clientId: req.headers.clientid,
    clientSecret: req.headers.clientsecret
  });

  if (error) {
    return res.status(400).json({ message: error.details[0].message });
  }

  const { clientId, clientSecret } = value;

  try {
    // Get access token
    const tokenData = await walmartService.getAccessToken(clientId, clientSecret);
    
    // Get feed status
    const feedStatus = await walmartService.getFeedStatus(tokenData.accessToken, feedId);

    return res.status(200).json({
      success: true,
      data: {
        feedId: feedStatus.feedId,
        feedStatus: feedStatus.feedStatus,
        feedSubmissionDate: feedStatus.feedSubmissionDate,
        itemsReceived: feedStatus.itemsReceived || 0,
        itemsSucceeded: feedStatus.itemsSucceeded || 0,
        itemsFailed: feedStatus.itemsFailed || 0,
        itemsProcessing: feedStatus.itemsProcessing || 0,
        errors: feedStatus.feedErrors || []
      }
    });
  } catch (error) {
    console.error('Error getting feed status:', error);
    return res.status(500).json({
      success: false,
      message: error.message || `Failed to get feed status for ${feedId}`,
      error: error.response ? error.response.data : null
    });
  }
});

/**
 * Get inventory for a specific SKU
 * @route GET /api/walmart/inventory/:sku
 * @access Private
 */
const getInventory = asyncHandler(async (req, res) => {
  const { sku } = req.params;

  if (!sku) {
    return res.status(400).json({ message: 'SKU is required' });
  }

  // Extract credentials from request
  const schema = Joi.object({
    clientId: Joi.string().required(),
    clientSecret: Joi.string().required()
  });

  const { error, value } = schema.validate({
    clientId: req.headers.clientid,
    clientSecret: req.headers.clientsecret
  });

  if (error) {
    return res.status(400).json({ message: error.details[0].message });
  }

  const { clientId, clientSecret } = value;

  try {
    // Get access token
    const tokenData = await walmartService.getAccessToken(clientId, clientSecret);
    
    // Get inventory
    const inventory = await walmartService.getInventory(tokenData.accessToken, sku);

    return res.status(200).json({
      success: true,
      data: {
        sku: inventory.sku,
        quantity: inventory.quantity?.amount || 0,
        unit: inventory.quantity?.unit || 'EACH',
        inventoryAvailableDate: inventory.inventoryAvailableDate
      }
    });
  } catch (error) {
    console.error(`Error getting inventory for SKU ${sku}:`, error);
    return res.status(500).json({
      success: false,
      message: error.message || `Failed to get inventory for SKU ${sku}`,
      error: error.response ? error.response.data : null
    });
  }
});

/**
 * Update price for a specific SKU
 * @route POST /api/walmart/update-price
 * @access Private
 */
const updatePrice = asyncHandler(async (req, res) => {
  // Validate request body
  const schema = Joi.object({
    credentials: Joi.object({
      clientId: Joi.string().required(),
      clientSecret: Joi.string().required()
    }).required(),
    sku: Joi.string().required(),
    price: Joi.number().positive().required()
  });

  const { error, value } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({ 
      success: false,
      message: error.details[0].message 
    });
  }

  const { credentials, sku, price } = value;

  try {
    // Get access token
    const tokenData = await walmartService.getAccessToken(
      credentials.clientId, 
      credentials.clientSecret
    );
    
    // Update the price
    const priceResponse = await walmartService.updatePrice(
      tokenData.accessToken, 
      sku,
      price
    );

    return res.status(200).json({
      success: true,
      message: 'Price updated successfully',
      data: priceResponse
    });
  } catch (error) {
    console.error('Error updating Walmart price:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to update price',
      error: error.response ? error.response.data : null
    });
  }
});

/**
 * Update inventory for a specific SKU
 * @route POST /api/walmart/update-inventory
 * @access Private
 */
const updateInventory = asyncHandler(async (req, res) => {
  // Validate request body
  const schema = Joi.object({
    credentials: Joi.object({
      clientId: Joi.string().required(),
      clientSecret: Joi.string().required()
    }).required(),
    sku: Joi.string().required(),
    quantity: Joi.number().integer().min(0).required(),
    unit: Joi.string().default('EACH'),
    inventoryAvailableDate: Joi.string().optional()
  });

  const { error, value } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({ 
      success: false,
      message: error.details[0].message 
    });
  }

  const { credentials, sku, quantity, unit, inventoryAvailableDate } = value;

  try {
    // Get access token
    const tokenData = await walmartService.getAccessToken(
      credentials.clientId, 
      credentials.clientSecret
    );
    
    // Update the inventory
    const inventoryResponse = await walmartService.updateInventory(
      tokenData.accessToken, 
      sku,
      quantity,
      unit,
      inventoryAvailableDate
    );

    return res.status(200).json({
      success: true,
      message: 'Inventory updated successfully',
      data: inventoryResponse
    });
  } catch (error) {
    console.error('Error updating Walmart inventory:', error);
    
    // Pass through the actual error message which now includes Walmart's response
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to update inventory',
      error: error.response ? error.response.data : null,
      sku: sku,
      attemptedQuantity: quantity
    });
  }
});

/**
 * Sync all listings for a user (called by edge function)
 * @route POST /api/walmart/sync-listings
 * @access Private (Edge Function)
 */
const syncListings = asyncHandler(async (req, res) => {
  // Validate request body
  const schema = Joi.object({
    userId: Joi.string().uuid().required(),
    marketplaceId: Joi.string().uuid().required(),
    credentials: Joi.object({
      clientId: Joi.string().required(),
      clientSecret: Joi.string().required()
    }).required()
  });

  const { error, value } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({ 
      success: false,
      message: error.details[0].message 
    });
  }

  const { userId, marketplaceId, credentials } = value;

  try {
    // Use the marketplace sync service to handle everything
    const marketplaceSyncService = require('../services/marketplaceSyncService');
    const result = await marketplaceSyncService.syncWalmartListings(userId, marketplaceId, credentials);

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error syncing Walmart listings:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to sync listings',
      error: error.response ? error.response.data : null
    });
  }
});

/**
 * Create an offer using the complete OSBM workflow
 * @route POST /api/walmart/create-offer-complete
 * @access Private
 */
const createOfferComplete = asyncHandler(async (req, res) => {
  // Validate request body
  const schema = Joi.object({
    credentials: Joi.object({
      clientId: Joi.string().required(),
      clientSecret: Joi.string().required()
    }).required(),
    offerRequest: Joi.object({
      walmartUrl: Joi.string().uri().optional(),
      sku: Joi.string().required(),
      price: Joi.number().positive().required(),
      quantity: Joi.number().integer().positive().default(100),
      fulfillmentLagTime: Joi.number().integer().positive().default(1),
      productId: Joi.string().optional(),
      productIdType: Joi.string().valid('UPC', 'GTIN', 'ISBN', 'EAN').optional()
    }).required()
  });

  const { error, value } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({ 
      success: false,
      message: error.details[0].message 
    });
  }

  const { credentials, offerRequest } = value;

  try {
    // Get access token
    const tokenData = await walmartService.getAccessToken(
      credentials.clientId, 
      credentials.clientSecret
    );
    
    // Execute complete OSBM workflow
    const result = await walmartService.createOfferComplete(
      tokenData.accessToken, 
      offerRequest
    );

    // Return result
    return res.status(200).json({
      success: true,
      message: result.success ? 'OSBM workflow completed successfully' : 'OSBM workflow failed',
      data: result
    });
  } catch (error) {
    console.error('Error in complete OSBM workflow:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to execute OSBM workflow',
      error: error.response ? error.response.data : null
    });
  }
});

module.exports = {
  authenticateWalmart,
  getListings,
  getListingById,
  createOffer,
  createOfferComplete,
  getFeedStatus,
  getInventory,
  updatePrice,
  updateInventory,
  syncListings
};
