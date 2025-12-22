const { generateToken, generateRefreshToken, verifyTokenSync } = require('../middleware/auth');

/**
 * Authentication Controller
 * Handles login, token generation, and token verification
 */
class AuthController {
  constructor(models) {
    this.User = models.User;
  }

  /**
   * Login endpoint
   * POST /auth/login
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async login(req, res) {
    try {
      const { email, password } = req.body;

      // Validate input
      if (!email || !password) {
        return res.status(400).json({
          success: false,
          message: 'Email and password are required'
        });
      }

      // Find user by email
      const user = await this.User.findByEmail(email);
      console.log(user);
      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password'
        });
      }

      // Verify password
      const isPasswordValid = await this.User.verifyPassword(password, user.password_hash);
      console.log(isPasswordValid);
      if (!isPasswordValid) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password'
        });
      }

      // Update last login
      await this.User.updateLastLogin(user.id);

      // Generate tokens
      const tokenPayload = {
        id: user.id,
        email: user.email,
        role: user.role
      };

      const accessToken = generateToken(tokenPayload, '24h');
      const refreshToken = generateRefreshToken(tokenPayload);

      // Remove sensitive data from user object
      const { password_hash, ...userResponse } = user;

      res.status(200).json({
        success: true,
        message: 'Login successful',
        data: {
          user: userResponse,
          tokens: {
            accessToken,
            refreshToken,
            expiresIn: '24h'
          }
        }
      });

    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error during login'
      });
    }
  }

  /**
   * Verify token endpoint
   * POST /auth/verify
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async verifyToken(req, res) {
    try {
      const { token } = req.body;

      if (!token) {
        return res.status(400).json({
          success: false,
          message: 'Token is required'
        });
      }

      // Verify the token
      const decoded = verifyTokenSync(token);

      // Fetch fresh user data to ensure user still exists and is active
      const user = await this.User.findById(decoded.id);
      
      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'User not found or inactive'
        });
      }

      res.status(200).json({
        success: true,
        message: 'Token is valid',
        data: {
          valid: true,
          user: {
            id: user.id,
            email: user.email,
            first_name: user.first_name,
            last_name: user.last_name,
            role: user.role
          },
          tokenInfo: {
            issued: new Date(decoded.iat * 1000),
            expires: new Date(decoded.exp * 1000)
          }
        }
      });

    } catch (error) {
      if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({
          success: false,
          message: 'Invalid token',
          data: { valid: false }
        });
      }

      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Token expired',
          data: { valid: false, expired: true }
        });
      }

      console.error('Token verification error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error during token verification',
        data: { valid: false }
      });
    }
  }

  /**
   * Refresh token endpoint
   * POST /auth/refresh
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async refreshToken(req, res) {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return res.status(400).json({
          success: false,
          message: 'Refresh token is required'
        });
      }

      // Verify the refresh token
      const decoded = verifyTokenSync(refreshToken);

      // Fetch fresh user data
      const user = await this.User.findById(decoded.id);
      
      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'User not found or inactive'
        });
      }

      // Generate new access token
      const tokenPayload = {
        id: user.id,
        email: user.email,
        role: user.role
      };

      const newAccessToken = generateToken(tokenPayload, '24h');

      res.status(200).json({
        success: true,
        message: 'Token refreshed successfully',
        data: {
          accessToken: newAccessToken,
          expiresIn: '24h'
        }
      });

    } catch (error) {
      if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Invalid or expired refresh token'
        });
      }

      console.error('Token refresh error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error during token refresh'
      });
    }
  }

  /**
   * Get current user profile
   * GET /auth/profile
   * Requires authentication middleware
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getProfile(req, res) {
    try {
      // User info is available from auth middleware
      const userId = req.user.id;

      // Fetch complete user data
      const user = await this.User.findById(userId);
      
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      res.status(200).json({
        success: true,
        message: 'Profile retrieved successfully',
        data: {
          user: {
            id: user.id,
            email: user.email,
            first_name: user.first_name,
            last_name: user.last_name,
            role: user.role,
            last_login: user.last_login,
            created_at: user.created_at
          }
        }
      });

    } catch (error) {
      console.error('Get profile error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error while fetching profile'
      });
    }
  }

  /**
   * Logout endpoint (optional - mainly for client-side token cleanup)
   * POST /auth/logout
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async logout(req, res) {
    try {
      // In a stateless JWT system, logout is mainly handled client-side
      // by removing the token from storage. This endpoint can be used
      // for logging purposes or future token blacklisting implementation
      
      res.status(200).json({
        success: true,
        message: 'Logout successful'
      });

    } catch (error) {
      console.error('Logout error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error during logout'
      });
    }
  }

  /**
   * Health check for auth service
   * GET /auth/health
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async healthCheck(req, res) {
    try {
      res.status(200).json({
        success: true,
        message: 'Auth service is healthy',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Auth health check error:', error);
      res.status(500).json({
        success: false,
        message: 'Auth service health check failed'
      });
    }
  }
}

module.exports = AuthController;