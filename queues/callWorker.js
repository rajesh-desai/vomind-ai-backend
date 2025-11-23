/**
 * Call Queue Worker
 * Processes outbound call jobs from the queue
 */

const { Worker } = require('bullmq');
const Redis = require('ioredis');
const twilio = require('twilio');

// Redis connection
const redisConnection = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: false
});

// Twilio client
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
const publicUrl = process.env.PUBLIC_URL || 'http://localhost:3000';

/**
 * Process a call job
 * @param {Object} job - BullMQ job
 * @returns {Promise<Object>} Call result
 */
async function processCallJob(job) {
  const { to, message, lead_id, priority, metadata, type } = job.data;
  
  console.log(`📞 Processing ${type} call to ${to}...`);
  
  // Update job progress
  await job.updateProgress(10);

  try {
    // Validate phone number
    if (!to) {
      throw new Error('Phone number is required');
    }

    await job.updateProgress(20);

    // Make the Twilio call
    const call = await twilioClient.calls.create({
      from: twilioPhoneNumber,
      to: to,
      url: `${publicUrl}/media-stream-twiml?message=${encodeURIComponent(message || 'Hello from VoMindAI')}`,
      statusCallback: `${publicUrl}/call-events`,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      statusCallbackMethod: 'POST',
      record: false,
      timeout: 30
    });

    await job.updateProgress(80);

    console.log(`📞 ✅ Call initiated: ${call.sid} to ${to}`);

    // Update job progress
    await job.updateProgress(100);

    // Return success result
    return {
      success: true,
      callSid: call.sid,
      to: to,
      status: call.status,
      lead_id,
      priority,
      metadata,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    console.error(`📞 ❌ Error processing call to ${to}:`, error.message);
    
    // Return error result (will trigger retry if attempts remain)
    throw new Error(`Failed to initiate call: ${error.message}`);
  }
}

/**
 * Create and start the worker
 * @param {Object} models - Database models for logging
 * @returns {Worker} Worker instance
 */
function createCallWorker(models = null) {
  const worker = new Worker('outbound-calls', async (job) => {
    const result = await processCallJob(job);
    
    // Log to database if models are available
    if (models && result.success) {
      try {
        // Update lead with call information
        if (result.lead_id) {
          // Update lead with call_sid and mark as contacted
          await models.Lead.update(result.lead_id, {
            call_sid: result.callSid,
            lead_status: 'contacted',
            last_contacted_at: new Date().toISOString(),
            notes: `Outbound call ${result.callSid} initiated`
          });
          console.log(`✅ Updated lead ${result.lead_id} with call_sid ${result.callSid}`);
        }
      } catch (dbError) {
        console.error('Error updating database:', dbError.message);
        // Don't fail the job due to database errors
      }
    }
    
    return result;
  }, {
    connection: redisConnection,
    concurrency: parseInt(process.env.CALL_WORKER_CONCURRENCY || 5), // Process up to 5 calls simultaneously
    limiter: {
      max: 10, // Maximum 10 jobs
      duration: 60000 // per 60 seconds (rate limiting)
    }
  });

  // Worker event listeners
  worker.on('completed', (job, result) => {
    console.log(`📞 ✅ Worker completed job ${job.id}:`, result.callSid);
  });

  worker.on('failed', (job, error) => {
    console.error(`📞 ❌ Worker failed job ${job?.id}:`, error.message);
  });

  worker.on('error', (error) => {
    console.error('📞 ❌ Worker error:', error);
  });

  worker.on('stalled', (jobId) => {
    console.warn(`📞 ⚠️  Worker job ${jobId} stalled`);
  });

  console.log('📞 👷 Call worker started and ready to process jobs');

  return worker;
}

/**
 * Close worker gracefully
 * @param {Worker} worker - Worker instance
 * @returns {Promise<void>}
 */
async function closeWorker(worker) {
  await worker.close();
  await redisConnection.quit();
  console.log('📞 🔌 Worker closed');
}

module.exports = {
  createCallWorker,
  closeWorker,
  processCallJob
};
