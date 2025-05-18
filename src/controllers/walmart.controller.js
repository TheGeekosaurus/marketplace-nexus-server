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

module.exports = {
  authenticateWalmart,
  getListings,
  getListingById
};
