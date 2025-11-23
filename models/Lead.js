/**
 * Lead Model - ORM for leads table
 * Handles all database operations for leads
 */

class Lead {
  constructor(supabase) {
    this.supabase = supabase;
    this.tableName = 'leads';
  }

  /**
   * Create a new lead
   * @param {Object} leadData - Lead information
   * @returns {Promise<Object>} Created lead data
   */
  async create(leadData) {
    const {
      name,
      email,
      phone,
      company,
      lead_source = 'api',
      lead_status = 'new',
      lead_priority = 'medium',
      message,
      notes,
      metadata,
      ip_address,
      user_agent,
      referrer
    } = leadData;

    const data = {
      name: name || null,
      email: email || null,
      phone: phone || null,
      company: company || null,
      lead_source,
      lead_status,
      lead_priority,
      message: message || null,
      notes: notes || null,
      metadata: metadata || null,
      ip_address: ip_address || null,
      user_agent: user_agent || null,
      referrer: referrer || null,
      created_at: new Date().toISOString()
    };

    const { data: result, error } = await this.supabase
      .from(this.tableName)
      .insert([data])
      .select()
      .single();

    if (error) throw error;
    return result;
  }

  /**
   * Find lead by ID
   * @param {number} id - Lead ID
   * @returns {Promise<Object>} Lead data
   */
  async findById(id) {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Find lead by email
   * @param {string} email - Lead email
   * @returns {Promise<Object>} Lead data
   */
  async findByEmail(email) {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('*')
      .eq('email', email)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  /**
   * Find lead by phone
   * @param {string} phone - Lead phone
   * @returns {Promise<Object>} Lead data
   */
  async findByPhone(phone) {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  /**
   * Find all leads with filters and pagination
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Leads data with pagination
   */
  async findAll(options = {}) {
    const {
      limit = 50,
      offset = 0,
      status,
      priority,
      source,
      search,
      dateFrom,
      dateTo,
      sortBy = 'created_at',
      sortOrder = 'desc'
    } = options;

    let query = this.supabase
      .from(this.tableName)
      .select('*', { count: 'exact' });

    // Apply filters
    if (status) query = query.eq('lead_status', status);
    if (priority) query = query.eq('lead_priority', priority);
    if (source) query = query.eq('lead_source', source);
    
    if (search) {
      query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%,company.ilike.%${search}%`);
    }
    
    if (dateFrom) query = query.gte('created_at', dateFrom);
    if (dateTo) query = query.lte('created_at', dateTo);

    // Sorting
    query = query.order(sortBy, { ascending: sortOrder === 'asc' });

    // Pagination
    const limitNum = Math.min(parseInt(limit), 100);
    const offsetNum = parseInt(offset);

    console.log('Applying pagination:', { limitNum, offsetNum });
    query = query.range(offsetNum, offsetNum + limitNum - 1);
    console.log('Query after pagination applied:', query);
    const { data, error, count } = await query;

    if (error) throw error;

    return {
      data,
      pagination: {
        total: count,
        count: data.length,
        limit: limitNum,
        offset: offsetNum,
        currentPage: Math.floor(offsetNum / limitNum) + 1,
        totalPages: Math.ceil(count / limitNum),
        hasNextPage: offsetNum + limitNum < count,
        hasPrevPage: offsetNum > 0
      }
    };
  }

  /**
   * Update lead by ID
   * @param {number} id - Lead ID
   * @param {Object} updateData - Fields to update
   * @returns {Promise<Object>} Updated lead data
   */
  async update(id, updateData) {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Update lead status
   * @param {number} id - Lead ID
   * @param {string} status - New status
   * @returns {Promise<Object>} Updated lead data
   */
  async updateStatus(id, status) {
    return this.update(id, { lead_status: status });
  }

  /**
   * Mark lead as contacted
   * @param {number} id - Lead ID
   * @param {string} notes - Contact notes
   * @returns {Promise<Object>} Updated lead data
   */
  async markAsContacted(id, notes = null) {
    return this.update(id, {
      lead_status: 'contacted',
      last_contacted_at: new Date().toISOString(),
      notes: notes
    });
  }

  /**
   * Update lead with call_sid from a call
   * @param {number} id - Lead ID
   * @param {string} callSid - Twilio call SID
   * @returns {Promise<Object>} Updated lead data
   */
  async updateCallSid(id, callSid) {
    return this.update(id, {
      call_sid: callSid
    });
  }

  /**
   * Find lead by call_sid
   * @param {string} callSid - Twilio call SID
   * @returns {Promise<Object>} Lead data
   */
  async findByCallSid(callSid) {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('*')
      .eq('call_sid', callSid)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  /**
   * Delete lead by ID
   * @param {number} id - Lead ID
   * @returns {Promise<boolean>} Success status
   */
  async delete(id) {
    const { error } = await this.supabase
      .from(this.tableName)
      .delete()
      .eq('id', id);

    if (error) throw error;
    return true;
  }

  /**
   * Get leads count by status
   * @returns {Promise<Object>} Status counts
   */
  async getStatusCounts() {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('lead_status');

    if (error) throw error;

    const counts = data.reduce((acc, item) => {
      acc[item.lead_status] = (acc[item.lead_status] || 0) + 1;
      return acc;
    }, {});

    return counts;
  }

  /**
   * Get recent leads
   * @param {number} limit - Number of leads to fetch
   * @returns {Promise<Array>} Recent leads
   */
  async getRecent(limit = 10) {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data;
  }
}

module.exports = Lead;
