const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const config = require('./config');
const walmartRoutes = require('./routes/walmart.routes');
const { errorHandler } = require('./middleware/error.middleware');

// Initialize express app
const app = express();

// Apply middlewares
app.use(helmet()); // Security headers
app.use(morgan('dev')); // Request logging
app.use(express.json()); // Parse JSON bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies

// Configure CORS with more detailed options
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Check if origin is allowed
    const allowedOrigins = [config.corsOrigin];
    if (config.env === 'development') {
      // In development, accept localhost origins
      allowedOrigins.push('http://localhost:3000');
      allowedOrigins.push('http://localhost:8080');
      allowedOrigins.push('http://127.0.0.1:3000');
      allowedOrigins.push('http://127.0.0.1:8080');
    }
    
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      console.log('CORS blocked request from:', origin);
      return callback(null, false);
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'clientId', 'clientSecret', 'x-requested-with'],
  credentials: true,
  maxAge: 86400 // 24 hours
}));

// Log requests for debugging
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  console.log('Headers:', Object.keys(req.headers).reduce((acc, key) => {
    // Don't log sensitive headers
    if (!['authorization', 'clientsecret', 'clientid'].includes(key.toLowerCase())) {
      acc[key] = req.headers[key];
    } else {
      acc[key] = '[REDACTED]';
    }
    return acc;
  }, {}));
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', env: config.env });
});

// API routes
app.use('/api/walmart', walmartRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Not found' });
});

// Error handler
app.use(errorHandler);

// Start the server
const PORT = config.port;
app.listen(PORT, () => {
  console.log(`Server running in ${config.env} mode on port ${PORT}`);
});

module.exports = app;
