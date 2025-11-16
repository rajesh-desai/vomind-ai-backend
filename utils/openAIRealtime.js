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
    this.connectionAttempts = 0;
    this.maxRetries = 3;
    this.reconnectTimeout = null;
    this.hasFailed = false;
    this.errorCount = 0;
    this.lastErrorTime = null;
    
    // Latency tracking
    this.latencyMetrics = {
      speechStartTime: null,
      speechStopTime: null,
      responseRequestTime: null,
      responseCreatedTime: null,
      firstAudioChunkTime: null,
      audioCompleteTime: null,
      responseDoneTime: null
    };
    this.currentTurnMetrics = {};
    
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not configured in .env file');
    }
    
    // Validate API key format
    if (!OPENAI_API_KEY.startsWith('sk-')) {
      throw new Error('OPENAI_API_KEY appears to be invalid (should start with sk-)');
    }
    
    this.openAiWsUrl = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17';
  }

  /**
   * Initialize connection to OpenAI Realtime API with retry logic
   */
  async connect() {
    this.connectionAttempts++;
    
    return new Promise((resolve, reject) => {
      console.log(`[${this.callSid}] Connecting to OpenAI Realtime API (attempt ${this.connectionAttempts}/${this.maxRetries})...`);
      
      const connectionTimeout = setTimeout(() => {
        if (!this.isConnected) {
          console.error(`[${this.callSid}] Connection timeout after 10 seconds`);
          if (this.openAiWs) {
            this.openAiWs.terminate();
          }
          reject(new Error('OpenAI connection timeout'));
        }
      }, 10000);
      
      this.openAiWs = new WebSocket(this.openAiWsUrl, {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'OpenAI-Beta': 'realtime=v1'
        }
      });

      this.openAiWs.on('open', () => {
        clearTimeout(connectionTimeout);
        this.isConnected = true;
        this.connectionAttempts = 0;
        this.hasFailed = false;
        console.log(`[${this.callSid}] ✅ Successfully connected to OpenAI Realtime API`);
        
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
        clearTimeout(connectionTimeout);
        this.errorCount++;
        this.lastErrorTime = Date.now();
        console.error(`[${this.callSid}] ❌ OpenAI WebSocket error (${this.errorCount} errors):`, error.message);
        
        // Mark as failed if too many errors
        if (this.errorCount >= 5) {
          this.hasFailed = true;
          this.sendFallbackMessage('I\'m experiencing technical difficulties. Please try again later.');
        }
        
        reject(error);
      });

      this.openAiWs.on('close', (code, reason) => {
        console.log(`[${this.callSid}] OpenAI WebSocket closed (code: ${code}, reason: ${reason || 'none'})`);
        this.isConnected = false;
        
        // Attempt reconnection if not intentionally closed and not exceeded retries
        if (code !== 1000 && !this.hasFailed && this.connectionAttempts < this.maxRetries) {
          console.log(`[${this.callSid}] Attempting to reconnect in 2 seconds...`);
          this.reconnectTimeout = setTimeout(() => this.reconnect(), 2000);
        }
      });
    });
  }

  /**
   * Attempt to reconnect to OpenAI
   */
  async reconnect() {
    if (this.hasFailed || this.connectionAttempts >= this.maxRetries) {
      console.error(`[${this.callSid}] Max reconnection attempts reached. Using fallback mode.`);
      this.sendFallbackMessage('I apologize, but I\'m unable to connect to the AI service right now. Please try calling again later.');
      return;
    }
    
    try {
      await this.connect();
      console.log(`[${this.callSid}] ✅ Reconnected successfully!`);
    } catch (error) {
      console.error(`[${this.callSid}] Reconnection failed:`, error.message);
      if (this.connectionAttempts >= this.maxRetries) {
        this.hasFailed = true;
        this.sendFallbackMessage('I\'m having trouble connecting. Please call back in a few minutes.');
      }
    }
  }

  /**
   * Send fallback message to user via Twilio (Text-to-Speech)
   */
  sendFallbackMessage(message) {
    if (!this.twilioWs || this.twilioWs.readyState !== 1) {
      console.error(`[${this.callSid}] Cannot send fallback message - Twilio WebSocket not available`);
      return;
    }
    
    console.log(`[${this.callSid}] 🔊 Sending fallback message: "${message}"`);
    
    // Send mark event to trigger TTS
    try {
      const markEvent = {
        event: 'mark',
        streamSid: this.streamSid,
        mark: {
          name: 'fallback_notification'
        }
      };
      this.twilioWs.send(JSON.stringify(markEvent));
      console.log(`[${this.callSid}] Fallback notification sent to user`);
    } catch (error) {
      console.error(`[${this.callSid}] Error sending fallback message:`, error.message);
    }
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
      return;
    }
    
    if (this.twilioWs.readyState !== WebSocket.OPEN) {
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
    } catch (error) {
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
          this.latencyMetrics.speechStartTime = Date.now();
          console.log(`[${this.callSid}] 🎤 User started speaking`);
          break;

        case 'input_audio_buffer.speech_stopped':
          this.latencyMetrics.speechStopTime = Date.now();
          const speechDuration = this.latencyMetrics.speechStartTime 
            ? this.latencyMetrics.speechStopTime - this.latencyMetrics.speechStartTime 
            : 0;
          console.log(`[${this.callSid}] 🎤 User stopped speaking (duration: ${speechDuration}ms)`);
          break;

        case 'input_audio_buffer.committed':
          const commitLatency = this.latencyMetrics.speechStopTime
            ? Date.now() - this.latencyMetrics.speechStopTime
            : 0;
          console.log(`[${this.callSid}] 📦 Audio buffer committed (${commitLatency}ms after speech stopped)`);
          // Trigger response generation
          this.latencyMetrics.responseRequestTime = Date.now();
          console.log(`[${this.callSid}] 🔄 Requesting OpenAI response...`);
          this.sendToOpenAI({
            type: 'response.create'
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
          this.latencyMetrics.responseCreatedTime = Date.now();
          const responseCreationLatency = this.latencyMetrics.responseRequestTime
            ? this.latencyMetrics.responseCreatedTime - this.latencyMetrics.responseRequestTime
            : 0;
          console.log(`[${this.callSid}] 🤖 Response created:`, message.response.id);
          console.log(`[${this.callSid}]    ⏱️  Response creation latency: ${responseCreationLatency}ms`);
          break;

        case 'response.output_item.added':
          console.log(`[${this.callSid}] Output item added:`, message.item.type);
          break;

        case 'response.output_item.done':
          break;

        case 'response.content_part.added':
          break;

        case 'response.audio_transcript.delta':
          // AI's speech transcription in progress
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

        case 'response.audio.delta':
          // OpenAI is sending audio response - this is the audio that plays back to user
          if (message.delta) {
            // Track first audio chunk latency
            if (!this.latencyMetrics.firstAudioChunkTime) {
              this.latencyMetrics.firstAudioChunkTime = Date.now();
              
              const totalLatency = this.latencyMetrics.speechStopTime
                ? this.latencyMetrics.firstAudioChunkTime - this.latencyMetrics.speechStopTime
                : 0;
              
              const processingLatency = this.latencyMetrics.responseRequestTime
                ? this.latencyMetrics.firstAudioChunkTime - this.latencyMetrics.responseRequestTime
                : 0;
              
              console.log(`[${this.callSid}] 🎵 First audio chunk received`);
              console.log(`[${this.callSid}]    ⏱️  Total latency (speech stop → first audio): ${totalLatency}ms`);
              console.log(`[${this.callSid}]    ⏱️  Processing latency (request → first audio): ${processingLatency}ms`);
            }
            
            this.sendToTwilio(message.delta);
          } else {
            console.warn(`[${this.callSid}] ✗ Audio delta received but no data`);
          }
          break;
        
        case 'response.audio.done':
          this.latencyMetrics.audioCompleteTime = Date.now();
          const audioStreamDuration = this.latencyMetrics.firstAudioChunkTime
            ? this.latencyMetrics.audioCompleteTime - this.latencyMetrics.firstAudioChunkTime
            : 0;
          console.log(`[${this.callSid}] ✅ Audio streaming completed`);
          console.log(`[${this.callSid}]    ⏱️  Audio streaming duration: ${audioStreamDuration}ms`);
          break;

        case 'response.done':
          this.latencyMetrics.responseDoneTime = Date.now();
          const response = message.response;
          
          console.log(`[${this.callSid}] 🎉 Response completed!`);
          
          // Calculate and log all latency metrics
          if (this.latencyMetrics.speechStopTime && this.latencyMetrics.responseDoneTime) {
            const totalTurnLatency = this.latencyMetrics.responseDoneTime - this.latencyMetrics.speechStopTime;
            console.log(`[${this.callSid}] ⏱️  === LATENCY SUMMARY ===`);
            console.log(`[${this.callSid}]    Total turn-around time: ${totalTurnLatency}ms`);
            
            if (this.latencyMetrics.responseRequestTime) {
              const bufferCommitTime = this.latencyMetrics.responseRequestTime - this.latencyMetrics.speechStopTime;
              console.log(`[${this.callSid}]    Speech → Buffer commit: ${bufferCommitTime}ms`);
            }
            
            if (this.latencyMetrics.responseCreatedTime && this.latencyMetrics.responseRequestTime) {
              const responseCreationTime = this.latencyMetrics.responseCreatedTime - this.latencyMetrics.responseRequestTime;
              console.log(`[${this.callSid}]    Response creation: ${responseCreationTime}ms`);
            }
            
            if (this.latencyMetrics.firstAudioChunkTime && this.latencyMetrics.responseCreatedTime) {
              const timeToFirstAudio = this.latencyMetrics.firstAudioChunkTime - this.latencyMetrics.responseCreatedTime;
              console.log(`[${this.callSid}]    Time to first audio: ${timeToFirstAudio}ms`);
            }
            
            if (this.latencyMetrics.audioCompleteTime && this.latencyMetrics.firstAudioChunkTime) {
              const audioStreamTime = this.latencyMetrics.audioCompleteTime - this.latencyMetrics.firstAudioChunkTime;
              console.log(`[${this.callSid}]    Audio streaming: ${audioStreamTime}ms`);
            }
            
            console.log(`[${this.callSid}] ⏱️  =====================`);
          }
          
          // Extract transcript from response
          if (response.output && response.output.length > 0) {
            const firstOutput = response.output[0];
            if (firstOutput.content && firstOutput.content.length > 0) {
              const audioContent = firstOutput.content.find(c => c.type === 'audio');
              if (audioContent && audioContent.transcript) {
                console.log(`[${this.callSid}]   📝 Transcript: "${audioContent.transcript}"`);
              }
            }
          }
          
          // Show token usage
          if (response.usage) {
            console.log(`[${this.callSid}]   💰 Tokens: ${response.usage.total_tokens} (in: ${response.usage.input_tokens}, out: ${response.usage.output_tokens})`);
            console.log(`[${this.callSid}]   🎵 Audio tokens sent to user: ${response.usage.output_token_details?.audio_tokens || 0}`);
          }
          
          // Reset metrics for next turn
          this.resetLatencyMetrics();
          break;

        case 'error':
          this.errorCount++;
          console.error(`[${this.callSid}] ❌ OpenAI API error:`, message.error);
          
          // Handle specific error types
          if (message.error.type === 'invalid_request_error') {
            console.error(`[${this.callSid}] Invalid request: ${message.error.message}`);
            this.sendFallbackMessage('I encountered an error processing your request.');
          } else if (message.error.type === 'server_error') {
            console.error(`[${this.callSid}] Server error: ${message.error.message}`);
            if (this.errorCount >= 3) {
              this.hasFailed = true;
              this.sendFallbackMessage('The AI service is currently unavailable. Please try again later.');
            }
          } else if (message.error.code === 'rate_limit_exceeded') {
            console.error(`[${this.callSid}] Rate limit exceeded`);
            this.sendFallbackMessage('The service is currently at capacity. Please try again in a moment.');
          }
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
   * Reset latency metrics for next conversation turn
   */
  resetLatencyMetrics() {
    this.latencyMetrics = {
      speechStartTime: null,
      speechStopTime: null,
      responseRequestTime: null,
      responseCreatedTime: null,
      firstAudioChunkTime: null,
      audioCompleteTime: null,
      responseDoneTime: null
    };
  }

  /**
   * Get conversation history
   */
  getConversationHistory() {
    return this.conversationHistory;
  }

  /**
   * Close connections and cleanup
   */
  close() {
    // Clear any pending reconnection attempts
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    if (this.openAiWs) {
      this.openAiWs.close(1000, 'Session ended');
      this.openAiWs = null;
    }
    this.isConnected = false;
    this.hasFailed = false;
    console.log(`[${this.callSid}] OpenAI session closed and cleaned up`);
  }
}

module.exports = OpenAIRealtimeSession;
