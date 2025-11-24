require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const twilio = require('twilio');
const { createClient } = require('@supabase/supabase-js');
const { validatePhoneNumber } = require('./utils/phoneValidator');
const OpenAIRealtimeSession = require('./utils/openAIRealtime');
const { initializeModels } = require('./models');
const {
  scheduleImmediateCall,
  scheduleDelayedCall,
  scheduleRecurringCall,
  scheduleBulkCalls,
  getJobStatus,
  cancelCall,
  retryCall,
  getQueueStats,
  getWaitingJobs,
  getActiveJobs,
  getFailedJobs,
  cleanOldJobs,
  pauseQueue,
  resumeQueue,
  closeQueue
} = require('./queues/callQueue');
const { createCallWorker, closeWorker } = require('./queues/callWorker');
const { parseFile, validateLeads } = require('./utils/fileParser');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ 
  server
});
const PORT = process.env.PORT || 3000;

// CORS configuration
const corsOptions = {
  origin: process.env.CORS_ORIGIN || '*', // Allow all origins by default, configure in .env
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
  optionsSuccessStatus: 200
};

// Apply CORS middleware
app.use(cors(corsOptions));

// JSON body parser with increased limit
app.use(express.json({ limit: '10mb' }));

// URL-encoded body parser (for Twilio webhooks)
app.use(express.urlencoded({ extended: false, limit: '10mb' }));

// File upload middleware (for CSV/JSON file imports)
const fileUpload = require('express-fileupload');
app.use(fileUpload({
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max file size
  abortOnLimit: true,
  responseOnLimit: 'File size exceeds 50MB limit',
  useTempFiles: false,
  createParentPath: false
}));

// Log incoming requests
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Twilio credentials from environment variables
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
const publicUrl = process.env.PUBLIC_URL || 'http://localhost:3000';

// Supabase configuration
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
this.supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

// Initialize ORM models
const models = this.supabase ? initializeModels(this.supabase) : null;

// Initialize Twilio client
const client = twilio(accountSid, authToken);

// Initialize call queue worker
let callWorker = null;
try {
  callWorker = createCallWorker(models);
  console.log('📞 Call queue worker initialized');
} catch (error) {
  console.warn('⚠️  Call queue worker not initialized:', error.message);
  console.warn('⚠️  Make sure Redis is running for queue functionality');
}

// Root endpoint
app.get('/', (req, res) => {
  res.send('VoMindAI Programmable Voice AI Assistant running!');
});

app.get('/health', (req, res) => {
  res.send('VoMindAI is healthy!');
});

