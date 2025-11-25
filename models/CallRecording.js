/**
 * CallRecording Model - ORM for call_recordings table
 * Handles all database operations for call recordings
 */

class CallRecording {
  constructor(supabase) {
    this.supabase = supabase;
    this.tableName = 'call_recordings';
  }

  /**
   * Create a new recording
   * @param {Object} recordingData - Recording data
   * @returns {Promise<Object>} Created recording
   */
  async create(recordingData) {
    const {
      call_sid,
      recording_sid,
      call_event_id,
      lead_id,
      storage_path,
      storage_url,
      file_name,
      file_size,
      duration,
      format = 'mp3',
      status = 'completed',
      metadata = {}
    } = recordingData;

    const { data, error } = await this.supabase
      .from(this.tableName)
      .insert([
        {
          call_sid,
          recording_sid,
          call_event_id,
          lead_id,
          storage_path,
          storage_url,
          file_name,
          file_size,
          duration,
          format,
          status,
          metadata: metadata,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      ])
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  /**
   * Find recording by call SID
   * @param {string} callSid - Twilio Call SID
   * @returns {Promise<Object>} Recording record or null
   */
  async findByCallSid(callSid) {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('*')
      .eq('call_sid', callSid)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = no rows returned, which is fine
      throw error;
    }

    return data || null;
  }

  /**
   * Find recording by recording SID
   * @param {string} recordingSid - Twilio Recording SID
   * @returns {Promise<Object>} Recording record or null
   */
  async findByRecordingSid(recordingSid) {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('*')
      .eq('recording_sid', recordingSid)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    return data || null;
  }

  /**
   * Find recording by lead ID
   * @param {string} leadId - Lead ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Recording records
   */
  async findByLeadId(leadId, options = {}) {
    const { limit = 50, offset = 0 } = options;

    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('*')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      throw error;
    }

    return data || [];
  }

  /**
   * Update recording
   * @param {string} callSid - Call SID to identify record
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated record
   */
  async update(callSid, updates) {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('call_sid', callSid)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  /**
   * Delete recording
   * @param {string} callSid - Call SID
   * @returns {Promise<boolean>} Success status
   */
  async delete(callSid) {
    const { error } = await this.supabase
      .from(this.tableName)
      .delete()
      .eq('call_sid', callSid);

    if (error) {
      throw error;
    }

    return true;
  }

  /**
   * Get all recordings with pagination and filtering
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Paginated results
   */
  async findAll(options = {}) {
    const {
      limit = 50,
      offset = 0,
      status,
      leadId,
      dateFrom,
      dateTo,
      sortBy = 'created_at',
      sortOrder = 'desc'
    } = options;

    let query = this.supabase
      .from(this.tableName)
      .select('*', { count: 'exact' });

    if (status) {
      query = query.eq('status', status);
    }

    if (leadId) {
      query = query.eq('lead_id', leadId);
    }

    if (dateFrom) {
      query = query.gte('created_at', dateFrom);
    }

    if (dateTo) {
      query = query.lte('created_at', dateTo);
    }

    const { data, error, count } = await query
      .order(sortBy, { ascending: sortOrder === 'asc' })
      .range(offset, offset + limit - 1);

    if (error) {
      throw error;
    }

    return {
      data: data || [],
      pagination: {
        total: count || 0,
        limit,
        offset,
        hasMore: (offset + limit) < (count || 0)
      }
    };
  }

  /**
   * Get recording statistics
   * @returns {Promise<Object>} Statistics
   */
  async getStats() {
    const { data: allRecordings, error: allError } = await this.supabase
      .from(this.tableName)
      .select('*', { count: 'exact' });

    const { data: completedRecordings, error: completedError } = await this.supabase
      .from(this.tableName)
      .select('*', { count: 'exact' })
      .eq('status', 'completed');

    if (allError || completedError) {
      throw allError || completedError;
    }

    // Calculate total storage size
    const totalSize = (allRecordings || []).reduce((sum, rec) => sum + (rec.file_size || 0), 0);

    return {
      totalRecordings: allRecordings?.length || 0,
      completedRecordings: completedRecordings?.length || 0,
      totalStorageBytes: totalSize,
      totalStorageGB: (totalSize / (1024 * 1024 * 1024)).toFixed(2)
    };
  }
}

module.exports = CallRecording;
