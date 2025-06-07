/**
 * Authentication middleware
 */
const jwt = require('jsonwebtoken');
const config = require('../config');

/**
 * Verify JWT token in the request header
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const authMiddleware = (req, res, next) => {
  // Check for service role header (internal service calls)
  const serviceRole = req.header('X-Service-Role');
  const userId = req.header('X-User-Id');
  
  if (serviceRole === 'true' && userId) {
    // Service-to-service authentication
    // In production, you should verify this with a shared secret
    req.user = { id: userId, serviceRole: true };
    return next();
  }

  // Get token from header
  const token = req.header('Authorization')?.replace('Bearer ', '');

  // Check if token exists
  if (!token) {
    return res.status(401).json({ message: 'No token, authorization denied' });
  }

  try {
    // Verify token
    const decoded = jwt.verify(token, config.jwt.secret);
    
    // Add user payload to request
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ message: 'Invalid token' });
  }
};

/**
 * Optional auth middleware - doesn't require auth but adds user if token exists
 */
const optionalAuth = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  
  if (token) {
    try {
      const decoded = jwt.verify(token, config.jwt.secret);
      req.user = decoded;
    } catch (err) {
      // Invalid token, but continue without user
    }
  }
  
  next();
};

module.exports = { authMiddleware, optionalAuth };
