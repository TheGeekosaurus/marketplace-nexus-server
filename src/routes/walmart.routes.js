const express = require('express');
const router = express.Router();
const { 
  authenticateWalmart, 
  getListings, 
  getListingById,
  createOffer,
  getFeedStatus
} = require('../controllers/walmart.controller');

// Authentication routes
router.post('/auth', authenticateWalmart);

// Listings routes
router.get('/listings', getListings);
router.get('/listing/:id', getListingById);

// Offer creation routes
router.post('/create-offer', createOffer);
router.get('/feed/:feedId', getFeedStatus);

module.exports = router;
