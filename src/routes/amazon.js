 // routes/amazon.js
  const express = require('express');
  const router = express.Router();
  const amazonService = require('../services/amazonService');

  /**
   * Validate Amazon SP-API credentials
   */
  router.post('/auth', async (req, res) => {
    try {
      const { clientId, clientSecret, refreshToken, sellerId } = req.body;

      if (!clientId || !clientSecret || !refreshToken || !sellerId) {
        return res.status(400).json({
          success: false,
          message: 'Missing required credentials: clientId, clientSecret, refreshToken, sellerId'
        });
      }

      const credentials = { clientId, clientSecret, refreshToken, sellerId };
      const result = await amazonService.validateCredentials(credentials);

      res.json({
        success: true,
        message: 'Amazon credentials validated successfully',
        data: result
      });
    } catch (error) {
      console.error('Amazon auth error:', error.message);
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
      const { clientId, clientSecret, refreshToken, sellerId } = req.headers;

      if (!clientId || !clientSecret || !refreshToken || !sellerId) {
        return res.status(400).json({
          success: false,
          message: 'Missing required credentials in headers'
        });
      }

      const credentials = { clientId, clientSecret, refreshToken, sellerId };
      const options = { limit: parseInt(limit) || 20, nextToken, status };

      const result = await amazonService.getListings(credentials, options);
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
      const { clientId, clientSecret, refreshToken, sellerId } = req.headers;

      if (!clientId || !clientSecret || !refreshToken || !sellerId) {
        return res.status(400).json({
          success: false,
          message: 'Missing required credentials in headers'
        });
      }

      const credentials = { clientId, clientSecret, refreshToken, sellerId };
      const result = await amazonService.getListingBySku(credentials, sku);

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
