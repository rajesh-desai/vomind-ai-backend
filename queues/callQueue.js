/**
 * Call Queue System using BullMQ
 * Handles scheduling and processing of outbound calls
 */

const { Queue, Worker, QueueEvents } = require('bullmq');
const Redis = require('ioredis');

// Redis connection configuration
const redisConnection = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: false
});

// Create the call queue
const callQueue = new Queue('outbound-calls', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3, // Retry failed calls up to 3 times
    backoff: {
      type: 'exponential',
      delay: 2000 // Start with 2 second delay, then exponential backoff
    },
    removeOnComplete: {
      age: 3600 * 24 * 7, // Keep completed jobs for 7 days
      count: 1000 // Keep last 1000 completed jobs
    },
    removeOnFail: {
      age: 3600 * 24 * 30 // Keep failed jobs for 30 days
    }
  }
});

// Queue events for monitoring
const queueEvents = new QueueEvents('outbound-calls', {
  connection: redisConnection
});

// Event listeners
queueEvents.on('completed', ({ jobId, returnvalue }) => {
  console.log(`📞 ✅ Call job ${jobId} completed:`, returnvalue);
});

queueEvents.on('failed', ({ jobId, failedReason }) => {
  console.error(`📞 ❌ Call job ${jobId} failed:`, failedReason);
});

queueEvents.on('active', ({ jobId }) => {
  console.log(`📞 🔄 Call job ${jobId} is now active`);
});

queueEvents.on('delayed', ({ jobId, delay }) => {
  console.log(`📞 ⏰ Call job ${jobId} delayed by ${delay}ms`);
});

/**
 * Schedule an immediate outbound call
 * @param {Object} callData - Call data
 * @returns {Promise<Object>} Job information
 */
async function scheduleImmediateCall(callData) {
  const { to, message, lead_id, priority = 'normal', metadata = {} } = callData;

  const job = await callQueue.add('make-call', {
    to,
    message,
    lead_id,
    priority,
    metadata,
    scheduledAt: new Date().toISOString(),
    type: 'immediate'
  }, {
    priority: priority === 'high' ? 1 : priority === 'low' ? 3 : 2
  });

  return {
    jobId: job.id,
    status: 'scheduled',
    data: job.data
  };
}

/**
 * Schedule a delayed outbound call
 * @param {Object} callData - Call data
 * @param {Date|number} delay - Date or milliseconds delay
 * @returns {Promise<Object>} Job information
 */
async function scheduleDelayedCall(callData, delay) {
  const { to, message, lead_id, priority = 'normal', metadata = {} } = callData;

  const delayMs = delay instanceof Date 
    ? Math.max(0, delay.getTime() - Date.now())
    : delay;

  const job = await callQueue.add('make-call', {
    to,
    message,
    lead_id,
    priority,
    metadata,
    scheduledAt: delay instanceof Date ? delay.toISOString() : new Date(Date.now() + delayMs).toISOString(),
    type: 'scheduled'
  }, {
    delay: delayMs,
    priority: priority === 'high' ? 1 : priority === 'low' ? 3 : 2
  });

  return {
    jobId: job.id,
    status: 'scheduled',
    scheduledFor: new Date(Date.now() + delayMs).toISOString(),
    data: job.data
  };
}

/**
 * Schedule a recurring call (e.g., follow-ups)
 * @param {Object} callData - Call data
 * @param {string} cronExpression - Cron expression
 * @returns {Promise<Object>} Job information
 */
async function scheduleRecurringCall(callData, cronExpression) {
  const { to, message, lead_id, priority = 'normal', metadata = {} } = callData;

  const job = await callQueue.add('make-call', {
    to,
    message,
    lead_id,
    priority,
    metadata,
    cronExpression,
    type: 'recurring'
  }, {
    repeat: {
      pattern: cronExpression
    },
    priority: priority === 'high' ? 1 : priority === 'low' ? 3 : 2
  });

  return {
    jobId: job.id,
    status: 'recurring',
    pattern: cronExpression,
    data: job.data
  };
}

/**
 * Schedule bulk calls
 * @param {Array} callsData - Array of call data objects
 * @returns {Promise<Array>} Array of job information
 */
async function scheduleBulkCalls(callsData) {
  const jobs = callsData.map((callData, index) => ({
    name: 'make-call',
    data: {
      ...callData,
      scheduledAt: new Date().toISOString(),
      type: 'bulk',
      batchIndex: index
    },
    opts: {
      priority: callData.priority === 'high' ? 1 : callData.priority === 'low' ? 3 : 2
    }
  }));

  const addedJobs = await callQueue.addBulk(jobs);

  return addedJobs.map(job => ({
    jobId: job.id,
    status: 'scheduled',
    data: job.data
  }));
}

