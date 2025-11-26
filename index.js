require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const twilio = require('twilio');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { validatePhoneNumber } = require('./utils/phoneValidator');
const OpenAIRealtimeSession = require('./utils/openAIRealtime');
const RecordingManager = require('./utils/recordingManager');
const { initializeModels } = require('./models');
const {
  scheduleImmediateCall,
  scheduleDelayedCall,
  scheduleRecurringCall,
  scheduleBulkCalls,
  scheduleLeadAutomation,
  getAutomationSchedules,
  stopAutomation,
  fetchAndScheduleNewLeads,
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

// Initialize Twilio client
const client = twilio(accountSid, authToken);

// Supabase configuration
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
// Use service role key on the server to bypass RLS for backend operations (required for uploads/inserts)
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || null;
const supabaseClientKey = supabaseServiceRoleKey || supabaseAnonKey;
const supabase = (supabaseUrl && supabaseClientKey) ? createClient(supabaseUrl, supabaseClientKey) : null;

// Initialize ORM models
const models = supabase ? initializeModels(supabase) : null;

// Initialize Recording Manager
let recordingManager = null;
if (supabase && models && client) {
  recordingManager = new RecordingManager(client, supabase, models);
  console.log('🎙️  Recording Manager initialized');
}

// Initialize call queue worker
let callWorker = null;
try {
  callWorker = createCallWorker(models, supabase);
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

// ============================================
// SHOPIFY WEBHOOK HANDLER - Abandoned Cart
// ============================================

/**
 * Verifies Shopify webhook HMAC signature
 * @param {string} requestBody - Raw request body as string
 * @param {string} hmacHeader - X-Shopify-Hmac-SHA256 header value
 * @returns {boolean} True if signature is valid
 */
const verifyShopifyWebhook = (requestBody, hmacHeader) => {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('⚠️  SHOPIFY_WEBHOOK_SECRET not configured');
    return false;
  }

  const hmac = crypto
    .createHmac('sha256', secret)
    .update(requestBody, 'utf8')
    .digest('base64');

  return hmac === hmacHeader;
};

/**
 * Shopify webhook endpoint for abandoned cart notifications
 * Captures cart data and creates a lead record
 */
app.post('/shopify/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const hmacHeader = req.headers['x-shopify-hmac-sha256'];
  const topic = req.headers['x-shopify-topic'] || 'unknown';
  
  // Get raw body for HMAC verification
  const rawBody = req.body.toString('utf8');

  // Verify HMAC signature
  if (!verifyShopifyWebhook(rawBody, hmacHeader)) {
    console.warn('🚨 Shopify webhook HMAC verification failed');
    return res.status(401).json({
      success: false,
      error: 'Invalid HMAC signature'
    });
  }

  console.log(`✅ Shopify webhook verified - Topic: ${topic}`);

  try {
    // Parse JSON body
    const payload = JSON.parse(rawBody);

    if (!supabase || !models) {
      console.warn('⚠️  Database not configured for Shopify webhook');
      return res.status(503).json({
        success: false,
        error: 'Database not configured'
      });
    }

    // Extract relevant data based on topic
    let leadData = null;

    if (topic.includes('cart/') || topic.includes('abandoned_cart')) {
      // Handle abandoned cart / checkout webhook
      leadData = await processShopifyAbandonedCart(payload);
    } else if (topic.includes('customer/')) {
      // Handle customer webhook
      leadData = await processShopifyCustomer(payload);
    } else {
      console.log(`📋 Shopify webhook topic '${topic}' not configured for lead creation`);
      return res.status(200).json({
        success: true,
        message: 'Webhook received but not processed'
      });
    }

    if (!leadData || !leadData.email) {
      console.log('⚠️  No valid lead data extracted from Shopify webhook');
      return res.status(200).json({
        success: true,
        message: 'Webhook received, no lead data'
      });
    }

    // Create lead in database
    const lead = await models.Lead.create({
      name: leadData.name || null,
      email: leadData.email,
      phone: leadData.phone || null,
      company: leadData.company || null,
      lead_source: 'shopify',
      lead_status: 'new',
      lead_priority: leadData.priority || 'medium',
      message: leadData.message || null,
      notes: leadData.notes || null,
      metadata: leadData.metadata,
      ip_address: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
      user_agent: req.headers['user-agent'],
      created_at: new Date().toISOString()
    });

    console.log(`✅ Lead created from Shopify webhook - ID: ${lead.id}, Email: ${lead.email}`);

    res.status(201).json({
      success: true,
      message: 'Lead created successfully from Shopify webhook',
      leadId: lead.id,
      email: lead.email
    });

  } catch (error) {
    console.error('❌ Error processing Shopify webhook:', error.message);
    // Still return 200 to prevent Shopify from retrying
    res.status(200).json({
      success: false,
      message: 'Webhook received but processing failed',
      error: error.message
    });
  }
});

