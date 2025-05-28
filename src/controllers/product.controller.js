const Joi = require('joi');
const productProviderFactory = require('../services/productProviderFactory');
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

    // Get provider based on marketplace or auto-detect from URL
    let provider;
    if (marketplace && marketplace !== 'auto-detect') {
      provider = productProviderFactory.getProvider(marketplace);
      if (!provider) {
        return res.status(400).json({
          success: false,
          message: `Marketplace '${marketplace}' is not supported`
        });
      }
    } else {
      provider = productProviderFactory.getProviderByUrl(url);
      if (!provider) {
        const detectedMarketplace = productProviderFactory.detectMarketplace(url);
        return res.status(400).json({
          success: false,
          message: `Marketplace '${detectedMarketplace}' is not supported. Supported marketplaces: ${productProviderFactory.getSupportedMarketplaces().join(', ')}`
        });
      }
    }

    // Validate URL matches the provider
    if (!provider.validateUrl(url)) {
      return res.status(400).json({
        success: false,
        message: `URL does not match expected format for ${provider.getMarketplaceName()}`
      });
    }

    // Fetch product data
    console.log(`Fetching product from ${provider.getMarketplaceName()}...`);
    const productData = await provider.fetchProduct(url, defaultStockLevels);

    // Return success response
    res.json({
      success: true,
      marketplace: provider.getMarketplaceName(),
      data: productData
    });

  } catch (error) {
    console.error('Product fetch error:', error);
    
    // Check if it's an API error
    if (error.message.includes('Failed to fetch')) {
      return res.status(503).json({
        success: false,
        message: error.message
      });
    }

    // Generic error
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching product data'
    });
  }
};

const getSupportedMarketplaces = (req, res) => {
  const supported = productProviderFactory.getSupportedMarketplaces();
  
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

    // Get provider based on source type
    const provider = productProviderFactory.getProvider(sourceType);
    if (!provider) {
      return res.status(400).json({
        success: false,
        message: `Marketplace '${sourceType}' is not supported`
      });
    }

    // Fetch latest product data
    console.log(`Refreshing product ${productId} from ${sourceType}...`);
    const latestData = await provider.fetchProduct(sourceUrl);
    
    if (!latestData) {
      return res.status(404).json({ 
        success: false, 
        message: 'Unable to fetch latest product data' 
      });
    }

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