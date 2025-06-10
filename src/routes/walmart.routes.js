const express = require('express');
const router = express.Router();
const { 
  authenticateWalmart, 
  getListings, 
  getListingById,
  createOffer,
  createOfferComplete,
  getFeedStatus,
  getInventory,
  updatePrice,
  syncListings
} = require('../controllers/walmart.controller');

// Authentication routes
router.post('/auth', authenticateWalmart);

// Listings routes
router.get('/listings', getListings);
router.get('/listing/:id', getListingById);

// Offer creation routes
router.post('/create-offer', createOffer);
router.post('/create-offer-complete', createOfferComplete);
router.get('/feed/:feedId', getFeedStatus);

// Inventory routes
router.get('/inventory/:sku', getInventory);

// Price update route
router.post('/update-price', updatePrice);

// Sync route for edge function
router.post('/sync-listings', syncListings);

module.exports = router;
