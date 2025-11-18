/**
 * ConversationTranscript Model - ORM for conversation_transcripts table
 * Handles all database operations for conversation transcripts
 */

class ConversationTranscript {
  constructor(supabase) {
    this.supabase = supabase;
    this.tableName = 'conversation_transcripts';
  }

  /**
   * Save a transcript entry
   * @param {Object} transcriptData - Transcript data
   * @returns {Promise<Object>} Created transcript data
   */
  async create(transcriptData) {
    const {
      call_sid,
      speaker,
      message,
      timestamp,
      latency_metrics
    } = transcriptData;

    const insertData = {
      call_sid,
      speaker,
      message,
      timestamp: timestamp || new Date().toISOString(),
      created_at: new Date().toISOString()
    };

    if (latency_metrics) {
      insertData.latency_metrics = latency_metrics;
    }

    const { data, error } = await this.supabase
      .from(this.tableName)
      .insert([insertData])
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Find all transcripts for a specific call
   * @param {string} callSid - Twilio call SID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Transcript entries
   */
  async findByCallSid(callSid, options = {}) {
    const {
      limit,
      offset = 0,
      orderBy = 'timestamp',
      order = 'asc'
    } = options;

    let query = this.supabase
      .from(this.tableName)
      .select('*')
      .eq('call_sid', callSid)
      .order(orderBy, { ascending: order === 'asc' });

    if (limit) {
      const limitNum = parseInt(limit);
      const offsetNum = parseInt(offset);
      query = query.range(offsetNum, offsetNum + limitNum - 1);
    }

    const { data, error } = await query;

    if (error) throw error;
    return data;
  }

  /**
   * Find all transcripts with pagination and filters
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Transcripts with pagination
   */
  async findAll(options = {}) {
    const {
      limit = 50,
      offset = 0,
      callSid,
      speaker,
      search,
      dateFrom,
      dateTo,
      sortBy = 'timestamp',
      sortOrder = 'desc'
    } = options;

    let query = this.supabase
      .from(this.tableName)
      .select('*', { count: 'exact' });

    // Apply filters
    if (callSid) query = query.eq('call_sid', callSid);
    if (speaker) query = query.eq('speaker', speaker);
    
    if (search) {
      query = query.or(`message.ilike.%${search}%,call_sid.ilike.%${search}%`);
    }
    
    if (dateFrom) query = query.gte('timestamp', dateFrom);
    if (dateTo) query = query.lte('timestamp', dateTo);

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
   * Get conversation summary for a call
   * @param {string} callSid - Twilio call SID
   * @returns {Promise<Object>} Conversation summary
   */
  async getConversationSummary(callSid) {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('*')
      .eq('call_sid', callSid)
      .order('timestamp', { ascending: true });

    if (error) throw error;

    const summary = {
      call_sid: callSid,
      total_messages: data.length,
      speakers: {},
      first_message: data[0]?.timestamp,
      last_message: data[data.length - 1]?.timestamp,
      duration: null,
      transcript: data
    };

    // Count messages by speaker
    data.forEach(item => {
      summary.speakers[item.speaker] = (summary.speakers[item.speaker] || 0) + 1;
    });

    // Calculate duration
    if (summary.first_message && summary.last_message) {
      const first = new Date(summary.first_message);
      const last = new Date(summary.last_message);
      summary.duration = Math.round((last - first) / 1000); // in seconds
    }

    return summary;
  }

  /**
   * Get average latency metrics for a call
   * @param {string} callSid - Twilio call SID
   * @returns {Promise<Object>} Average latency metrics
   */
  async getLatencyMetrics(callSid) {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('latency_metrics')
      .eq('call_sid', callSid)
      .not('latency_metrics', 'is', null);

    if (error) throw error;

    if (data.length === 0) {
      return null;
    }

    const metrics = {
      count: data.length,
      averages: {}
    };

    const sums = {};
    const counts = {};

    data.forEach(item => {
      if (item.latency_metrics) {
        Object.entries(item.latency_metrics).forEach(([key, value]) => {
          if (typeof value === 'number') {
            sums[key] = (sums[key] || 0) + value;
            counts[key] = (counts[key] || 0) + 1;
          }
        });
      }
    });

    Object.keys(sums).forEach(key => {
      metrics.averages[key] = Math.round(sums[key] / counts[key]);
    });

    return metrics;
  }

  /**
   * Delete all transcripts for a call
   * @param {string} callSid - Twilio call SID
   * @returns {Promise<boolean>} Success status
   */
  async deleteByCallSid(callSid) {
    const { error } = await this.supabase
      .from(this.tableName)
      .delete()
      .eq('call_sid', callSid);

    if (error) throw error;
    return true;
  }

  /**
   * Delete a specific transcript by ID
   * @param {number} id - Transcript ID
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
   * Get recent transcripts across all calls
   * @param {number} limit - Number of transcripts to fetch
   * @returns {Promise<Array>} Recent transcripts
   */
  async getRecent(limit = 20) {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data;
  }

  /**
   * Bulk insert transcripts (useful for batch operations)
   * @param {Array} transcripts - Array of transcript data
   * @returns {Promise<Array>} Created transcripts
   */
  async bulkCreate(transcripts) {
    const insertData = transcripts.map(t => ({
      call_sid: t.call_sid,
      speaker: t.speaker,
      message: t.message,
      timestamp: t.timestamp || new Date().toISOString(),
      latency_metrics: t.latency_metrics || null,
      created_at: new Date().toISOString()
    }));

    const { data, error } = await this.supabase
      .from(this.tableName)
      .insert(insertData)
      .select();

    if (error) throw error;
    return data;
  }
}

module.exports = ConversationTranscript;
