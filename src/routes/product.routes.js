const express = require('express');
const router = express.Router();
const productController = require('../controllers/product.controller');

// Fetch product data from any supported marketplace
router.post('/fetch', productController.fetchProduct);

// Refresh product data and check for price updates
router.post('/refresh', productController.refreshProduct);

// Get list of supported marketplaces
router.get('/marketplaces', productController.getSupportedMarketplaces);

module.exports = router;