const express = require('express');
const router = express.Router();
const orderController = require('../controllers/order.controller');
const { authenticateUser } = require('../middleware/auth.middleware');

// Walmart order routes
router.get('/walmart', authenticateUser, orderController.getWalmartOrders);
router.get('/walmart/:orderId', authenticateUser, orderController.getWalmartOrderById);
router.post('/sync/walmart', authenticateUser, orderController.syncWalmartOrders);
router.get('/sync-status/:marketplaceId', authenticateUser, orderController.getOrderSyncStatus);

module.exports = router;