// POST endpoint to accept new lead information
app.post('/api/new-lead', async (req, res) => {
  const {
    name,
    email,
    phone,
    company,
    lead_source,
    lead_status = 'new',
    lead_priority = 'medium',
    message,
    notes,
    metadata
  } = req.body;

  // Validation
  if (!name && !email && !phone) {
    return res.status(400).json({
      success: false,
      error: 'At least one of name, email, or phone is required'
    });
  }

  // Email validation
  if (email && !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid email format'
    });
  }

  // Phone validation (if provided)
  let validatedPhone = phone;
  if (phone) {
    const phoneValidation = validatePhoneNumber(phone);
    if (phoneValidation.isValid) {
      validatedPhone = phoneValidation.formatted;
    }
  }

  if (!this.supabase) {
    return res.status(503).json({
      success: false,
      error: 'Database not configured'
    });
  }

  try {
    // Get request metadata
    const ip_address = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const user_agent = req.headers['user-agent'];
    const referrer = req.headers['referer'] || req.headers['referrer'];

    // Prepare lead data
    const leadData = {
      name: name || null,
      email: email || null,
      phone: validatedPhone || null,
      company: company || null,
      lead_source: lead_source || 'api',
      lead_status: lead_status,
      lead_priority: lead_priority,
      message: message || null,
      notes: notes || null,
      metadata: metadata || null,
      ip_address: ip_address,
      user_agent: user_agent,
      referrer: referrer,
      created_at: new Date().toISOString()
    };
    // Insert lead into database using ORM
    const lead = await models.Lead.create(leadData);

    res.status(201).json({
      success: true,
      message: 'Lead created successfully',
      data: lead
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

// GET endpoint to retrieve leads with pagination and filtering
app.get('/api/leads', async (req, res) => {
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
  } = req.query;

  if (!this.supabase) {
    return res.status(503).json({
      success: false,
      error: 'Database not configured'
    });
  }

  try {
    // Use Lead ORM findAll method with filters and pagination
    const result = await models.Lead.findAll({
      limit,
      offset,
      status,
      priority,
      source,
      search,
      dateFrom,
      dateTo,
      sortBy,
      sortOrder
    });

    res.json({
      success: true,
      data: result.data,
      pagination: result.pagination,
      filters: { status, priority, source, search, dateFrom, dateTo },
      sorting: { sortBy, sortOrder }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

// GET endpoint to retrieve a single lead by ID
app.get('/api/leads/:id', async (req, res) => {
  const { id } = req.params;

  if (!this.supabase) {
    return res.status(503).json({
      success: false,
      error: 'Database not configured'
    });
  }

  try {
    const lead = await models.Lead.findById(id);

    if (!lead) {
      return res.status(404).json({
        success: false,
        error: 'Lead not found',
        id: id
      });
    }

    res.json({
      success: true,
      data: lead
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

// PUT endpoint to update a lead
app.put('/api/leads/:id', async (req, res) => {
  const { id } = req.params;
  const {
    name,
    email,
    phone,
    company,
    lead_source,
    lead_status,
    lead_priority,
    message,
    notes,
    metadata,
    last_contacted_at
  } = req.body;

  if (!this.supabase) {
    return res.status(503).json({
      success: false,
      error: 'Database not configured'
    });
  }

  try {
    // Build update object dynamically
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (email !== undefined) updateData.email = email;
    if (phone !== undefined) updateData.phone = phone;
    if (company !== undefined) updateData.company = company;
    if (lead_source !== undefined) updateData.lead_source = lead_source;
    if (lead_status !== undefined) updateData.lead_status = lead_status;
    if (lead_priority !== undefined) updateData.lead_priority = lead_priority;
    if (message !== undefined) updateData.message = message;
    if (notes !== undefined) updateData.notes = notes;
    if (metadata !== undefined) updateData.metadata = metadata;
    if (last_contacted_at !== undefined) updateData.last_contacted_at = last_contacted_at;

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No fields to update'
      });
    }

    const lead = await models.Lead.update(id, updateData);

    if (!lead) {
      return res.status(404).json({
        success: false,
        error: 'Lead not found',
        id: id
      });
    }

    res.json({
      success: true,
      message: 'Lead updated successfully',
      data: lead
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

// POST endpoint to bulk import leads from file (CSV/JSON)
app.post('/api/leads/import', async (req, res) => {
  // Check for file in request
  if (!req.files || !req.files.file) {
    return res.status(400).json({
      success: false,
      error: 'No file provided',
      message: 'Please upload a CSV or JSON file'
    });
  }

  if (!this.supabase) {
    return res.status(503).json({
      success: false,
      error: 'Database not configured'
    });
  }

  try {
    const file = req.files.file;
    const fileBuffer = file.data;
    const fileName = file.name;
    const mimeType = file.mimetype;

    console.log(`📁 Processing file upload: ${fileName} (${mimeType})`);

    // Parse file to extract lead data
    let leads = parseFile(fileBuffer, mimeType || fileName);

    if (!leads || leads.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid leads found in file',
        message: 'File may be empty or improperly formatted'
      });
    }

    console.log(`📋 Parsed ${leads.length} records from file`);

    // Validate leads
    const { valid, invalid, errors } = validateLeads(leads);

    console.log(`✅ Valid: ${valid.length}, ❌ Invalid: ${invalid.length}`);

    if (valid.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid leads to import',
        validationErrors: errors,
        summary: {
          total: leads.length,
          valid: 0,
          invalid: invalid.length
        }
      });
    }

    // Add metadata for bulk import
    const leadsToInsert = valid.map(lead => ({
      ...lead,
      ip_address: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
      user_agent: req.headers['user-agent'],
      created_at: new Date().toISOString()
    }));

    // Bulk insert into database
    const { data: insertedLeads, error: insertError } = await this.supabase
      .from('leads')
      .insert(leadsToInsert)
      .select();

    if (insertError) {
      throw insertError;
    }

    console.log(`💾 Successfully inserted ${insertedLeads.length} leads into database`);

    res.status(201).json({
      success: true,
      message: `${insertedLeads.length} leads imported successfully`,
      summary: {
        total: leads.length,
        valid: valid.length,
        invalid: invalid.length,
        imported: insertedLeads.length
      },
      data: insertedLeads,
      validationWarnings: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('Error processing file upload:', error.message || error);
    res.status(500).json({
      success: false,
      error: 'Failed to import leads',
      message: error.message || String(error)
    });
  }
});

// Endpoint to make an outbound call
app.post('/make-call', async (req, res) => {
  const { to, message } = req.body;

  if (!to) {
    return res.status(400).json({ error: 'Phone number is required' });
  }

  // Validate phone number
  const validation = validatePhoneNumber(to);
  if (!validation.isValid) {
    return res.status(400).json({ 
      error: validation.error,
      providedNumber: validation.original
    });
  }

  try {
    const call = await client.calls.create({
      url: `${publicUrl}/voice-response?message=${encodeURIComponent(message || 'Hello from Twilio!')}`,
      to: validation?.formatted, // Use validated and formatted number
      from: twilioPhoneNumber,
      statusCallback: `${publicUrl}/call-events`,
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    });

    res.json({
      success: true,
      callSid: call.sid,
      message: 'Call initiated successfully',
      to: validation?.formatted,
      country: validation?.country
    });
  } catch (error) {
    console.error('Error making call:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint to handle incoming calls
app.post('/incoming-call', (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  
  twiml.say({ voice: 'alice' }, 'Hello! Thank you for calling. This is a Twilio powered voice application.');
  twiml.pause({ length: 1 });
  twiml.say({ voice: 'alice' }, 'Press 1 to continue or hang up to end the call.');
  
  twiml.gather({
    numDigits: 1,
    action: '/handle-key',
    method: 'POST'
  });

  res.type('text/xml');
  res.send(twiml.toString());
});

// Handle key press from incoming call
app.post('/handle-key', (req, res) => {
  const digit = req.body.Digits;
  const twiml = new twilio.twiml.VoiceResponse();

  if (digit === '1') {
    // Connect to media stream instead of hanging up
    twiml.say({ voice: 'alice' }, 'Connecting you to the AI assistant now.');
    
    const connect = twiml.connect();
    const publicHost = publicUrl.replace('https://', '').replace('http://', '');
    const wsUrl = `wss://${publicHost}/media-stream`;
    
    connect.stream({
      url: wsUrl,
      track: 'both_tracks'
    });
  } else {
    twiml.say({ voice: 'alice' }, 'Invalid input. Goodbye!');
    twiml.hangup();
  }

  res.type('text/xml');
  res.send(twiml.toString());
});

// Voice response endpoint (TwiML)
app.post('/voice-response', (req, res) => {
  const message = req.query.message || 'Hello from Twilio!';
  const twiml = new twilio.twiml.VoiceResponse();
  
  twiml.say({ voice: 'alice' }, message);
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// Call status callback endpoint
app.post('/call-status', (req, res) => {
  const callSid = req.body.CallSid;
  const callStatus = req.body.CallStatus;
  
  console.log(`Call ${callSid} status: ${callStatus}`);
  
  res.sendStatus(200);
});

// ============================================
// QUEUE MANAGEMENT ENDPOINTS
// ============================================

// Schedule an immediate outbound call
app.post('/api/queue/schedule-call', async (req, res) => {
  const { to, message, lead_id, priority, metadata } = req.body;

  if (!to) {
    return res.status(400).json({
      success: false,
      error: 'Phone number is required'
    });
  }

  try {
    const result = await scheduleImmediateCall({
      to,
      message: message || 'Hello from VoMindAI',
      lead_id,
      priority: priority || 'normal',
      metadata: metadata || {}
    });

    res.json({
      success: true,
      message: 'Call scheduled successfully',
      ...result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to schedule call',
      message: error.message
    });
  }
});

// Schedule a delayed outbound call
app.post('/api/queue/schedule-delayed-call', async (req, res) => {
  const { to, message, lead_id, priority, metadata, scheduleAt, delayMs } = req.body;

  if (!to) {
    return res.status(400).json({
      success: false,
      error: 'Phone number is required'
    });
  }

  if (!scheduleAt && !delayMs) {
    return res.status(400).json({
      success: false,
      error: 'Either scheduleAt (ISO date) or delayMs (milliseconds) is required'
    });
  }

  try {
    const delay = scheduleAt ? new Date(scheduleAt) : parseInt(delayMs);
    
    const result = await scheduleDelayedCall({
      to,
      message: message || 'Hello from VoMindAI',
      lead_id,
      priority: priority || 'normal',
      metadata: metadata || {}
    }, delay);

    res.json({
      success: true,
      message: 'Delayed call scheduled successfully',
      ...result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to schedule delayed call',
      message: error.message
    });
  }
});

// Schedule a recurring call
app.post('/api/queue/schedule-recurring-call', async (req, res) => {
  const { to, message, lead_id, priority, metadata, cronExpression } = req.body;

  if (!to || !cronExpression) {
    return res.status(400).json({
      success: false,
      error: 'Phone number and cron expression are required'
    });
  }

  try {
    const result = await scheduleRecurringCall({
      to,
      message: message || 'Hello from VoMindAI',
      lead_id,
      priority: priority || 'normal',
      metadata: metadata || {}
    }, cronExpression);

    res.json({
      success: true,
      message: 'Recurring call scheduled successfully',
      ...result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to schedule recurring call',
      message: error.message
    });
  }
});

// Schedule bulk calls
app.post('/api/queue/schedule-bulk-calls', async (req, res) => {
  const { calls } = req.body;

  if (!calls || !Array.isArray(calls) || calls.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Calls array is required and must not be empty'
    });
  }

  try {
    const results = await scheduleBulkCalls(calls);

    res.json({
      success: true,
      message: `${results.length} calls scheduled successfully`,
      jobs: results
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to schedule bulk calls',
      message: error.message
    });
  }
});

// Get job status
app.get('/api/queue/job/:jobId', async (req, res) => {
  const { jobId } = req.params;

  try {
    const status = await getJobStatus(jobId);

    if (status.error) {
      return res.status(404).json({
        success: false,
        error: status.error
      });
    }

    res.json({
      success: true,
      ...status
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get job status',
      message: error.message
    });
  }
});

// Cancel a scheduled call
app.delete('/api/queue/job/:jobId', async (req, res) => {
  const { jobId } = req.params;

  try {
    const cancelled = await cancelCall(jobId);

    if (!cancelled) {
      return res.status(404).json({
        success: false,
        error: 'Job not found'
      });
    }

    res.json({
      success: true,
      message: 'Call cancelled successfully',
      jobId
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to cancel call',
      message: error.message
    });
  }
});

// Retry a failed call
app.post('/api/queue/job/:jobId/retry', async (req, res) => {
  const { jobId } = req.params;

  try {
    const result = await retryCall(jobId);

    res.json({
      success: true,
      message: 'Call retry initiated',
      ...result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to retry call',
      message: error.message
    });
  }
});

// Get queue statistics
app.get('/api/queue/stats', async (req, res) => {
  try {
    const stats = await getQueueStats();

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get queue stats',
      message: error.message
    });
  }
});

// Get call statistics (total, completed, failed)
app.get('/api/call-stats', async (req, res) => {
  if (!this.supabase) {
    return res.status(503).json({
      success: false,
      error: 'Database not configured'
    });
  }

  try {
    // Total calls
    const { count: totalCount, error: totalErr } = await this.supabase
      .from('call_events')
      .select('*', { count: 'exact' });

    if (totalErr) throw totalErr;

    // Completed calls
    const { count: completedCount, error: completedErr } = await this.supabase
      .from('call_events')
      .select('*', { count: 'exact' })
      .eq('call_status', 'completed');

    if (completedErr) throw completedErr;

    // Failed calls
    const { count: failedCount, error: failedErr } = await this.supabase
      .from('call_events')
      .select('*', { count: 'exact' })
      .eq('call_status', 'failed');

    if (failedErr) throw failedErr;

    res.json({
      success: true,
      stats: {
        total: totalCount || 0,
        completed: completedCount || 0,
        failed: failedCount || 0
      }
    });
  } catch (error) {
    console.error('Error fetching call stats:', error.message || error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch call statistics',
      message: error.message || String(error)
    });
  }
});

// Get lead statistics (total, new, contacted)
app.get('/api/lead-stats', async (req, res) => {
  if (!this.supabase) {
    return res.status(503).json({
      success: false,
      error: 'Database not configured'
    });
  }

  try {
    // Total leads
    const { count: totalCount, error: totalErr } = await this.supabase
      .from('leads')
      .select('*', { count: 'exact' });
    if (totalErr) throw totalErr;

    // New leads (lead_status = 'new')
    const { count: newCount, error: newErr } = await this.supabase
      .from('leads')
      .select('*', { count: 'exact' })
      .eq('lead_status', 'new');
    if (newErr) throw newErr;

    // Contacted leads (lead_status = 'contacted')
    const { count: contactedCount, error: contactedErr } = await this.supabase
      .from('leads')
      .select('*', { count: 'exact' })
      .eq('lead_status', 'contacted');
    if (contactedErr) throw contactedErr;

    res.json({
      success: true,
      stats: {
        total: totalCount || 0,
        new: newCount || 0,
        contacted: contactedCount || 0
      }
    });
  } catch (error) {
    console.error('Error fetching lead stats:', error.message || error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch lead statistics',
      message: error.message || String(error)
    });
  }
});

// Get waiting jobs
app.get('/api/queue/waiting', async (req, res) => {
  const { start = 0, end = 10 } = req.query;

  try {
    const jobs = await getWaitingJobs(parseInt(start), parseInt(end));

    res.json({
      success: true,
      count: jobs.length,
      jobs
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get waiting jobs',
      message: error.message
    });
  }
});

// Get active jobs
app.get('/api/queue/active', async (req, res) => {
  const { start = 0, end = 10 } = req.query;

  try {
    const jobs = await getActiveJobs(parseInt(start), parseInt(end));

    res.json({
      success: true,
      count: jobs.length,
      jobs
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get active jobs',
      message: error.message
    });
  }
});

// Get failed jobs
app.get('/api/queue/failed', async (req, res) => {
  const { start = 0, end = 10 } = req.query;

  try {
    const jobs = await getFailedJobs(parseInt(start), parseInt(end));

    res.json({
      success: true,
      count: jobs.length,
      jobs
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get failed jobs',
      message: error.message
    });
  }
});

// Clean old jobs
app.post('/api/queue/clean', async (req, res) => {
  const { grace = 3600000, limit = 1000 } = req.body;

  try {
    const result = await cleanOldJobs(parseInt(grace), parseInt(limit));

    res.json({
      success: true,
      message: 'Old jobs cleaned',
      ...result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to clean jobs',
      message: error.message
    });
  }
});

// Pause the queue
app.post('/api/queue/pause', async (req, res) => {
  try {
    await pauseQueue();

    res.json({
      success: true,
      message: 'Queue paused'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to pause queue',
      message: error.message
    });
  }
});

// Resume the queue
app.post('/api/queue/resume', async (req, res) => {
  try {
    await resumeQueue();

    res.json({
      success: true,
      message: 'Queue resumed'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to resume queue',
      message: error.message
    });
  }
});

// ============================================
// END QUEUE MANAGEMENT ENDPOINTS
// ============================================

// Call events tracking endpoint for outgoing calls
app.post('/call-events', async (req, res) => {
  const {
    CallSid,
    CallStatus,
    Direction,
    From,
    To,
    Duration,
    Timestamp,
    CallDuration,
    RecordingUrl,
    RecordingSid
  } = req.body;
  
  // Save call event to database using ORM
  try {
    const callEvent = await models.CallEvent.upsert({
      call_sid: CallSid,
      call_status: CallStatus,
      direction: Direction,
      from_number: From,
      to_number: To,
      duration: Duration,
      call_duration: CallDuration,
      recording_url: RecordingUrl,
      recording_sid: RecordingSid,
      timestamp: Timestamp ? new Date(Timestamp).toISOString() : new Date().toISOString()
    });

    // Respond to acknowledge receipt
    res.status(200).json({
      success: true,
      message: 'Call event received and saved',
      callSid: CallSid,
      status: CallStatus,
      data: callEvent
    });
    
  } catch (error) {
    // Still respond 200 to Twilio to prevent retries
    res.status(200).json({
      success: false,
      message: 'Call event received but database save failed',
      error: error.message,
      callSid: CallSid,
      status: CallStatus
    });
  }
});

// Endpoint to start media stream
app.post('/start-media-stream', async (req, res) => {
  const { to, message } = req.body;

  if (!to) {
    return res.status(400).json({ error: 'Phone number is required' });
  }

  // Validate phone number
  const validation = validatePhoneNumber(to);
  
  if (!validation.isValid) {
    return res.status(400).json({ 
      error: validation.error,
      providedNumber: validation.original
    });
  }
  const twimlUrl = `${publicUrl}/media-stream-twiml`;
  try {
    const call = await client.calls.create({
      url: twimlUrl,
      to: validation.formatted,
      from: twilioPhoneNumber,
      statusCallback: `${publicUrl}/call-events`,
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    });
    res.json({
      success: true,
      callSid: call.sid,
      message: 'Media stream call initiated successfully',
      to: validation.formatted,
      country: validation.country,
      twimlUrl: twimlUrl
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// POST endpoint to retrieve call events with pagination, sorting, and search
app.post('/api/agentCallLogs', async (req, res) => {
  const params = req.body && Object.keys(req.body).length > 0 ? req.body : req.query;
  const {
    limit = 50,
    offset = 0,
    sortBy = 'created_at',
    sortOrder = 'desc',
    status,
    direction,
    search,
    from,
    to,
    dateFrom,
    dateTo
  } = params;

  if (!this.supabase) {
    return res.status(503).json({
      success: false,
      error: 'Database not configured'
    });
  }

  try {
    // Build the query
    let query = this.supabase
      .from('call_events')
      .select('*', { count: 'exact' });

    // Apply filters
    if (status) {
      query = query.eq('call_status', status);
    }

    if (direction) {
      query = query.eq('direction', direction);
    }

    if (from) {
      query = query.eq('from_number', from);
    }

    if (to) {
      query = query.eq('to_number', to);
    }

    // Search across multiple fields
    if (search) {
      query = query.or(`call_sid.ilike.%${search}%,from_number.ilike.%${search}%,to_number.ilike.%${search}%`);
    }

    // Date range filtering
    if (dateFrom) {
      query = query.gte('created_at', dateFrom);
    }

    if (dateTo) {
      query = query.lte('created_at', dateTo);
    }

    // Sorting
    const validSortFields = ['created_at', 'updated_at', 'call_status', 'duration', 'call_duration', 'timestamp'];
    const validSortOrders = ['asc', 'desc'];
    
    const finalSortBy = validSortFields.includes(sortBy) ? sortBy : 'created_at';
    const finalSortOrder = validSortOrders.includes(sortOrder.toLowerCase()) ? sortOrder.toLowerCase() : 'desc';
    
    query = query.order(finalSortBy, { ascending: finalSortOrder === 'asc' });

    // Pagination
    const limitNum = Math.min(parseInt(limit), 100); // Max 100 per request
    const offsetNum = parseInt(offset);
    query = query.range(offsetNum, offsetNum + limitNum - 1);

    // Execute query
    const { data, error, count } = await query;
    if (error) {
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch call events',
        details: error.message
      });
    }

    // Calculate pagination info
    const totalPages = Math.ceil(count / limitNum);
    const currentPage = Math.floor(offsetNum / limitNum) + 1;
    const hasNextPage = offsetNum + limitNum < count;
    const hasPrevPage = offsetNum > 0;

    res.json({
      success: true,
      data: data,
      pagination: {
        total: count,
        count: data.length,
        limit: limitNum,
        offset: offsetNum,
        currentPage: currentPage,
        totalPages: totalPages,
        hasNextPage: hasNextPage,
        hasPrevPage: hasPrevPage
      },
      filters: {
        status,
        direction,
        search,
        from,
        to,
        dateFrom,
        dateTo
      },
      sorting: {
        sortBy: finalSortBy,
        sortOrder: finalSortOrder
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});


// TwiML endpoint for media stream (supports both GET and POST)
const handleMediaStreamTwiml = (req, res) => {
  try {
    const twiml = new twilio.twiml.VoiceResponse();
    
    // Use Connect + Stream for BIDIRECTIONAL audio (user can hear AI responses)
    const publicHost = publicUrl.replace('https://', '').replace('http://', '');
    const wsUrl = `wss://${publicHost}/media-stream`;
    const connect = twiml.connect();
    connect.stream({
      url: wsUrl
    });
  
    
    const twimlResponse = twiml.toString();
    
    res.type('text/xml');
    res.send(twimlResponse);
  } catch (error) {
    console.error('Error in handleMediaStreamTwiml:', error);
    res.status(500).send('Internal Server Error');
  }
};

app.post('/media-stream-twiml', handleMediaStreamTwiml);
app.get('/media-stream-twiml', handleMediaStreamTwiml);

// WebSocket handler for media streams with OpenAI Realtime API
const activeSessions = new Map();
const openAISessions = new Map();


wss.on('connection', async (ws, req) => {
  
  let sessionData = {
    callSid: null,
    streamSid: null,
    audioBuffer: [],
    openAISession: null
  };

  ws.on('message', async (message) => {
    try {
      const msg = JSON.parse(message);
      
      switch (msg.event) {
        case 'connected':
          console.log('Media stream connected:', msg);
          break;
          
        case 'start':
          sessionData.callSid = msg.start.callSid;
          sessionData.streamSid = msg.start.streamSid;
          activeSessions.set(sessionData.callSid, sessionData);
          
          // Initialize OpenAI Realtime session with retry logic
          let retryCount = 0;
          const maxRetries = 3;
          let openAIInitialized = false;
          
          while (retryCount < maxRetries && !openAIInitialized) {
            try {
              const openAISession = new OpenAIRealtimeSession(
                sessionData.callSid,
                sessionData.streamSid,
                models
              );
              await openAISession.connect();
              openAISession.setTwilioWebSocket(ws);
              
              sessionData.openAISession = openAISession;
              openAISessions.set(sessionData.callSid, openAISession);
              openAIInitialized = true;
              
              console.log(`[${sessionData.callSid}] ✅ OpenAI Realtime session initialized`);
            } catch (error) {
              retryCount++;
              console.error(`[${sessionData.callSid}] ❌ Failed to initialize OpenAI (attempt ${retryCount}/${maxRetries}):`, error.message);
              
              if (retryCount < maxRetries) {
                console.log(`[${sessionData.callSid}] Retrying in ${retryCount} seconds...`);
                await new Promise(resolve => setTimeout(resolve, retryCount * 1000));
              } else {
                console.error(`[${sessionData.callSid}] ⚠️ All OpenAI connection attempts failed. Operating in fallback mode.`);
                
                // Send a clear message to the user about the failure
                try {
                  const fallbackMessage = {
                    event: 'clear',
                    streamSid: sessionData.streamSid
                  };
                  ws.send(JSON.stringify(fallbackMessage));
                  console.log(`[${sessionData.callSid}] Sent fallback notification to caller`);
                } catch (notifyError) {
                  console.error(`[${sessionData.callSid}] Failed to send fallback notification:`, notifyError.message);
                }
              }
            }
          }
          break;
          
        case 'media':
          // Handle incoming audio data from caller
          if (msg.media.track === 'inbound' && sessionData.openAISession) {
            // Send audio to OpenAI for processing
            sessionData.openAISession.handleIncomingAudio(msg.media.payload);
          }
          
          // Store audio for debugging/logging
          sessionData.audioBuffer.push({
            timestamp: msg.media.timestamp,
            payload: msg.media.payload,
            track: msg.media.track
          });
          
          // Clear buffer periodically
          if (sessionData.audioBuffer.length >= 1000) {
            console.log(`[${sessionData.callSid}] Processed ${sessionData.audioBuffer.length} audio packets`);
            sessionData.audioBuffer = [];
          }
          break;
          
        case 'stop':
          console.log(`Media stream stopped for call: ${sessionData.callSid}`);
          
          // Get conversation history before closing
          if (sessionData.openAISession) {
            const history = sessionData.openAISession.getConversationHistory();
            console.log(`[${sessionData.callSid}] Conversation history:`, JSON.stringify(history, null, 2));
            
            // Close OpenAI session
            sessionData.openAISession.close();
            openAISessions.delete(sessionData.callSid);
          }
          
          activeSessions.delete(sessionData.callSid);
          break;
          
        default:
          console.log(`[${sessionData.callSid}] Unknown event:`, msg.event);
      }
    } catch (error) {
      console.error('Error processing WebSocket message:', error);
    }
  });

  ws.on('close', () => {
    console.log('WebSocket connection closed');
    if (sessionData.callSid) {
      // Cleanup
      if (sessionData.openAISession) {
        sessionData.openAISession.close();
        openAISessions.delete(sessionData.callSid);
      }
      activeSessions.delete(sessionData.callSid);
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Endpoint to get active media stream sessions
app.get('/active-streams', (req, res) => {
  const sessions = Array.from(activeSessions.entries()).map(([callSid, data]) => ({
    callSid,
    streamSid: data.streamSid,
    bufferSize: data.audioBuffer.length,
    openAIConnected: data.openAISession ? data.openAISession.isConnected : false
  }));
  
  res.json({
    count: sessions.length,
    sessions
  });
});

// Endpoint to get conversation history for a specific call
app.get('/conversation/:callSid', (req, res) => {
  const { callSid } = req.params;
  const openAISession = openAISessions.get(callSid);
  console.log(`[${callSid}] Fetching conversation history`);
  if (!openAISession) {
    return res.status(404).json({
      error: 'Call not found or session ended',
      callSid
    });
  }
  
  const history = openAISession.getConversationHistory();
  res.json({
    callSid,
    conversationHistory: history,
    messageCount: history.length
  });
});

// Endpoint to get conversation transcripts from database
app.get('/api/transcripts/:callSid', async (req, res) => {
  const { callSid } = req.params;
  
  if (!this.supabase) {
    return res.status(503).json({
      error: 'Database not configured',
      callSid
    });
  }
  
  try {
    const transcripts = await models.ConversationTranscript.findByCallSid(callSid);
    
    res.json({
      callSid,
      transcripts: transcripts,
      messageCount: transcripts.length,
      success: true
    });
  } catch (error) {
    console.error('Exception fetching transcripts:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
      callSid
    });
  }
});

// Endpoint to get all transcripts with pagination
app.get('/transcripts', async (req, res) => {
  const { limit = 100, offset = 0 } = req.query;
  
  if (!this.supabase) {
    return res.status(503).json({
      error: 'Database not configured'
    });
  }
  
  try {
    const result = await models.ConversationTranscript.findAll({
      limit,
      offset,
      sortBy: 'timestamp',
      sortOrder: 'desc'
    });
    
    res.json({
      transcripts: result.data,
      count: result.pagination.count,
      total: result.pagination.total,
      limit: parseInt(limit),
      offset: parseInt(offset),
      success: true
    });
  } catch (error) {
    console.error('Exception fetching transcripts:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// Start the server
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`WebSocket server ready for media streams`);
  console.log(`PUBLIC_URL configured as: ${publicUrl}`);
  console.log(`Media stream TwiML endpoint: ${publicUrl}/media-stream-twiml`);
  
  // Check if PUBLIC_URL is localhost (which won't work with Twilio)
  if (publicUrl.includes('localhost') || publicUrl.includes('127.0.0.1')) {
    console.warn('⚠️  WARNING: PUBLIC_URL is set to localhost!');
    console.warn('⚠️  Twilio cannot reach localhost. Please use ngrok and set PUBLIC_URL in .env');
  }
});

// Graceful shutdown handling
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

async function gracefulShutdown() {
  console.log('\n📞 Shutting down gracefully...');
  
  try {
    // Close WebSocket server
    wss.close(() => {
      console.log('✅ WebSocket server closed');
    });
    
    // Close HTTP server
    server.close(() => {
      console.log('✅ HTTP server closed');
    });
    
    // Close call worker
    if (callWorker) {
      await closeWorker(callWorker);
      console.log('✅ Call worker closed');
    }
    
    // Close queue connections
    await closeQueue();
    console.log('✅ Queue connections closed');
    
    console.log('👋 Shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
}
