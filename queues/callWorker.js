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
 * Handle automation job (fetch-and-schedule-leads)
 * @param {Object} job - BullMQ job
 * @param {Object} models - Database models
 * @param {Object} supabase - Supabase client
 * @returns {Promise<Object>} Result
 */
async function handleAutomationJob(job, models, supabase) {
  const { message, priority, leadLimit } = job.data;

  console.log(`⏰ Running automation job: fetch and schedule leads (limit: ${leadLimit})`);
  
  try {
    if (!supabase || !models) {
      throw new Error('Supabase client and models are required');
    }

    // Fetch new leads
    const { data: newLeads, error } = await supabase
      .from('leads')
      .select('*')
      .eq('lead_status', 'new')
      .is('call_sid', null)
      .limit(leadLimit);

    if (error) {
      throw error;
    }

    if (!newLeads || newLeads.length === 0) {
      console.log('📋 No new leads to call');
      return {
        success: true,
        message: 'No new leads to call',
        scheduled: 0
      };
    }

    console.log(`📋 Found ${newLeads.length} new leads to call`);

    // Filter leads with phone numbers
    const leadsToCall = newLeads.filter(lead => lead.phone);

    if (leadsToCall.length === 0) {
      return {
        success: true,
        message: 'No leads with phone numbers',
        scheduled: 0
      };
    }

    // Schedule calls for each lead using direct queue access
    const { Queue } = require('bullmq');
    const Redis = require('ioredis');
    const callQueue = new Queue('outbound-calls', {
      connection: new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD || undefined,
        maxRetriesPerRequest: null,
        enableReadyCheck: false
      })
    });

    const jobs = [];
    for (const lead of leadsToCall) {
      const job = await callQueue.add(
        'make-call',
        {
          to: lead.phone,
          message,
          lead_id: lead.id,
          priority: priority || 'normal',
          type: 'automation',
          metadata: {
            automationRun: true,
            scheduledAt: new Date().toISOString()
          }
        },
        {
          priority: priority === 'high' ? 10 : priority === 'low' ? 1 : 5,
          removeOnComplete: { age: 3600 },
          removeOnFail: { age: 86400 }
        }
      );
      jobs.push(job);
    }

    console.log(`✅ Scheduled ${jobs.length} calls for automation`);
    
    await callQueue.close();

    return {
      success: true,
      message: `Scheduled ${jobs.length} calls for new leads`,
      scheduled: jobs.length,
      leads: leadsToCall.length,
      jobIds: jobs.map(j => j.id)
    };
  } catch (error) {
    console.error('Error in automation job:', error.message);
    throw new Error(`Automation job failed: ${error.message}`);
  }
}

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

    // Build URL with parameters including speakFirst if enabled
    const urlParams = new URLSearchParams();
    urlParams.append('message', message || 'Hello from VoMindAI');
    
    // Add speakFirst parameters if present in metadata
    if (metadata && metadata.speakFirst) {
      urlParams.append('speakFirst', 'true');
      if (metadata.initialMessage) {
        urlParams.append('initialMessage', metadata.initialMessage);
      }
    }
    
    // Make the Twilio call
    const call = await twilioClient.calls.create({
      from: twilioPhoneNumber,
      to: to,
      url: `${publicUrl}/media-stream-twiml?${urlParams.toString()}`,
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
 * @param {Object} supabase - Supabase client for fetching leads
 * @returns {Worker} Worker instance
 */
function createCallWorker(models = null, supabase = null) {
  const worker = new Worker('outbound-calls', async (job) => {
    // Handle different job types
    if (job.name === 'fetch-and-schedule-leads') {
      return handleAutomationJob(job, models, supabase);
    }
    
    // Default: process as call job
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
