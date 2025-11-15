require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const twilio = require('twilio');
const { createClient } = require('@supabase/supabase-js');
const { validatePhoneNumber } = require('./utils/phoneValidator');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3000;

// Middleware to parse URL-encoded bodies (for Twilio webhooks)
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Twilio credentials from environment variables
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
const publicUrl = process.env.PUBLIC_URL || 'http://localhost:3000';

// Supabase configuration
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Initialize Twilio client
const client = twilio(accountSid, authToken);

// Root endpoint
app.get('/', (req, res) => {
  res.send('VoMindAI Programmable Voice AI Assistant running!');
});

app.get('/health', (req, res) => {
  res.send('VoMindAI is healthy!');
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
    twiml.say({ voice: 'alice' }, 'You pressed 1. Thank you for your response.');
  } else {
    twiml.say({ voice: 'alice' }, 'Invalid input. Please try again.');
  }

  twiml.say({ voice: 'alice' }, 'Goodbye!');
  twiml.hangup();

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

  // Log comprehensive call event data
  console.log('=== Outgoing Call Event ===');
  console.log(`Call SID: ${CallSid}`);
  console.log(`Status: ${CallStatus}`);
  console.log(`Direction: ${Direction}`);
  console.log(`From: ${From}`);
  console.log(`To: ${To}`);
  console.log(`Timestamp: ${Timestamp}`);
  console.log(`Recording SID: ${RecordingSid}`);
  console.log(`Recording URL: ${RecordingUrl}`);
  console.log('===========================');
  
  if (Duration) {
    console.log(`Duration: ${Duration} seconds`);
  }
  
  if (CallDuration) {
    console.log(`Total Call Duration: ${CallDuration} seconds`);
  }

  if (RecordingUrl) {
    console.log(`Recording URL: ${RecordingUrl}`);
  }

  // Save call event to Supabase database
  try {
    // Check if call_sid already exists
    const { data: existingCall, error: fetchError } = await supabase
      .from('call_events')
      .select('*')
      .eq('call_sid', CallSid)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      // PGRST116 means no rows found, which is fine
      console.error('Error fetching from Supabase:', fetchError);
    }

    let result;
    if (existingCall) {
      // Update existing row
      result = await supabase
        .from('call_events')
        .update({
          call_status: CallStatus,
          direction: Direction || existingCall.direction,
          duration: Duration ? parseInt(Duration) : existingCall.duration,
          call_duration: CallDuration ? parseInt(CallDuration) : existingCall.call_duration,
          recording_url: RecordingUrl || existingCall.recording_url,
          recording_sid: RecordingSid || existingCall.recording_sid,
          timestamp: Timestamp || existingCall.timestamp,
          updated_at: new Date().toISOString()
        })
        .eq('call_sid', CallSid);

      if (result.error) {
        console.error('Error updating Supabase:', result.error);
      } else {
        console.log(`Call event updated in database for CallSid: ${CallSid}`);
      }
    } else {
      // Insert new row
      result = await supabase
        .from('call_events')
        .insert([
          {
            call_sid: CallSid,
            call_status: CallStatus,
            direction: Direction || 'outbound-api',
            from_number: From,
            to_number: To,
            duration: Duration ? parseInt(Duration) : null,
            call_duration: CallDuration ? parseInt(CallDuration) : null,
            recording_url: RecordingUrl || null,
            recording_sid: RecordingSid || null,
            timestamp: Timestamp || new Date().toISOString(),
            created_at: new Date().toISOString()
          }
        ]);

      if (result.error) {
        console.error('Error inserting to Supabase:', result.error);
      } else {
        console.log(`Call event created in database for CallSid: ${CallSid}`);
      }
    }
  } catch (error) {
    console.error('Exception saving to Supabase:', error);
  }

  // Respond to acknowledge receipt
  res.status(200).json({
    success: true,
    message: 'Call event received',
    callSid: CallSid,
    status: CallStatus
  });
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

// TwiML endpoint for media stream (supports both GET and POST)
const handleMediaStreamTwiml = (req, res) => {
  
  const twiml = new twilio.twiml.VoiceResponse();
  
  twiml.say({ voice: 'alice' }, 'Connected to media stream. Your audio is being processed in real-time.');
  // Start media stream
  const publicHost = publicUrl.replace('https://', '').replace('http://', '');
  const wsUrl = `wss://${publicHost}/media-stream`;

  const start = twiml.start();
  start.stream({
    url: wsUrl,
    track: 'both_tracks' // Stream both inbound and outbound audio
  });
  
  // Keep the call active
  twiml.pause({ length: 60 });
  
  const twimlResponse = twiml.toString();
  
  res.type('text/xml');
  res.send(twimlResponse);
};

app.post('/media-stream-twiml', handleMediaStreamTwiml);

// WebSocket handler for media streams
const activeSessions = new Map();

wss.on('connection', (ws) => {
  console.log('New WebSocket connection established');
  let sessionData = {
    callSid: null,
    streamSid: null,
    audioBuffer: []
  };

  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message);
      
      switch (msg.event) {
        case 'connected':
          break;
          
        case 'start':
          sessionData.callSid = msg.start.callSid;
          sessionData.streamSid = msg.start.streamSid;
          activeSessions.set(sessionData.callSid, sessionData);
          break;
          
        case 'media':
          // Handle incoming audio data
          // msg.media.payload contains base64-encoded audio (mulaw, 8kHz)
          if (msg.media.track === 'inbound') {
            // Audio from the caller
            sessionData.audioBuffer.push({
              timestamp: msg.media.timestamp,
              payload: msg.media.payload,
              track: 'inbound'
            });
          } else if (msg.media.track === 'outbound') {
            // Audio to the caller
            sessionData.audioBuffer.push({
              timestamp: msg.media.timestamp,
              payload: msg.media.payload,
              track: 'outbound'
            });
          }
          
          // Process audio in chunks (every 100 packets)
          if (sessionData.audioBuffer.length >= 100) {

            sessionData.audioBuffer = [];
          }
          break;
          
        case 'stop':
          activeSessions.delete(sessionData.callSid);
          break;
          
        default:
      }
    } catch (error) {
      console.error('Error processing WebSocket message:', error);
    }
  });

  ws.on('close', () => {
    if (sessionData.callSid) {
      activeSessions.delete(sessionData.callSid);
    }
  });
  ws.on('error', (error) => {
  });
});

// Endpoint to get active media stream sessions
app.get('/active-streams', (req, res) => {
  const sessions = Array.from(activeSessions.entries()).map(([callSid, data]) => ({
    callSid,
    streamSid: data.streamSid,
    bufferSize: data.audioBuffer.length
  }));
  
  res.json({
    count: sessions.length,
    sessions
  });
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
