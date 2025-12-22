const express = require('express');
const AuthController = require('../controllers/authController');
const { verifyToken, requireRole } = require('../middleware/auth');

/**
 * Authentication Routes
 * Handles all authentication-related endpoints
 */

/**
 * Create auth router with initialized models
 * @param {Object} models - Initialized database models
 * @returns {Object} Express router
 */
function createAuthRoutes(models) {
  const router = express.Router();
  const authController = new AuthController(models);

  // Bind controller methods to preserve 'this' context
  const login = authController.login.bind(authController);
  const verifyTokenEndpoint = authController.verifyToken.bind(authController);
  const refreshToken = authController.refreshToken.bind(authController);
  const getProfile = authController.getProfile.bind(authController);
  const logout = authController.logout.bind(authController);
  const healthCheck = authController.healthCheck.bind(authController);

  /**
   * @route   POST /api/auth/login
   * @desc    Authenticate user and return JWT tokens
   * @access  Public
   * @body    { email: string, password: string }
   */
  router.post('/login', login);

  /**
   * @route   POST /api/auth/verify
   * @desc    Verify if a JWT token is valid
   * @access  Public
   * @body    { token: string }
   */
  router.post('/verify', verifyTokenEndpoint);

  /**
   * @route   POST /api/auth/refresh
   * @desc    Refresh access token using refresh token
   * @access  Public
   * @body    { refreshToken: string }
   */
  router.post('/refresh', refreshToken);

  /**
   * @route   GET /api/auth/profile
   * @desc    Get current user profile
   * @access  Private (requires valid JWT token)
   * @headers Authorization: Bearer <token>
   */
  router.get('/profile', verifyToken, getProfile);

  /**
   * @route   POST /api/auth/logout
   * @desc    Logout user (client-side token cleanup)
   * @access  Private (requires valid JWT token)
   * @headers Authorization: Bearer <token>
   */
  router.post('/logout', verifyToken, logout);

  /**
   * @route   GET /api/auth/health
   * @desc    Health check for authentication service
   * @access  Public
   */
  router.get('/health', healthCheck);

  // Example protected admin route
  /**
   * @route   GET /api/auth/admin/users
   * @desc    Get all users (admin only)
   * @access  Private (requires valid JWT token + admin role)
   * @headers Authorization: Bearer <token>
   */
  router.get('/admin/users', verifyToken, requireRole('admin'), async (req, res) => {
    try {
      const users = await models.User.getAll();
      res.status(200).json({
        success: true,
        message: 'Users retrieved successfully',
        data: { users }
      });
    } catch (error) {
      console.error('Admin get users error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error while fetching users'
      });
    }
  });

  // Example route for role-based access (multiple roles)
  /**
   * @route   GET /api/auth/user/stats
   * @desc    Get user statistics (admin or manager only)
   * @access  Private (requires valid JWT token + admin or manager role)
   * @headers Authorization: Bearer <token>
   */
  router.get('/user/stats', verifyToken, requireRole(['admin', 'manager']), async (req, res) => {
    try {
      // This is just an example endpoint
      res.status(200).json({
        success: true,
        message: 'User statistics endpoint',
        data: {
          message: 'This endpoint requires admin or manager role',
          user: req.user
        }
      });
    } catch (error) {
      console.error('User stats error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  });

  return router;
}

module.exports = createAuthRoutes;