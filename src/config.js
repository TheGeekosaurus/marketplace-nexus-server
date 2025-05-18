require('dotenv').config();

module.exports = {
  port: process.env.PORT || 8000,
  env: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || '*', // Default to allow all origins if not specified
  
  // Walmart API configuration
  walmart: {
    apiUrl: 'https://marketplace.walmartapis.com',
    tokenUrl: 'https://marketplace.walmartapis.com/v3/token',
    apiVersion: 'v3',
    // For advanced configurations
    requestTimeout: 30000, // 30 seconds
    maxRetries: 3
  },

  // JWT for storing user credentials securely
  jwt: {
    secret: process.env.JWT_SECRET || 'your_jwt_secret_here',
    expiresIn: process.env.JWT_EXPIRES_IN || '30d'
  }
};
