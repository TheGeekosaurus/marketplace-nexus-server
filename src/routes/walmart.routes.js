const express = require('express');
const router = express.Router();
const { 
  authenticateWalmart, 
  getListings, 
  getListingById 
} = require('../controllers/walmart.controller');

// Authentication routes
router.post('/auth', authenticateWalmart);

// Listings routes
router.get('/listings', getListings);
router.get('/listing/:id', getListingById);

module.exports = router;
