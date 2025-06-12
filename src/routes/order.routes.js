const express = require('express');
const router = express.Router();
const orderController = require('../controllers/order.controller');
const { authMiddleware } = require('../middleware/auth.middleware');

// Walmart order routes
router.get('/walmart', authMiddleware, orderController.getWalmartOrders);
router.get('/walmart/:orderId', authMiddleware, orderController.getWalmartOrderById);
router.post('/sync/walmart', authMiddleware, orderController.syncWalmartOrders);
router.get('/sync-status/:marketplaceId', authMiddleware, orderController.getOrderSyncStatus);

module.exports = router;