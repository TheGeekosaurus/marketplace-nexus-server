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
    console.log('Exchange code request received:', { 
      codeLength: code?.length, 
      state, 
      redirectUri 
    });

    if (!code || !redirectUri) {
      return res.status(400).json({
        success: false,
        message: 'Authorization code and redirect URI are required'
      });
    }

    // Exchange code for tokens
    console.log('Exchanging code for tokens...');
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

/**
 * Request a listings report (new endpoint for Reports API)
 */
router.post('/request-listings-report', async (req, res) => {
  try {
    const { refreshToken, reportType } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token is required'
      });
    }

    const result = await amazonService.requestListingsReport(refreshToken, reportType);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Request report error:', error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * Check report status (new endpoint for Reports API)
 */
router.get('/report-status/:reportId', async (req, res) => {
  try {
    const { reportId } = req.params;
    const { refreshtoken: refreshToken } = req.headers;

    if (!refreshToken || !reportId) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token and report ID are required'
      });
    }

    const result = await amazonService.getReportStatus(refreshToken, reportId);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Report status error:', error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * Download and parse report (new endpoint for Reports API)
 */
router.get('/download-report/:reportDocumentId', async (req, res) => {
  try {
    const { reportDocumentId } = req.params;
    const { refreshtoken: refreshToken } = req.headers;

    if (!refreshToken || !reportDocumentId) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token and report document ID are required'
      });
    }

    // Get download URL
    const { url, compressionAlgorithm } = await amazonService.getReportDownloadUrl(refreshToken, reportDocumentId);
    
    // Download and parse
    const listings = await amazonService.downloadAndParseReport(url, compressionAlgorithm);

    res.json({
      success: true,
      count: listings.length,
      totalCount: listings.length,
      data: listings
    });
  } catch (error) {
    console.error('Download report error:', error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * Sync all listings for a user (called by edge function)
 * Updated to use Reports API
 */
router.post('/sync-listings', async (req, res) => {
  try {
    const { userId, marketplaceId, connection } = req.body;

    if (!userId || !marketplaceId || !connection) {
      return res.status(400).json({
        success: false,
        message: 'Missing required parameters'
      });
    }

    const { refreshToken, sellerId } = connection;

    if (!refreshToken || !sellerId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid connection data'
      });
    }

    // Use the new Reports API method which handles everything
    const result = await amazonService.getListings(refreshToken, sellerId, {
      reportType: 'GET_FLAT_FILE_OPEN_LISTINGS_DATA' // Active listings
    });

    // Return summary for the edge function to process
    res.json({
      success: true,
      data: {
        userId,
        marketplaceId,
        totalSynced: result.count,
        listings: result.data
      }
    });
  } catch (error) {
    console.error('Amazon sync error:', error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;
