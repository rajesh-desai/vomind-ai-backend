# VoMindAI - Programmable Voice AI Assistant

A Node.js application using Express framework, Twilio Programmable Voice API, and OpenAI Realtime API to handle intelligent voice calls with AI-powered conversations, lead management, and advanced call queue scheduling.

## Features

### Voice & AI
- 🎙️ **AI-Powered Conversations**: Real-time voice conversations using OpenAI Realtime API
- 📞 **Outbound & Inbound Calls**: Bidirectional voice communication via Twilio
- 🔊 **Media Streaming**: WebSocket-based audio streaming for low latency
- 📝 **Automatic Transcription**: Save conversation transcripts to database

### Queue System
- ⏰ **Scheduled Calls**: Schedule calls for specific dates/times
- 🔄 **Recurring Calls**: Set up recurring calls using cron expressions
- 📦 **Bulk Operations**: Schedule multiple calls at once
- 🔁 **Automatic Retries**: Configurable retry logic with exponential backoff
- 📊 **Queue Monitoring**: Real-time statistics and job tracking
- 🎯 **Priority Management**: High, normal, and low priority queues

### Data Management
- 💾 **Supabase Integration**: PostgreSQL database for leads, calls, and transcripts
- 🗂️ **ORM Models**: Clean data access layer for all database operations
- 📈 **Lead Management**: Complete CRUD operations for lead tracking
- 🔍 **Advanced Search**: Pagination, filtering, and full-text search

### API & Integration
- 🌐 **RESTful API**: Comprehensive API for all operations
- 🔐 **CORS Configured**: Ready for frontend integration
- 📡 **WebSocket Support**: Real-time bidirectional communication
- 🛡️ **Error Handling**: Robust error handling and logging

## Prerequisites

