const Joi = require('joi');
const productProviderFactory = require('../services/productProviderFactory');

const productSchema = Joi.object({
  url: Joi.string().uri().required(),
  marketplace: Joi.string().optional()
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

    const { url, marketplace } = value;

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
    const productData = await provider.fetchProduct(url);

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

module.exports = {
  fetchProduct,
  getSupportedMarketplaces
};