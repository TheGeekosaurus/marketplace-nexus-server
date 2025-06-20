const Joi = require('joi');
const productSourcingService = require('../services/productSourcing/productSourcingService');
const productRefreshService = require('../services/productRefresh/productRefreshService');
const walmartService = require('../services/walmart.service');

const productSchema = Joi.object({
  url: Joi.string().uri().required(),
  marketplace: Joi.string().optional(),
  defaultStockLevels: Joi.object({
    amazon: Joi.number().min(1).optional(),
    walmart: Joi.number().min(1).optional()
  }).optional()
});

const fetchProduct = async (req, res, next) => {
  try {
    // Validate request body
    const { error, value } = productSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message
      });
    }

    const { url, marketplace, defaultStockLevels } = value;

    // Use product sourcing service
    const result = await productSourcingService.fetchFromUrl(url, {
      marketplace,
      defaultStockLevels
    });

    if (!result.success) {
      // Check if it's an API error
      if (result.error.includes('Failed to fetch')) {
        return res.status(503).json({
          success: false,
          message: result.error
        });
      }

      return res.status(400).json({
        success: false,
        message: result.error
      });
    }

    // Return success response
    res.json(result);

  } catch (error) {
    console.error('Product fetch error:', error);
    
    // Generic error
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching product data'
    });
  }
};

const getSupportedMarketplaces = (req, res) => {
  const supported = productSourcingService.getSupportedMarketplaces();
  
  res.json({
    success: true,
    marketplaces: supported,
    count: supported.length
  });
};

const refreshProductSchema = Joi.object({
  productId: Joi.string().required(),
  sourceUrl: Joi.string().uri().required(),
  sourceType: Joi.string().required(),
  currentPrice: Joi.number().optional(),
  settings: Joi.object({
    minimum_profit_type: Joi.string().valid('dollar', 'percentage').optional(),
    minimum_profit_value: Joi.number().optional(),
    automated_repricing_enabled: Joi.boolean().optional()
  }).optional()
});

const refreshProduct = async (req, res, next) => {
  try {
    // Validate request body
    const { error, value } = refreshProductSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message
      });
    }

    const { productId, sourceUrl, sourceType, currentPrice, settings } = value;
    const userId = req.headers['x-user-id'];

    // Normalize source type for provider factory
    const normalizeSourceType = (sourceType) => {
      if (!sourceType) return 'auto-detect';
      const type = sourceType.toLowerCase();
      if (type.includes('homedepot')) return 'homedepot';
      if (type.includes('amazon')) return 'amazon';
      if (type.includes('walmart')) return 'walmart';
      return sourceType; // Return as-is if no match
    };

    const normalizedSourceType = normalizeSourceType(sourceType);
    
    // Fetch latest product data using sourcing service
    console.log(`Refreshing product ${productId} from ${sourceType} (normalized: ${normalizedSourceType})...`);
    const sourcingResult = await productSourcingService.fetchFromUrl(sourceUrl, {
      marketplace: normalizedSourceType
    });
    
    if (!sourcingResult.success) {
      return res.status(404).json({ 
        success: false, 
        message: sourcingResult.error || 'Unable to fetch latest product data' 
      });
    }

    const latestData = sourcingResult.data;

    // Calculate price changes
    const priceChanged = currentPrice && latestData.price !== currentPrice;
    const stockChanged = latestData.inStock !== undefined;
    
    // Prepare update data
    const updateData = {
      current_source_price: latestData.price,
      current_stock_level: latestData.stockLevel,
      is_in_stock: latestData.inStock ?? false,
      last_checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Calculate total cost for minimum resell price
    const totalCost = (latestData.price || 0) + (latestData.shipping || 0);
    
    // Calculate minimum resell price if settings provided
    let minimumResellPrice = totalCost;
    if (settings?.minimum_profit_type && settings?.minimum_profit_value) {
      if (settings.minimum_profit_type === 'dollar') {
        minimumResellPrice = totalCost + settings.minimum_profit_value;
      } else {
        // Percentage
        minimumResellPrice = totalCost * (1 + settings.minimum_profit_value / 100);
      }
    }

    // Add marketplace fee (15% estimate)
    minimumResellPrice = minimumResellPrice * 1.15;

    // Return the refresh data
    // The edge function will handle database updates and price changes
    const response = {
      success: true,
      data: {
        productId,
        updates: updateData,
        minimumResellPrice,
        priceChanged,
        stockChanged,
        latestData
      }
    };

    return res.status(200).json(response);
  } catch (error) {
    console.error('Error refreshing product:', error);
    return res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

module.exports = {
  fetchProduct,
  getSupportedMarketplaces,
  refreshProduct
};