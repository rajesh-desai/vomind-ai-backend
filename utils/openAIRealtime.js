/**
 * OpenAI Realtime API Integration for Voice Conversations
 * Handles bidirectional audio streaming with OpenAI's Realtime API
 */

const WebSocket = require('ws');

class OpenAIRealtimeSession {
  constructor(callSid, streamSid) {
    this.callSid = callSid;
    this.streamSid = streamSid;
    this.openAiWs = null;
    this.twilioWs = null;
    this.isConnected = false;
    this.conversationHistory = [];
    
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not configured');
    }
    
    this.openAiWsUrl = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01';
  }

  /**
   * Initialize connection to OpenAI Realtime API
   */
  async connect() {
    return new Promise((resolve, reject) => {
      console.log(`[${this.callSid}] Connecting to OpenAI Realtime API...`);
      
      this.openAiWs = new WebSocket(this.openAiWsUrl, {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'OpenAI-Beta': 'realtime=v1'
        }
      });

      this.openAiWs.on('open', () => {
        console.log(`[${this.callSid}] Connected to OpenAI Realtime API`);
        this.isConnected = true;
        
        // Configure session for Twilio compatibility
        // Twilio uses mulaw 8kHz, but OpenAI supports g711_ulaw
        this.sendToOpenAI({
          type: 'session.update',
          session: {
            modalities: ['text', 'audio'],
            instructions: 'You are a helpful AI voice assistant. Be concise and conversational. Keep responses brief and natural.',
            voice: 'alloy',
            input_audio_format: 'g711_ulaw',  // Changed to match Twilio
            output_audio_format: 'g711_ulaw', // Changed to match Twilio
            input_audio_transcription: {
              model: 'whisper-1'
            },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 500
            },
            temperature: 0.8,
            max_response_output_tokens: 4096
          }
        });
        
        console.log(`[${this.callSid}] Session configured for Twilio (g711_ulaw format)`);
        resolve();
      });

      this.openAiWs.on('message', (data) => {
        this.handleOpenAIMessage(data);
      });

      this.openAiWs.on('error', (error) => {
        console.error(`[${this.callSid}] OpenAI WebSocket error:`, error);
        reject(error);
      });

      this.openAiWs.on('close', () => {
        console.log(`[${this.callSid}] OpenAI WebSocket closed`);
        this.isConnected = false;
      });
    });
  }

  /**
   * Set Twilio WebSocket connection
   */
  setTwilioWebSocket(ws) {
    this.twilioWs = ws;
  }

  /**
   * Send message to OpenAI
   */
  sendToOpenAI(message) {
    if (this.openAiWs && this.isConnected) {
      this.openAiWs.send(JSON.stringify(message));
    }
  }

  /**
   * Send audio to Twilio (back to caller)
   */
  sendToTwilio(audioBase64) {
    if (!this.twilioWs) {
      console.error(`[${this.callSid}] Twilio WebSocket not set`);
      return;
    }
    
    if (this.twilioWs.readyState !== WebSocket.OPEN) {
      console.warn(`[${this.callSid}] Twilio WebSocket not open (state: ${this.twilioWs.readyState})`);
      return;
    }

    try {
      const media = {
        event: 'media',
        streamSid: this.streamSid,
        media: {
          payload: audioBase64
        }
      };
      this.twilioWs.send(JSON.stringify(media));
      console.log(`[${this.callSid}] ✓ Sent ${audioBase64.length} bytes audio to Twilio`);
    } catch (error) {
      console.error(`[${this.callSid}] Error sending to Twilio:`, error.message);
    }
  }

  /**
   * Handle incoming audio from Twilio (caller's voice)
   */
  handleIncomingAudio(payload) {
    if (!this.isConnected) {
      console.warn(`[${this.callSid}] OpenAI not connected, skipping audio`);
      return;
    }

    // Twilio sends mulaw base64, OpenAI expects g711_ulaw base64
    // They're the same format, just send directly
    this.sendToOpenAI({
      type: 'input_audio_buffer.append',
      audio: payload
    });
  }

  /**
   * Handle messages from OpenAI
   */
  handleOpenAIMessage(data) {
    try {
      const message = JSON.parse(data.toString());
      
      switch (message.type) {
        case 'session.created':
          console.log(`[${this.callSid}] OpenAI session created:`, message.session.id);
          break;

        case 'session.updated':
          console.log(`[${this.callSid}] OpenAI session updated`);
          break;

        case 'conversation.item.created':
          console.log(`[${this.callSid}] Conversation item created`);
          break;

        case 'input_audio_buffer.speech_started':
          console.log(`[${this.callSid}] User started speaking`);
          break;

        case 'input_audio_buffer.speech_stopped':
          console.log(`[${this.callSid}] User stopped speaking`);
          break;

        case 'input_audio_buffer.committed':
          console.log(`[${this.callSid}] Audio buffer committed`);
          // Trigger response generation
          console.log(`[${this.callSid}] Requesting OpenAI response...`);
          this.sendToOpenAI({
            type: 'response.create',
            response: {
              modalities: ['text', 'audio'],
              instructions: 'Please respond to the user.'
            }
          });
          break;

        case 'conversation.item.input_audio_transcription.completed':
          const transcript = message.transcript;
          console.log(`[${this.callSid}] User said: "${transcript}"`);
          this.conversationHistory.push({
            role: 'user',
            content: transcript,
            timestamp: new Date().toISOString()
          });
          break;

        case 'response.created':
          console.log(`[${this.callSid}] Response created:`, message.response.id);
          break;

        case 'response.output_item.added':
          console.log(`[${this.callSid}] Output item added`);
          break;

        case 'response.content_part.added':
          console.log(`[${this.callSid}] Content part added`);
          break;

        case 'response.audio.delta':
          // OpenAI is sending audio response
          if (message.delta) {
            console.log(`[${this.callSid}] Received audio delta from OpenAI (length: ${message.delta.length})`);
            // Send audio directly to Twilio
            this.sendToTwilio(message.delta);
          } else {
            console.warn(`[${this.callSid}] Audio delta received but no data`);
          }
          break;

        case 'response.audio.done':
          console.log(`[${this.callSid}] Audio response completed`);
          break;

        case 'response.audio_transcript.delta':
          // AI's speech transcription
          if (message.delta) {
            process.stdout.write(message.delta);
          }
          break;

        case 'response.audio_transcript.done':
          const aiTranscript = message.transcript;
          console.log(`\n[${this.callSid}] AI said: "${aiTranscript}"`);
          this.conversationHistory.push({
            role: 'assistant',
            content: aiTranscript,
            timestamp: new Date().toISOString()
          });
          break;

        case 'response.done':
          console.log(`[${this.callSid}] Response completed`);
          break;

        case 'error':
          console.error(`[${this.callSid}] OpenAI error:`, message.error);
          break;

        default:
          // Log other message types for debugging
          if (process.env.DEBUG_OPENAI) {
            console.log(`[${this.callSid}] OpenAI message:`, message.type);
          }
      }
    } catch (error) {
      console.error(`[${this.callSid}] Error parsing OpenAI message:`, error);
    }
  }

  /**
   * Get conversation history
   */
  getConversationHistory() {
    return this.conversationHistory;
  }

  /**
   * Close connections
   */
  close() {
    if (this.openAiWs) {
      this.openAiWs.close();
      this.openAiWs = null;
    }
    this.isConnected = false;
    console.log(`[${this.callSid}] OpenAI session closed`);
  }
}

module.exports = OpenAIRealtimeSession;
