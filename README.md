# Twilio Programmable Voice with Express

A Node.js application using Express framework and Twilio Programmable Voice API to handle voice calls, make outbound calls, and process incoming calls with interactive voice responses.

## Features

- 🎙️ **Outbound Calls**: Make programmatic calls with custom messages
- 📞 **Incoming Call Handling**: Handle incoming calls with interactive voice menus
- 🔊 **TwiML Responses**: Generate dynamic voice responses
- 📊 **Call Status Tracking**: Monitor call status with callbacks
- 🔐 **Secure Configuration**: Environment-based credential management

## Prerequisites

- Node.js (v14 or higher)
- A Twilio account ([Sign up here](https://www.twilio.com/try-twilio))
- A Twilio phone number with Voice capabilities

## Installation

1. Clone or navigate to this project directory:
   ```bash
   cd /home/woyce/Desktop/vomind-AI
   ```

2. Install dependencies (already installed):
   ```bash
   npm install
   ```

3. Create a `.env` file from the example:
   ```bash
   cp .env.example .env
   ```

4. Edit `.env` and add your Twilio credentials:
   ```env
   TWILIO_ACCOUNT_SID=your_account_sid_here
   TWILIO_AUTH_TOKEN=your_auth_token_here
   TWILIO_PHONE_NUMBER=your_twilio_phone_number_here
   PORT=3000
   ```

   You can find your credentials at: https://console.twilio.com

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
├── index.js           # Main Express server with Twilio integration
├── package.json       # Project dependencies and scripts
├── .env              # Environment variables (create from .env.example)
├── .env.example      # Example environment configuration
├── .gitignore        # Git ignore rules
└── README.md         # This file
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
