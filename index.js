require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const twilio = require('twilio');
const { createClient } = require('@supabase/supabase-js');
const { validatePhoneNumber } = require('./utils/phoneValidator');
const OpenAIRealtimeSession = require('./utils/openAIRealtime');

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

// Initialize Twilio client
const client = twilio(accountSid, authToken);

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
    // Insert lead into database
    const { data, error } = await this.supabase
      .from('leads')
      .insert([leadData])
      .select();

    if (error) {
      return res.status(500).json({
        success: false,
        error: 'Failed to create lead',
        details: error.message
      });
    }

    res.status(201).json({
      success: true,
      message: 'Lead created successfully',
      data: data[0]
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
    let query = supabase
      .from('leads')
      .select('*', { count: 'exact' });

    // Apply filters
    if (status) {
      query = query.eq('lead_status', status);
    }

    if (priority) {
      query = query.eq('lead_priority', priority);
    }

    if (source) {
      query = query.eq('lead_source', source);
    }

    // Search across multiple fields
    if (search) {
      query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%,company.ilike.%${search}%`);
    }

    // Date range filtering
    if (dateFrom) {
      query = query.gte('created_at', dateFrom);
    }

    if (dateTo) {
      query = query.lte('created_at', dateTo);
    }

    // Sorting
    const validSortFields = ['created_at', 'updated_at', 'name', 'email', 'lead_status', 'lead_priority'];
    const finalSortBy = validSortFields.includes(sortBy) ? sortBy : 'created_at';
    const finalSortOrder = ['asc', 'desc'].includes(sortOrder.toLowerCase()) ? sortOrder.toLowerCase() : 'desc';
    
    query = query.order(finalSortBy, { ascending: finalSortOrder === 'asc' });

    // Pagination
    const limitNum = Math.min(parseInt(limit), 100);
    const offsetNum = parseInt(offset);
    query = query.range(offsetNum, offsetNum + limitNum - 1);

    const { data, error, count } = await query;

    if (error) {
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch leads',
        details: error.message
      });
    }

    const totalPages = Math.ceil(count / limitNum);
    const currentPage = Math.floor(offsetNum / limitNum) + 1;

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
        hasNextPage: offsetNum + limitNum < count,
        hasPrevPage: offsetNum > 0
      },
      filters: { status, priority, source, search, dateFrom, dateTo },
      sorting: { sortBy: finalSortBy, sortOrder: finalSortOrder }
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
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({
          success: false,
          error: 'Lead not found',
          id: id
        });
      }
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch lead',
        details: error.message
      });
    }

    res.json({
      success: true,
      data: data
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

    const { data, error } = await this.supabase
      .from('leads')
      .update(updateData)
      .eq('id', id)
      .select();

    if (error) {
      return res.status(500).json({
        success: false,
        error: 'Failed to update lead',
        details: error.message
      });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Lead not found',
        id: id
      });
    }

    res.json({
      success: true,
      message: 'Lead updated successfully',
      data: data[0]
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
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
  
  // Save call event to Supabase database
  try {
  const { data, error } = await this.supabase
    .from('call_events')
    .upsert({
      call_sid: CallSid,
      call_status: CallStatus,
      direction: Direction,
      from_number: From,
      to_number: To,
      duration: Duration,
      call_duration: CallDuration,
      recording_url: RecordingUrl,
      recording_sid: RecordingSid,
      timestamp: new Date(Timestamp)
    }, 
    { 
      onConflict: 'call_sid',
      ignoreDuplicates: false 
    })
    .select();

  if (error) {
    throw error;
  }

    // Respond to acknowledge receipt
    res.status(200).json({
      success: true,
      message: 'Call event received and saved',
      callSid: CallSid,
      status: CallStatus,
      dbOperation: 'created'
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
app.post('/agentCallLogs', async (req, res) => {
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
                sessionData.streamSid
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
app.get('/transcripts/:callSid', async (req, res) => {
  const { callSid } = req.params;
  
  if (!this.supabase) {
    return res.status(503).json({
      error: 'Database not configured',
      callSid
    });
  }
  
  try {
    const { data, error } = await this.supabase
      .from('conversation_transcripts')
      .select('*')
      .eq('call_sid', callSid)
      .order('timestamp', { ascending: true });
    
    if (error) {
      console.error('Error fetching transcripts:', error);
      return res.status(500).json({
        error: 'Failed to fetch transcripts',
        details: error.message,
        callSid
      });
    }
    
    res.json({
      callSid,
      transcripts: data,
      messageCount: data.length,
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
    const { data, error, count } = await this.supabase
      .from('conversation_transcripts')
      .select('*', { count: 'exact' })
      .order('timestamp', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);
    
    if (error) {
      console.error('Error fetching transcripts:', error);
      return res.status(500).json({
        error: 'Failed to fetch transcripts',
        details: error.message
      });
    }
    
    res.json({
      transcripts: data,
      count: data.length,
      total: count,
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
