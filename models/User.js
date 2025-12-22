const bcrypt = require('bcryptjs');

/**
 * User model for handling authentication and user management
 */
class User {
  constructor(supabase) {
    this.supabase = supabase;
    this.tableName = 'users';
  }

  /**
   * Find a user by email
   * @param {string} email - User email
   * @returns {Object|null} User object or null if not found
   */
  async findByEmail(email) {
    try {
      const { data, error } = await this.supabase
        .from(this.tableName)
        .select('*')
        .eq('email', email.toLowerCase())
        .eq('is_active', true)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 is "no rows returned"
        console.error('Error finding user by email:', error);
        throw new Error('Database error while finding user');
      }

      return data;
    } catch (error) {
      console.error('Error in findByEmail:', error);
      throw error;
    }
  }

  /**
   * Find a user by ID
   * @param {string} id - User ID (UUID)
   * @returns {Object|null} User object or null if not found
   */
  async findById(id) {
    try {
      const { data, error } = await this.supabase
        .from(this.tableName)
        .select('id, email, first_name, last_name, role, is_active, last_login, created_at')
        .eq('id', id)
        .eq('is_active', true)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error finding user by ID:', error);
        throw new Error('Database error while finding user');
      }

      return data;
    } catch (error) {
      console.error('Error in findById:', error);
      throw error;
    }
  }

  /**
   * Verify user password
   * @param {string} plainPassword - Plain text password
   * @param {string} hashedPassword - Hashed password from database
   * @returns {boolean} True if password matches
   */
  async verifyPassword(plainPassword, hashedPassword) {
    try {
      console.log('=== PASSWORD VERIFICATION DEBUG ===');
      console.log('Plain password:', plainPassword);
      console.log('Plain password length:', plainPassword?.length);
      console.log('Hashed password:', hashedPassword);
      console.log('Hashed password length:', hashedPassword?.length);
      console.log('Hashed password starts with $2a$ or $2b$:', hashedPassword?.startsWith('$2a$') || hashedPassword?.startsWith('$2b$'));
      
      const result = await bcrypt.compare(plainPassword, hashedPassword);
      console.log('Bcrypt comparison result:', result);
      console.log('=== END PASSWORD DEBUG ===');
      
      return result;
    } catch (error) {
      console.error('Error verifying password:', error);
      throw new Error('Error verifying password');
    }
  }

  /**
   * Hash a password
   * @param {string} password - Plain text password
   * @returns {string} Hashed password
   */
  async hashPassword(password) {
    try {
      const saltRounds = 10;
      return await bcrypt.hash(password, saltRounds);
    } catch (error) {
      console.error('Error hashing password:', error);
      throw new Error('Error hashing password');
    }
  }

  /**
   * Update user's last login time
   * @param {string} userId - User ID
   * @returns {boolean} Success status
   */
  async updateLastLogin(userId) {
    try {
      const { error } = await this.supabase
        .from(this.tableName)
        .update({ 
          last_login: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);

      if (error) {
        console.error('Error updating last login:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error in updateLastLogin:', error);
      return false;
    }
  }

  /**
   * Create a new user
   * @param {Object} userData - User data
   * @returns {Object} Created user (without password)
   */
  async create(userData) {
    try {
      const { email, password, first_name, last_name, role = 'user' } = userData;

      // Hash the password
      const password_hash = await this.hashPassword(password);

      const { data, error } = await this.supabase
        .from(this.tableName)
        .insert([{
          email: email.toLowerCase(),
          password_hash,
          first_name,
          last_name,
          role
        }])
        .select('id, email, first_name, last_name, role, is_active, created_at')
        .single();

      if (error) {
        console.error('Error creating user:', error);
        if (error.code === '23505') { // Unique constraint violation
          throw new Error('User with this email already exists');
        }
        throw new Error('Database error while creating user');
      }

      return data;
    } catch (error) {
      console.error('Error in create user:', error);
      throw error;
    }
  }

  /**
   * Update user data
   * @param {string} userId - User ID
   * @param {Object} updateData - Data to update
   * @returns {Object} Updated user data
   */
  async update(userId, updateData) {
    try {
      // Remove password from direct updates - use separate method
      const { password, ...safeUpdateData } = updateData;
      
      if (password) {
        safeUpdateData.password_hash = await this.hashPassword(password);
      }

      safeUpdateData.updated_at = new Date().toISOString();

      const { data, error } = await this.supabase
        .from(this.tableName)
        .update(safeUpdateData)
        .eq('id', userId)
        .select('id, email, first_name, last_name, role, is_active, updated_at')
        .single();

      if (error) {
        console.error('Error updating user:', error);
        throw new Error('Database error while updating user');
      }

      return data;
    } catch (error) {
      console.error('Error in update user:', error);
      throw error;
    }
  }

  /**
   * Get all users (admin function)
   * @param {Object} options - Query options
   * @returns {Array} List of users
   */
  async getAll(options = {}) {
    try {
      const { limit = 50, offset = 0, role } = options;
      
      let query = this.supabase
        .from(this.tableName)
        .select('id, email, first_name, last_name, role, is_active, last_login, created_at')
        .range(offset, offset + limit - 1)
        .order('created_at', { ascending: false });

      if (role) {
        query = query.eq('role', role);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error getting all users:', error);
        throw new Error('Database error while fetching users');
      }

      return data || [];
    } catch (error) {
      console.error('Error in getAll users:', error);
      throw error;
    }
  }

  /**
   * Deactivate a user (soft delete)
   * @param {string} userId - User ID
   * @returns {boolean} Success status
   */
  async deactivate(userId) {
    try {
      const { error } = await this.supabase
        .from(this.tableName)
        .update({ 
          is_active: false,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);

      if (error) {
        console.error('Error deactivating user:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error in deactivate user:', error);
      return false;
    }
  }
}

module.exports = User;