const express = require('express');
const router = express.Router();
const amazonService = require('../services/amazonService');

/**
 * Get Amazon OAuth authorization URL
 */
router.post('/auth-url', async (req, res) => {
  try {
    const { redirectUri } = req.body;

    if (!redirectUri) {
      return res.status(400).json({
        success: false,
        message: 'Redirect URI is required'
      });
    }

    const result = amazonService.generateAuthUrl(redirectUri);

    res.json({
      success: true,
      authUrl: result.authUrl,
      state: result.state
    });
  } catch (error) {
    console.error('Amazon auth URL error:', error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * Exchange authorization code for connection
 */
router.post('/exchange-code', async (req, res) => {
  try {
    const { code, state, redirectUri } = req.body;

    if (!code || !redirectUri) {
      return res.status(400).json({
        success: false,
        message: 'Authorization code and redirect URI are required'
      });
    }

    // Exchange code for tokens
    const tokens = await amazonService.exchangeCodeForTokens(code, redirectUri);

    // Validate connection and get seller info
    const validation = await amazonService.validateConnection(tokens.refreshToken);

    res.json({
      success: true,
      message: 'Amazon connection established successfully',
      data: {
        refreshToken: tokens.refreshToken,
        sellerId: validation.sellerId,
        isConnected: true
      }
    });
  } catch (error) {
    console.error('Amazon code exchange error:', error.message);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * Validate existing Amazon connection
 */
router.post('/validate', async (req, res) => {
  try {
    const { refreshToken, sellerId } = req.body;

    if (!refreshToken || !sellerId) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token and seller ID are required'
      });
    }

    const result = await amazonService.validateConnection(refreshToken);

    res.json({
      success: true,
      message: 'Amazon connection is valid',
      data: result
    });
  } catch (error) {
    console.error('Amazon validation error:', error.message);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * Get Amazon seller listings
 */
router.get('/listings', async (req, res) => {
  try {
    const { limit, nextToken, status } = req.query;
    const { refreshtoken: refreshToken, sellerid: sellerId } = req.headers;

    if (!refreshToken || !sellerId) {
      return res.status(400).json({
        success: false,
        message: 'Missing refresh token or seller ID in headers'
      });
    }

    const options = {
      limit: parseInt(limit) || 20,
      nextToken,
      status
    };

    const result = await amazonService.getListings(refreshToken, sellerId, options);
    res.json(result);
  } catch (error) {
    console.error('Amazon listings error:', error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * Get specific Amazon listing by SKU
 */
router.get('/listing/:sku', async (req, res) => {
  try {
    const { sku } = req.params;
    const { refreshtoken: refreshToken, sellerid: sellerId } = req.headers;

    if (!refreshToken || !sellerId) {
      return res.status(400).json({
        success: false,
        message: 'Missing refresh token or seller ID in headers'
      });
    }

    const result = await amazonService.getListingBySku(refreshToken, sellerId, sku);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Amazon listing error:', error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;