/**
 * Process Shopify abandoned cart payload
 * Extracts customer and cart information
 */
async function processShopifyAbandonedCart(payload) {
  try {
    // Payload can be either cart or checkout object
    const cart = payload.cart || payload;
    const customer = cart.customer || {};
    const email = customer.email || cart.email;

    if (!email) {
      console.warn('⚠️  No email found in Shopify abandoned cart payload');
      return null;
    }

    // Extract cart totals and items
    const cartTotal = cart.subtotal_price || cart.total_price || 0;
    const cartItems = (cart.line_items || []).map(item => ({
      title: item.title,
      quantity: item.quantity,
      price: item.price,
      sku: item.sku
    }));

    // Format phone if present
    let phone = customer.phone || null;
    if (phone) {
      const phoneValidation = validatePhoneNumber(phone);
      phone = phoneValidation.isValid ? phoneValidation.formatted : phone;
    }

    // Build metadata with cart details
    const metadata = {
      shopify_cart_token: cart.token,
      shopify_customer_id: customer.id,
      cart_total: cartTotal,
      cart_items_count: (cart.line_items || []).length,
      cart_items: cartItems,
      cart_url: cart.cart_url || null,
      abandoned_at: new Date().toISOString()
    };

    return {
      name: `${customer.first_name || ''} ${customer.last_name || ''}`.trim(),
      email: email,
      phone: phone,
      company: customer.company || null,
      priority: 'high',
      notes: `Abandoned cart with ${cartItems.length} items, total: $${cartTotal}`,
      message: `Customer abandoned cart containing ${cartItems.map(i => i.title).join(', ')}`,
      metadata: metadata
    };
  } catch (error) {
    console.error('Error parsing Shopify abandoned cart:', error.message);
    return null;
  }
}

/**
 * Process Shopify customer payload (optional - for customer create/update webhooks)
 */
