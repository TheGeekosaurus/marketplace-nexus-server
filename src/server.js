const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const config = require('./config');
const walmartRoutes = require('./routes/walmart.routes');
const productRoutes = require('./routes/product.routes');
const { errorHandler } = require('./middleware/error.middleware');

// Initialize express app
const app = express();

// Apply middlewares
app.use(helmet()); // Security headers
app.use(morgan('dev')); // Request logging

// CORS configuration - this needs to be before other middleware
const allowedOrigins = [
  'https://nexus.nanotomlogistics.com',
  config.corsOrigin // Fallback to environment variable
];

// Add development origins if in development mode
if (config.env === 'development') {
  allowedOrigins.push(
    'http://localhost:3000',
    'http://localhost:8080',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:8080'
  );
}

// Log allowed origins for debugging
console.log('Allowed CORS origins:', allowedOrigins);

// CORS middleware implementation
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) {
      console.log('Allowing request with no origin');
      return callback(null, true);
    }
    
    // Check if origin is allowed
    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      console.log(`Allowing request from origin: ${origin}`);
      return callback(null, true);
    }
    
    console.log(`Blocking request from origin: ${origin}`);
    return callback(new Error(`Origin ${origin} not allowed by CORS`), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'clientId', 'clientSecret', 'x-requested-with'],
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

// Handle preflight requests explicitly
app.options('*', cors());

// Body parsing - after CORS middleware
app.use(express.json()); // Parse JSON bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies

// Log requests for debugging
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  const safeHeaders = { ...req.headers };
  
  // Don't log sensitive headers
  ['authorization', 'clientsecret', 'clientid'].forEach(header => {
    if (safeHeaders[header]) {
      safeHeaders[header] = '[REDACTED]';
    }
  });
  
  console.log('Headers:', safeHeaders);
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', env: config.env });
});

// API routes
app.use('/api/walmart', walmartRoutes);
app.use('/api/amazon', require('./routes/amazon'));
app.use('/api/products', productRoutes);

// 404 handler
app.use((req, res) => {
  console.log(`Route not found: ${req.method} ${req.url}`);
  res.status(404).json({ message: 'Not found' });
});

// Error handler
app.use(errorHandler);

// Start the server
const PORT = config.port;
app.listen(PORT, () => {
  console.log(`Server running in ${config.env} mode on port ${PORT}`);
  console.log(`CORS configured for origins: ${allowedOrigins.join(', ')}`);
});

module.exports = app;