/**
 * Get job status
 * @param {string} jobId - Job ID
 * @returns {Promise<Object>} Job status
 */
async function getJobStatus(jobId) {
  const job = await callQueue.getJob(jobId);
  
  if (!job) {
    return { error: 'Job not found' };
  }

  const state = await job.getState();
  const progress = job.progress || 0;
  const failedReason = job.failedReason;

  return {
    jobId: job.id,
    state,
    progress,
    data: job.data,
    attemptsMade: job.attemptsMade,
    failedReason,
    processedOn: job.processedOn,
    finishedOn: job.finishedOn,
    timestamp: job.timestamp
  };
}

/**
 * Cancel a scheduled call
 * @param {string} jobId - Job ID
 * @returns {Promise<boolean>} Success status
 */
async function cancelCall(jobId) {
  const job = await callQueue.getJob(jobId);
  
  if (!job) {
    return false;
  }

  await job.remove();
  console.log(`📞 🚫 Call job ${jobId} cancelled`);
  return true;
}

/**
 * Retry a failed call
 * @param {string} jobId - Job ID
 * @returns {Promise<Object>} New job information
 */
async function retryCall(jobId) {
  const job = await callQueue.getJob(jobId);
  
  if (!job) {
    throw new Error('Job not found');
  }

  await job.retry();
  console.log(`📞 🔄 Call job ${jobId} retrying...`);
  
  return {
    jobId: job.id,
    status: 'retrying',
    attemptsMade: job.attemptsMade
  };
}

/**
 * Get queue statistics
 * @returns {Promise<Object>} Queue statistics
 */
async function getQueueStats() {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    callQueue.getWaitingCount(),
    callQueue.getActiveCount(),
    callQueue.getCompletedCount(),
    callQueue.getFailedCount(),
    callQueue.getDelayedCount()
  ]);

  return {
    waiting,
    active,
    completed,
    failed,
    delayed,
    total: waiting + active + completed + failed + delayed
  };
}

/**
 * Get waiting jobs
 * @param {number} start - Start index
 * @param {number} end - End index
 * @returns {Promise<Array>} Waiting jobs
 */
async function getWaitingJobs(start = 0, end = 10) {
  const jobs = await callQueue.getWaiting(start, end);
  return jobs.map(job => ({
    jobId: job.id,
    data: job.data,
    timestamp: job.timestamp
  }));
}

/**
 * Get active jobs
 * @param {number} start - Start index
 * @param {number} end - End index
 * @returns {Promise<Array>} Active jobs
 */
async function getActiveJobs(start = 0, end = 10) {
  const jobs = await callQueue.getActive(start, end);
  return jobs.map(job => ({
    jobId: job.id,
    data: job.data,
    progress: job.progress,
    timestamp: job.timestamp
  }));
}

/**
 * Get failed jobs
 * @param {number} start - Start index
 * @param {number} end - End index
 * @returns {Promise<Array>} Failed jobs
 */
async function getFailedJobs(start = 0, end = 10) {
  const jobs = await callQueue.getFailed(start, end);
  return jobs.map(job => ({
    jobId: job.id,
    data: job.data,
    failedReason: job.failedReason,
    attemptsMade: job.attemptsMade,
    timestamp: job.timestamp
  }));
}

/**
 * Clean old jobs
 * @param {number} grace - Grace period in milliseconds
 * @param {number} limit - Limit of jobs to clean
 * @returns {Promise<Object>} Cleanup results
 */
async function cleanOldJobs(grace = 3600000, limit = 1000) {
  const [completedCleaned, failedCleaned] = await Promise.all([
    callQueue.clean(grace, limit, 'completed'),
    callQueue.clean(grace, limit, 'failed')
  ]);

  return {
    completedCleaned,
    failedCleaned,
    total: completedCleaned + failedCleaned
  };
}

/**
 * Pause the queue
 * @returns {Promise<void>}
 */
async function pauseQueue() {
  await callQueue.pause();
  console.log('📞 ⏸️  Call queue paused');
}

/**
 * Resume the queue
 * @returns {Promise<void>}
 */
async function resumeQueue() {
  await callQueue.resume();
  console.log('📞 ▶️  Call queue resumed');
}

/**
 * Close connections gracefully
 * @returns {Promise<void>}
 */
async function closeQueue() {
  await callQueue.close();
  await queueEvents.close();
  await redisConnection.quit();
  console.log('📞 🔌 Call queue connections closed');
}

module.exports = {
  callQueue,
  queueEvents,
  scheduleImmediateCall,
  scheduleDelayedCall,
  scheduleRecurringCall,
  scheduleBulkCalls,
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
};
