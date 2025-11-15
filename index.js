require('dotenv').config();
const express = require('express');
const twilio = require('twilio');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse URL-encoded bodies (for Twilio webhooks)
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Twilio credentials from environment variables
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
const publicUrl = process.env.PUBLIC_URL || 'http://localhost:3000';

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

  try {
    const call = await client.calls.create({
      url: `${publicUrl}/voice-response?message=${encodeURIComponent(message || 'Hello from Twilio!')}`,
      to: to,
      from: twilioPhoneNumber,
      statusCallback: `${publicUrl}/call-events`,
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    });

    res.json({
      success: true,
      callSid: call.sid,
      message: 'Call initiated successfully'
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
app.post('/call-events', (req, res) => {
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
  // Respond to acknowledge receipt
  res.status(200).json({
    success: true,
    message: 'Call event received',
    callSid: CallSid,
    status: CallStatus
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Make sure your Twilio webhook URLs are configured to point to this server`);
});