async function processShopifyCustomer(payload) {
  try {
    const customer = payload;
    const email = customer.email;

    if (!email) {
      console.warn('⚠️  No email found in Shopify customer payload');
      return null;
    }

    // Format phone if present
    let phone = customer.phone || null;
    if (phone) {
      const phoneValidation = validatePhoneNumber(phone);
      phone = phoneValidation.isValid ? phoneValidation.formatted : phone;
    }

    const metadata = {
      shopify_customer_id: customer.id,
      customer_created_at: customer.created_at,
      total_spent: customer.total_spent,
      orders_count: customer.orders_count,
      tags: customer.tags || []
    };

    return {
      name: `${customer.first_name || ''} ${customer.last_name || ''}`.trim(),
      email: email,
      phone: phone,
      company: customer.default_address?.company || null,
      priority: 'medium',
      notes: `Shopify customer with ${customer.orders_count} orders, spent $${customer.total_spent}`,
      metadata: metadata
    };
  } catch (error) {
    console.error('Error parsing Shopify customer:', error.message);
    return null;
  }
}

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

  if (!supabase) {
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

  if (!supabase) {
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

  if (!supabase) {
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

  if (!supabase) {
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

  if (!supabase) {
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
    const { data: insertedLeads, error: insertError } = await supabase
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
      record: true,
      recordingChannels: 'mono',
      recordingStatusCallback: `${publicUrl}/recording-status`,
      recordingStatusCallbackMethod: 'POST',
      recordingStatusCallbackEvent: ['completed']
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
  const { to, message, lead_id, priority, metadata, speakFirst, initialMessage } = req.body;
  console.log('Scheduling immediate call with data:', req.body);
  if (!to) {
    return res.status(400).json({
      success: false,
      error: 'Phone number is required'
    });
  }

  try {
    const callMetadata = metadata || {};
    if (speakFirst === true) {
      callMetadata.speakFirst = true;
      callMetadata.initialMessage = initialMessage || 'Hello! How can I help you today?';
    }
    
    const result = await scheduleImmediateCall({
      to,
      message: message || 'Hello from VoMindAI',
      lead_id,
      priority: priority || 'normal',
      metadata: callMetadata
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
  const { to, message, lead_id, priority, metadata, scheduleAt, delayMs, speakFirst, initialMessage } = req.body;

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
    const callMetadata = metadata || {};
    if (speakFirst === true) {
      callMetadata.speakFirst = true;
      callMetadata.initialMessage = initialMessage || 'Hello! How can I help you today?';
    }
    
    const result = await scheduleDelayedCall({
      to,
      message: message || 'Hello from VoMindAI',
      lead_id,
      priority: priority || 'normal',
      metadata: callMetadata
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
  const { to, message, lead_id, priority, metadata, cronExpression, speakFirst, initialMessage } = req.body;

  if (!to || !cronExpression) {
    return res.status(400).json({
      success: false,
      error: 'Phone number and cron expression are required'
    });
  }

  try {
    const callMetadata = metadata || {};
    if (speakFirst === true) {
      callMetadata.speakFirst = true;
      callMetadata.initialMessage = initialMessage || 'Hello! How can I help you today?';
    }
    
    const result = await scheduleRecurringCall({
      to,
      message: message || 'Hello from VoMindAI',
      lead_id,
      priority: priority || 'normal',
      metadata: callMetadata
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
  if (!supabase) {
    return res.status(503).json({
      success: false,
      error: 'Database not configured'
    });
  }

  try {
    // Total calls
    const { count: totalCount, error: totalErr } = await supabase
      .from('call_events')
      .select('*', { count: 'exact' });

    if (totalErr) throw totalErr;

    // Completed calls
    const { count: completedCount, error: completedErr } = await supabase
      .from('call_events')
      .select('*', { count: 'exact' })
      .eq('call_status', 'completed');

    if (completedErr) throw completedErr;

    // Failed calls
    const { count: failedCount, error: failedErr } = await supabase
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
  if (!supabase) {
    return res.status(503).json({
      success: false,
      error: 'Database not configured'
    });
  }

  try {
    // Total leads
    const { count: totalCount, error: totalErr } = await supabase
      .from('leads')
      .select('*', { count: 'exact' });
    if (totalErr) throw totalErr;

    // New leads (lead_status = 'new')
    const { count: newCount, error: newErr } = await supabase
      .from('leads')
      .select('*', { count: 'exact' })
      .eq('lead_status', 'new');
    if (newErr) throw newErr;

    // Contacted leads (lead_status = 'contacted')
    const { count: contactedCount, error: contactedErr } = await supabase
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

// ============================================
// LEAD AUTOMATION ENDPOINTS
// ============================================

// Schedule automation to fetch new leads and call them
app.post('/api/automation/schedule', async (req, res) => {
  const { 
    cronExpression = '0 9 * * *',
    message = 'Hello from VoMindAI. We have an opportunity for you.',
    priority = 'normal',
    leadLimit = 10
  } = req.body;

  try {
    const result = await scheduleLeadAutomation(supabase, {
      cronExpression,
      message,
      priority,
      leadLimit
    });

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to schedule automation',
      message: error.message
    });
  }
});

// Get all active automation schedules
app.get('/api/automation/schedules', async (req, res) => {
  try {
    const schedules = await getAutomationSchedules();

    res.json({
      success: true,
      count: schedules.length,
      schedules
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch automation schedules',
      message: error.message
    });
  }
});

// Stop an automation schedule
app.post('/api/automation/stop/:jobId', async (req, res) => {
  const { jobId } = req.params;

  try {
    const result = await stopAutomation(jobId);

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to stop automation',
      message: error.message
    });
  }
});

// Manually trigger automation (fetch new leads and schedule calls once)
app.post('/api/automation/run-now', async (req, res) => {
  const { 
    message = 'Hello from VoMindAI. We have an opportunity for you.',
    priority = 'normal',
    leadLimit = 10
  } = req.body;

  if (!supabase || !models) {
    return res.status(503).json({
      success: false,
      error: 'Database not configured'
    });
  }

  try {
    const result = await fetchAndScheduleNewLeads(supabase, models, {
      message,
      priority,
      leadLimit
    });

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to run automation',
      message: error.message
    });
  }
});

// ============================================
// END LEAD AUTOMATION ENDPOINTS
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

// Recording Status Callback - Triggered when recording completes
app.post('/recording-status', async (req, res) => {
  const {
    AccountSid,
    CallSid,
    RecordingSid,
    RecordingUrl,
    RecordingStatus,
    RecordingDuration,
    RecordingChannels,
    RecordingSource
  } = req.body;

  console.log(`🎙️  Recording Status Update - Call: ${CallSid}, Recording: ${RecordingSid}, Status: ${RecordingStatus}`);

  try {
    // Only process completed recordings
    if (RecordingStatus !== 'completed') {
      console.log(`⏭️  Skipping recording with status: ${RecordingStatus}`);
      return res.status(200).send('OK');
    }

    if (!recordingManager) {
      console.warn('⚠️  Recording Manager not initialized, cannot process recording');
      return res.status(200).send('OK');
    }

    // Find the associated call event to get lead_id
    let callEventId = null;
    let leadId = null;
    
    if (models && models.CallEvent) {
      try {
        const callEvent = await models.CallEvent.findByCallSid(CallSid);
        if (callEvent) {
          callEventId = callEvent.id;
          leadId = callEvent.lead_id;
        }
      } catch (eventError) {
        console.warn(`⚠️  Could not fetch call event for ${CallSid}:`, eventError.message);
      }
    }

    // Process the recording asynchronously to avoid timeout
    setImmediate(async () => {
      try {
        const result = await recordingManager.processRecording({
          recordingSid: RecordingSid,
          callSid: CallSid,
          callEventId: callEventId,
          leadId: leadId,
          duration: RecordingDuration,
          format: 'mp3'
        });

        if (result.success) {
          console.log(`✅ Recording processed and saved:`, result.recording.id);
        } else {
          console.error(`❌ Failed to process recording:`, result.error);
        }
      } catch (error) {
        console.error(`❌ Error in recording processing:`, error.message);
      }
    });

    // Return 200 immediately to Twilio
    res.status(200).send('OK');

  } catch (error) {
    console.error('Error in recording status callback:', error.message);
    // Still respond 200 to Twilio to prevent retries
    res.status(200).send('OK');
  }
});

// Endpoint to start media stream
app.post('/start-media-stream', async (req, res) => {
  const { to, message, speakFirst, initialMessage } = req.body;
  console.log('Received /start-media-stream request:', req.body);
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
  
  // Build TwiML URL with speakFirst parameters
  let twimlUrl = `${publicUrl}/media-stream-twiml`;
  if (speakFirst === true) {
    const params = new URLSearchParams({
      speakFirst: 'true',
      initialMessage: initialMessage || 'Hello! How can I help you today?'
    });
    twimlUrl += `?${params.toString()}`;
  }
  
  try {
    const call = await client.calls.create({
      url: twimlUrl,
      to: validation.formatted,
      from: twilioPhoneNumber,
      statusCallback: `${publicUrl}/call-events`,
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      record: true,
      recordingChannels: 'mono',
      recordingStatusCallback: `${publicUrl}/recording-status`,
      recordingStatusCallbackMethod: 'POST',
      recordingStatusCallbackEvent: ['completed']
    });
    res.json({
      success: true,
      callSid: call.sid,
      message: 'Media stream call initiated successfully',
      to: validation.formatted,
      country: validation.country,
      twimlUrl: twimlUrl,
      speakFirst: speakFirst === true
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

  if (!supabase) {
    return res.status(503).json({
      success: false,
      error: 'Database not configured'
    });
  }

  try {
    // Build the query
    let query = supabase
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
    // Extract speakFirst and initialMessage from query parameters first, then body
    const params = req.query || req.body || {};
    const speakFirst = params.speakFirst === 'true' || params.speakFirst === true;
    const initialMessage = params.initialMessage || 'Hello! How can I help you today?';
    
    console.log(`📺 TwiML endpoint received - speakFirst: ${speakFirst}, initialMessage: "${initialMessage}"`);
    
    // Use Connect + Stream for BIDIRECTIONAL audio (user can hear AI responses)
    const publicHost = publicUrl.replace('https://', '').replace('http://', '');
    let wsUrl = `wss://${publicHost}/media-stream`;
    
    // If speakFirst is enabled, add as query parameters to WebSocket URL
    if (speakFirst) {
      const wsParams = new URLSearchParams({
        speakFirst: 'true',
        initialMessage: initialMessage
      });
      wsUrl += `?${wsParams.toString()}`;
      console.log(`📺 Built WebSocket URL with speakFirst: ${wsUrl}`);
    }
    
    const twiml = new twilio.twiml.VoiceResponse();
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
  
  // Parse query parameters from WebSocket URL (for speakFirst feature)
  const url = new URL(req.url, `wss://${req.headers.host}`);
  const queryParams = url.searchParams;
  const wsQuerySpeakFirst = queryParams.get('speakFirst') === 'true';
  const wsQueryInitialMessage = queryParams.get('initialMessage') || null;
  
  let sessionData = {
    callSid: null,
    streamSid: null,
    audioBuffer: [],
    openAISession: null,
    speakFirst: wsQuerySpeakFirst,
    initialMessage: wsQueryInitialMessage || 'Hello! How can I help you today?'
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
          
          console.log(`[${sessionData.callSid}] 🎯 Media stream started - speakFirst: ${sessionData.speakFirst}, initialMessage: "${sessionData.initialMessage}"`);
          
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
                models,
                {
                  speakFirst: sessionData.speakFirst,
                  initialMessage: sessionData.initialMessage
                }
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
  
  if (!supabase) {
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
  
  if (!supabase) {
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

// ============================================
// RECORDING ENDPOINTS
// ============================================

// Get recording by call SID
app.get('/api/recordings/:callSid', async (req, res) => {
  const { callSid } = req.params;

  if (!models || !models.CallRecording) {
    return res.status(503).json({
      success: false,
      error: 'Recording service not available'
    });
  }

  try {
    const recording = await models.CallRecording.findByCallSid(callSid);

    if (!recording) {
      return res.status(404).json({
        success: false,
        error: 'Recording not found',
        callSid
      });
    }

    res.json({
      success: true,
      recording
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch recording',
      message: error.message
    });
  }
});

// Get recordings by lead ID
app.get('/api/lead/:leadId/recordings', async (req, res) => {
  const { leadId } = req.params;
  const { limit = 50, offset = 0 } = req.query;

  if (!models || !models.CallRecording) {
    return res.status(503).json({
      success: false,
      error: 'Recording service not available'
    });
  }

  try {
    const result = await models.CallRecording.findByLeadId(leadId, {
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.json({
      success: true,
      leadId,
      recordings: result,
      count: result.length,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch recordings',
      message: error.message
    });
  }
});

// Get all recordings with pagination and filtering
app.get('/api/recordings', async (req, res) => {
  const {
    limit = 50,
    offset = 0,
    status,
    leadId,
    dateFrom,
    dateTo,
    sortBy = 'created_at',
    sortOrder = 'desc'
  } = req.query;

  if (!models || !models.CallRecording) {
    return res.status(503).json({
      success: false,
      error: 'Recording service not available'
    });
  }

  try {
    const result = await models.CallRecording.findAll({
      limit: parseInt(limit),
      offset: parseInt(offset),
      status,
      leadId,
      dateFrom,
      dateTo,
      sortBy,
      sortOrder
    });

    res.json({
      success: true,
      recordings: result.data,
      pagination: {
        total: result.pagination.total,
        count: result.data.length,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: result.pagination.hasMore
      },
      filters: {
        status,
        leadId,
        dateFrom,
        dateTo
      },
      sorting: {
        sortBy,
        sortOrder
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch recordings',
      message: error.message
    });
  }
});

// Get recording statistics
app.get('/api/recordings/stats', async (req, res) => {
  if (!models || !models.CallRecording) {
    return res.status(503).json({
      success: false,
      error: 'Recording service not available'
    });
  }

  try {
    const stats = await models.CallRecording.getStats();

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch statistics',
      message: error.message
    });
  }
});

// Download recording (redirect to signed URL)
app.get('/api/recordings/:callSid/download', async (req, res) => {
  const { callSid } = req.params;

  if (!models || !models.CallRecording || !recordingManager) {
    return res.status(503).json({
      success: false,
      error: 'Recording service not available'
    });
  }

  try {
    const recording = await models.CallRecording.findByCallSid(callSid);

    if (!recording) {
      return res.status(404).json({
        success: false,
        error: 'Recording not found'
      });
    }

    // Get fresh signed URL
    const signedUrl = await recordingManager.getSignedUrl(recording.storage_path, 3600);

    if (!signedUrl) {
      return res.status(500).json({
        success: false,
        error: 'Failed to generate download URL'
      });
    }

    // Redirect to signed URL
    res.redirect(signedUrl);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to download recording',
      message: error.message
    });
  }
});

// Delete recording from storage and database
app.delete('/api/recordings/:callSid', async (req, res) => {
  const { callSid } = req.params;

  if (!models || !models.CallRecording || !recordingManager) {
    return res.status(503).json({
      success: false,
      error: 'Recording service not available'
    });
  }

  try {
    const recording = await models.CallRecording.findByCallSid(callSid);

    if (!recording) {
      return res.status(404).json({
        success: false,
        error: 'Recording not found'
      });
    }

    // Delete from storage
    const storageDeleted = await recordingManager.deleteFromStorage(recording.storage_path);

    if (!storageDeleted) {
      console.warn(`⚠️  Failed to delete from storage: ${recording.storage_path}`);
    }

    // Delete from database
    await models.CallRecording.delete(callSid);

    res.json({
      success: true,
      message: 'Recording deleted successfully',
      callSid,
      storagePath: recording.storage_path
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to delete recording',
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
