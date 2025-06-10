/**
 * Authentication middleware
 */
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

// Initialize Supabase client for JWT verification
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Verify JWT token in the request header
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const authMiddleware = async (req, res, next) => {
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
    // First try to verify as Supabase JWT token
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (user && !error) {
      // Valid Supabase token
      req.user = { id: user.id, email: user.email, ...user };
      return next();
    }
    
    // If Supabase verification fails, try legacy JWT
    const decoded = jwt.verify(token, config.jwt.secret);
    req.user = decoded;
    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
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
