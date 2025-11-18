/**
 * CallEvent Model - ORM for call_events table
 * Handles all database operations for call events
 */

class CallEvent {
  constructor(supabase) {
    this.supabase = supabase;
    this.tableName = 'call_events';
  }

  /**
   * Create or update a call event
   * @param {Object} eventData - Call event data
   * @returns {Promise<Object>} Created/updated event data
   */
  async upsert(eventData) {
    const {
      call_sid,
      call_status,
      direction,
      from_number,
      to_number,
      duration,
      call_duration,
      recording_url,
      recording_sid,
      timestamp
    } = eventData;

    // Check if exists
    const existing = await this.findByCallSid(call_sid);

    if (existing) {
      // Update existing record
      const updateData = {
        call_status,
        updated_at: new Date().toISOString()
      };

      if (direction) updateData.direction = direction;
      if (duration) updateData.duration = parseInt(duration);
      if (call_duration) updateData.call_duration = parseInt(call_duration);
      if (recording_url) updateData.recording_url = recording_url;
      if (recording_sid) updateData.recording_sid = recording_sid;
      if (timestamp) updateData.timestamp = timestamp;

      return this.update(call_sid, updateData);
    } else {
      // Insert new record
      return this.create({
        call_sid,
        call_status,
        direction: direction || 'outbound-api',
        from_number,
        to_number,
        duration: duration ? parseInt(duration) : null,
        call_duration: call_duration ? parseInt(call_duration) : null,
        recording_url: recording_url || null,
        recording_sid: recording_sid || null,
        timestamp: timestamp || new Date().toISOString(),
        created_at: new Date().toISOString()
      });
    }
  }

  /**
   * Create a new call event
   * @param {Object} eventData - Call event data
   * @returns {Promise<Object>} Created event data
   */
  async create(eventData) {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .insert([eventData])
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Find call event by call SID
   * @param {string} callSid - Twilio call SID
   * @returns {Promise<Object>} Call event data
   */
  async findByCallSid(callSid) {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('*')
      .eq('call_sid', callSid)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  }

  /**
   * Find all call events with filters and pagination
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Call events with pagination
   */
  async findAll(options = {}) {
    const {
      limit = 50,
      offset = 0,
      status,
      direction,
      search,
      from,
      to,
      dateFrom,
      dateTo,
      sortBy = 'created_at',
      sortOrder = 'desc'
    } = options;

    let query = this.supabase
      .from(this.tableName)
      .select('*', { count: 'exact' });

    // Apply filters
    if (status) query = query.eq('call_status', status);
    if (direction) query = query.eq('direction', direction);
    if (from) query = query.eq('from_number', from);
    if (to) query = query.eq('to_number', to);
    
    if (search) {
      query = query.or(`call_sid.ilike.%${search}%,from_number.ilike.%${search}%,to_number.ilike.%${search}%`);
    }
    
    if (dateFrom) query = query.gte('created_at', dateFrom);
    if (dateTo) query = query.lte('created_at', dateTo);

    // Sorting
    query = query.order(sortBy, { ascending: sortOrder === 'asc' });

    // Pagination
    const limitNum = Math.min(parseInt(limit), 100);
    const offsetNum = parseInt(offset);
    query = query.range(offsetNum, offsetNum + limitNum - 1);

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
   * Update call event by call SID
   * @param {string} callSid - Twilio call SID
   * @param {Object} updateData - Fields to update
   * @returns {Promise<Object>} Updated event data
   */
  async update(callSid, updateData) {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .update(updateData)
      .eq('call_sid', callSid)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Get call statistics
   * @returns {Promise<Object>} Call statistics
   */
  async getStatistics() {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('call_status, duration, call_duration');

    if (error) throw error;

    const stats = {
      total: data.length,
      byStatus: {},
      avgDuration: 0,
      totalDuration: 0
    };

    let totalDuration = 0;
    let durationCount = 0;

    data.forEach(item => {
      // Count by status
      stats.byStatus[item.call_status] = (stats.byStatus[item.call_status] || 0) + 1;
      
      // Calculate average duration
      if (item.call_duration) {
        totalDuration += item.call_duration;
        durationCount++;
      }
    });

    stats.avgDuration = durationCount > 0 ? Math.round(totalDuration / durationCount) : 0;
    stats.totalDuration = totalDuration;

    return stats;
  }

  /**
   * Get recent call events
   * @param {number} limit - Number of events to fetch
   * @returns {Promise<Array>} Recent call events
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

  /**
   * Delete call event by call SID
   * @param {string} callSid - Twilio call SID
   * @returns {Promise<boolean>} Success status
   */
  async delete(callSid) {
    const { error } = await this.supabase
      .from(this.tableName)
      .delete()
      .eq('call_sid', callSid);

    if (error) throw error;
    return true;
  }
}

module.exports = CallEvent;
