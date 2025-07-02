const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');

class WalmartOrderService {
  constructor() {
    this.apiUrl = config.walmart.apiUrl || 'https://marketplace.walmartapis.com';
    this.apiVersion = config.walmart.apiVersion || 'v3';
  }

  /**
   * Get access token for Walmart API
   * @param {string} clientId 
   * @param {string} clientSecret 
   * @returns {Promise<object>} Token data with accessToken and expiresIn
   */
  async getAccessToken(clientId, clientSecret) {
    try {
      // Using the existing WalmartService for token management
      const walmartService = require('./walmart.service');
      return await walmartService.getAccessToken(clientId, clientSecret);
    } catch (error) {
      console.error('Error getting Walmart access token:', error.message);
      throw new Error(`Failed to get access token: ${error.message}`);
    }
  }

  /**
   * Fetch orders from Walmart Marketplace
   * @param {string} accessToken - Walmart API access token
   * @param {object} params - Query parameters
   * @returns {Promise<object>} - Orders response
   */
  async getOrders(accessToken, params = {}) {
    try {
      const correlationId = uuidv4();
      
      const defaultParams = {
        limit: 100,
        productInfo: false,
        shipNodeType: 'SellerFulfilled',
        replacementInfo: false
      };

      const queryParams = { ...defaultParams, ...params };

      console.log('Fetching Walmart orders with params:', queryParams);

      const response = await axios({
        method: 'get',
        url: `${this.apiUrl}/${this.apiVersion}/orders`,
        headers: {
          'WM_SEC.ACCESS_TOKEN': accessToken,
          'WM_SVC.NAME': 'Walmart Marketplace',
          'WM_QOS.CORRELATION_ID': correlationId,
          'Accept': 'application/json'
        },
        params: queryParams,
        timeout: config.walmart.requestTimeout || 30000
      });

      // Handle the response structure
      const data = response.data;
      const orders = data?.list?.elements?.order || [];
      
      // Some orders might be nested in an additional 'order' property
      const normalizedOrders = orders.map(order => {
        return order.order || order;
      });

      return {
        success: true,
        orders: normalizedOrders,
        meta: data?.list?.meta || {},
        nextCursor: data?.list?.meta?.nextCursor
      };
    } catch (error) {
      console.error('Error fetching Walmart orders:', error.message);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', JSON.stringify(error.response.data, null, 2));
      }
      throw new Error(`Failed to fetch orders: ${error.message}`);
    }
  }

  /**
   * Get a specific order by ID
   * @param {string} accessToken - Walmart API access token
   * @param {string} purchaseOrderId - Order ID
   * @returns {Promise<object>} - Order details
   */
  async getOrderById(accessToken, purchaseOrderId) {
    try {
      const correlationId = uuidv4();

      const response = await axios({
        method: 'get',
        url: `${this.apiUrl}/${this.apiVersion}/orders/${purchaseOrderId}`,
        headers: {
          'WM_SEC.ACCESS_TOKEN': accessToken,
          'WM_SVC.NAME': 'Walmart Marketplace',
          'WM_QOS.CORRELATION_ID': correlationId,
          'Accept': 'application/json'
        },
        timeout: config.walmart.requestTimeout || 30000
      });

      return {
        success: true,
        order: response.data
      };
    } catch (error) {
      console.error(`Error fetching order ${purchaseOrderId}:`, error.message);
      throw new Error(`Failed to fetch order: ${error.message}`);
    }
  }

  /**
   * Map Walmart order status to our internal status
   * @param {object} orderLine - Walmart order line
   * @returns {string} - Mapped status
   */
  mapOrderStatus(orderLine) {
    const statusObj = orderLine?.orderLineStatuses?.orderLineStatus?.[0];
    if (!statusObj) return 'Created';

    const status = statusObj.status?.toLowerCase();
    
    const statusMap = {
      'created': 'Created',
      'acknowledged': 'Acknowledged',
      'shipped': 'Shipped',
      'delivered': 'Delivered',
      'cancelled': 'Cancelled',
      'refunded': 'Refunded'
    };

    return statusMap[status] || 'Created';
  }

  /**
   * Calculate order totals from order lines
   * @param {object} order - Walmart order
   * @returns {object} - Calculated totals
   */
  calculateOrderTotals(order) {
    let orderTotal = 0;
    let taxTotal = 0;
    let shippingTotal = 0;

    const orderLines = order.orderLines?.orderLine || [];

    orderLines.forEach(line => {
      const charges = line.charges?.charge || [];
      
      charges.forEach(charge => {
        if (charge.chargeType === 'PRODUCT') {
          const amount = charge.chargeAmount?.amount || 0;
          const tax = charge.tax?.taxAmount?.amount || 0;
          
          orderTotal += amount;
          taxTotal += tax;
        } else if (charge.chargeType === 'SHIPPING') {
          shippingTotal += charge.chargeAmount?.amount || 0;
        }
      });
    });

    // Add tax to total
    orderTotal += taxTotal;

    return {
      orderTotal,
      taxTotal,
      shippingTotal
    };
  }

  /**
   * Transform Walmart order to our database format
   * @param {object} walmartOrder - Raw Walmart order
   * @param {string} marketplaceId - Marketplace UUID
   * @param {string} userId - User UUID
   * @returns {object} - Transformed order data
   */
  transformOrderForDB(walmartOrder, marketplaceId, userId) {
    const totals = this.calculateOrderTotals(walmartOrder);
    
    // Get overall order status (check all line items)
    const orderLines = walmartOrder.orderLines?.orderLine || [];
    let orderStatus = 'Created';
    
    if (orderLines.length > 0) {
      const lineStatuses = orderLines.map(line => this.mapOrderStatus(line));
      
      if (lineStatuses.every(status => status === 'Delivered')) {
        orderStatus = 'Delivered';
      } else if (lineStatuses.every(status => status === 'Cancelled')) {
        orderStatus = 'Cancelled';
      } else if (lineStatuses.some(status => status === 'Shipped')) {
        orderStatus = 'Shipped';
      } else if (lineStatuses.some(status => status === 'Acknowledged')) {
        orderStatus = 'Acknowledged';
      } else if (lineStatuses.some(status => status === 'Refunded')) {
        orderStatus = 'Refunded';
      }
    }

    return {
      user_id: userId,
      marketplace_id: marketplaceId,
      external_order_id: walmartOrder.purchaseOrderId,
      customer_order_id: walmartOrder.customerOrderId,
      order_number: walmartOrder.purchaseOrderId,
      order_date: new Date(walmartOrder.orderDate),
      order_type: walmartOrder.orderType || 'REGULAR',
      original_customer_order_id: walmartOrder.originalCustomerOrderID || null,
      status: orderStatus,
      customer_name: walmartOrder.shippingInfo?.postalAddress?.name || null,
      customer_email: walmartOrder.customerEmailId || null,
      shipping_address: walmartOrder.shippingInfo?.postalAddress || null,
      order_total: totals.orderTotal,
      shipping_total: totals.shippingTotal,
      tax_total: totals.taxTotal,
      ship_method: walmartOrder.shippingInfo?.methodCode || null,
      estimated_delivery_date: walmartOrder.shippingInfo?.estimatedDeliveryDate 
        ? new Date(walmartOrder.shippingInfo.estimatedDeliveryDate) : null,
      estimated_ship_date: walmartOrder.shippingInfo?.estimatedShipDate
        ? new Date(walmartOrder.shippingInfo.estimatedShipDate) : null,
      ship_node_type: walmartOrder.shipNode?.type || 'SellerFulfilled',
      external_data: walmartOrder,
      last_synced_at: new Date()
    };
  }

  /**
   * Transform Walmart order line to our database format
   * @param {object} orderLine - Walmart order line
   * @param {string} orderId - Our order UUID
   * @returns {object} - Transformed order item data
   */
  transformOrderItemForDB(orderLine, orderId) {
    const charges = orderLine.charges?.charge || [];
    let unitPrice = 0;
    let taxAmount = 0;
    let shippingAmount = 0;

    charges.forEach(charge => {
      if (charge.chargeType === 'PRODUCT') {
        unitPrice = charge.chargeAmount?.amount || 0;
        taxAmount = charge.tax?.taxAmount?.amount || 0;
      } else if (charge.chargeType === 'SHIPPING') {
        shippingAmount = charge.chargeAmount?.amount || 0;
      }
    });

    const quantity = parseInt(orderLine.orderLineQuantity?.amount || 1);
    const totalPrice = (unitPrice * quantity) + taxAmount;
    
    const statusObj = orderLine.orderLineStatuses?.orderLineStatus?.[0];
    const trackingInfo = statusObj?.trackingInfo;

    return {
      order_id: orderId,
      external_item_id: orderLine.lineNumber,
      line_number: orderLine.lineNumber,
      sku: orderLine.item?.sku,
      product_name: orderLine.item?.productName,
      title: orderLine.item?.productName,
      quantity: quantity,
      unit_price: unitPrice,
      total_price: totalPrice,
      tax_amount: taxAmount,
      shipping_amount: shippingAmount,
      item_status: this.mapOrderStatus(orderLine),
      status_date: statusObj?.statusDate ? new Date(statusObj.statusDate) : new Date(),
      status_quantity: parseInt(statusObj?.statusQuantity?.amount || quantity),
      fulfillment_option: orderLine.fulfillment?.fulfillmentOption,
      ship_method: orderLine.fulfillment?.shipMethod,
      pickup_date: orderLine.fulfillment?.pickUpDateTime 
        ? new Date(orderLine.fulfillment.pickUpDateTime) : null,
      tracking_number: trackingInfo?.trackingNumber || null,
      tracking_url: trackingInfo?.trackingURL || null,
      carrier_name: trackingInfo?.carrierName?.carrier || trackingInfo?.carrierName?.otherCarrier || null,
      ship_date: trackingInfo?.shipDateTime ? new Date(trackingInfo.shipDateTime) : null,
      cancellation_reason: statusObj?.cancellationReason || null,
      external_data: orderLine
    };
  }
}

module.exports = new WalmartOrderService();