- Node.js (v14 or higher)
- Redis (for queue system)
- A Twilio account ([Sign up here](https://www.twilio.com/try-twilio))
- A Twilio phone number with Voice capabilities
- OpenAI API key ([Get here](https://platform.openai.com/api-keys))
- Supabase account ([Sign up here](https://supabase.com))

## Installation

1. Clone or navigate to this project directory:
   ```bash
   cd /home/woyce/Desktop/vomind-AI
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Install and start Redis:
   ```bash
   # Ubuntu/Debian
   sudo apt install redis-server
   sudo systemctl start redis
   
   # macOS
   brew install redis
   brew services start redis
   
   # Docker
   docker run -d -p 6379:6379 redis:alpine
   ```

4. Create a `.env` file from the example:
   ```bash
   cp .env.example .env
   ```

5. Edit `.env` and add your credentials:
   ```env
   # Twilio
   TWILIO_ACCOUNT_SID=your_account_sid_here
   TWILIO_AUTH_TOKEN=your_auth_token_here
   TWILIO_PHONE_NUMBER=your_twilio_phone_number_here
   
   # OpenAI
   OPENAI_API_KEY=your_openai_key_here
   
   # Supabase
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_ANON_KEY=your_supabase_anon_key_here
   
   # Redis (for queue system)
   REDIS_HOST=localhost
   REDIS_PORT=6379
   
   # Server
   PORT=3000
   PUBLIC_URL=https://your-ngrok-url.ngrok.io
   ```

## Usage

### Start the Server

```bash
npm start
```

Or for development with auto-reload:
```bash
npm run dev
```

The server will start on `http://localhost:3000`

### Endpoints

#### 1. **GET /** - Health Check
- Returns a status message confirming the server is running

#### 2. **POST /make-call** - Make Outbound Call
Make a programmatic outbound call with a custom message.

**Request Body:**
```json
{
  "to": "+1234567890",
  "message": "Hello! This is a test call from Twilio."
}
```

**Example using curl:**
```bash
curl -X POST http://localhost:3000/make-call \
  -H "Content-Type: application/json" \
  -d '{"to": "+1234567890", "message": "Hello from Twilio!"}'
```

#### 3. **POST /incoming-call** - Handle Incoming Calls
Configure this as your Twilio phone number's webhook URL for incoming calls.

**Twilio Webhook URL:**
```
http://your-domain.com/incoming-call
```

#### 4. **POST /voice-response** - TwiML Voice Response
Generates TwiML for voice responses (used internally by `/make-call`)

#### 5. **POST /handle-key** - Handle User Input
Processes DTMF input from callers (used by `/incoming-call`)

#### 6. **POST /call-status** - Call Status Callback
Receives call status updates from Twilio

## Configuring Twilio Webhooks

For production use, you need to expose your local server to the internet using a tool like [ngrok](https://ngrok.com/):

1. Install ngrok:
   ```bash
   npm install -g ngrok
   ```

2. Start ngrok:
   ```bash
   ngrok http 3000
   ```

3. Copy the HTTPS URL provided by ngrok (e.g., `https://abc123.ngrok.io`)

4. Configure your Twilio phone number:
   - Go to [Twilio Console > Phone Numbers](https://console.twilio.com/us1/develop/phone-numbers/manage/incoming)
   - Click on your phone number
   - Under "Voice Configuration":
     - Set "A CALL COMES IN" webhook to: `https://your-ngrok-url.ngrok.io/incoming-call`
     - Set method to: `HTTP POST`
   - Save your changes

## Project Structure

```
vomind-AI/
├── index.js                      # Main Express server
├── models/                       # ORM models
│   ├── Lead.js                  # Lead model
│   ├── CallEvent.js             # Call event model
│   ├── ConversationTranscript.js # Transcript model
│   └── index.js                 # Model exports
├── queues/                       # Queue system
│   ├── callQueue.js             # BullMQ queue configuration
│   └── callWorker.js            # Queue worker
├── utils/                        # Utility functions
│   ├── openAIRealtime.js        # OpenAI integration
│   └── phoneValidator.js        # Phone validation
├── examples/                     # Usage examples
│   └── queueExamples.js         # Queue system examples
├── supabase/                     # Database schemas
├── package.json                  # Dependencies
├── .env                         # Environment variables
├── README.md                    # Main documentation
├── QUEUE_SYSTEM.md              # Queue system docs
└── QUEUE_QUICKSTART.md          # Quick start guide
```

## Quick Start

### 1. Basic Setup
```bash
npm install
cp .env.example .env
# Edit .env with your credentials
npm start
```

### 2. Queue System Setup
See [QUEUE_QUICKSTART.md](./QUEUE_QUICKSTART.md) for detailed instructions.

```bash
# Install and start Redis
sudo apt install redis-server  # Ubuntu
brew install redis             # macOS

# Verify Redis
redis-cli ping  # Should return PONG

# Start server (worker starts automatically)
npm start
```

## API Documentation

### Queue System Endpoints

For complete queue API documentation, see [QUEUE_SYSTEM.md](./QUEUE_SYSTEM.md)

**Key Endpoints:**
- `POST /api/queue/schedule-call` - Schedule immediate call
- `POST /api/queue/schedule-delayed-call` - Schedule future call
- `POST /api/queue/schedule-recurring-call` - Schedule recurring call
- `POST /api/queue/schedule-bulk-calls` - Schedule multiple calls
- `GET /api/queue/stats` - Queue statistics
- `GET /api/queue/job/:jobId` - Check job status
- `DELETE /api/queue/job/:jobId` - Cancel scheduled call

### Lead Management
- `POST /api/new-lead` - Create new lead
- `GET /api/leads` - Get all leads (with pagination/filtering)
- `GET /api/leads/:id` - Get single lead
- `PUT /api/leads/:id` - Update lead

### Call Management
- `POST /make-call` - Make immediate call
- `POST /start-media-stream` - Start AI conversation
- `POST /call-events` - Twilio webhook for call events
- `POST /agentCallLogs` - Search call logs

### Transcripts
- `GET /transcripts/:callSid` - Get call transcripts
- `GET /transcripts` - Get all transcripts

## Usage Examples

### Schedule a Call

```bash
curl -X POST http://localhost:3000/api/queue/schedule-call \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+1234567890",
    "message": "Hello from VoMindAI",
    "priority": "high",
    "lead_id": "123"
  }'
```

### Schedule Delayed Call

```bash
curl -X POST http://localhost:3000/api/queue/schedule-delayed-call \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+1234567890",
    "message": "Scheduled call",
    "scheduleAt": "2025-11-20T14:00:00Z"
  }'
```

### Check Queue Statistics

```bash
curl http://localhost:3000/api/queue/stats
```

### Create a Lead

```bash
curl -X POST http://localhost:3000/api/new-lead \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "+1234567890",
    "company": "Acme Inc"
  }'
```

## Available Scripts

Add these to your `package.json`:

```json
"scripts": {
  "start": "node index.js",
  "dev": "nodemon index.js"
}
```

For development with auto-reload, install nodemon:
```bash
npm install --save-dev nodemon
```

## Testing the Application

### Test Outbound Call
```bash
curl -X POST http://localhost:3000/make-call \
  -H "Content-Type: application/json" \
  -d '{"to": "+1234567890", "message": "This is a test call!"}'
```

### Test Incoming Call
1. Configure your Twilio webhook as described above
2. Call your Twilio phone number
3. Listen to the greeting and press 1 to continue

## Troubleshooting

- **Error: Cannot find module 'twilio'**: Run `npm install`
- **401 Authentication Error**: Check your `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` in `.env`
- **Webhook not working**: Ensure your ngrok URL is correct and your server is running
- **Call not connecting**: Verify your `TWILIO_PHONE_NUMBER` is in E.164 format (e.g., +1234567890)

## Resources

- [Twilio Voice Documentation](https://www.twilio.com/docs/voice)
- [TwiML Voice Reference](https://www.twilio.com/docs/voice/twiml)
- [Express.js Documentation](https://expressjs.com/)
- [Twilio Node.js SDK](https://www.twilio.com/docs/libraries/node)

## License

ISC

## Author

Your Name

---

**Happy Calling! 📞**
