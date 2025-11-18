/**
 * Example: Queue System Usage
 * 
 * This file demonstrates how to use the call queue system
 * Run: node examples/queueExamples.js
 */

require('dotenv').config();

const {
  scheduleImmediateCall,
  scheduleDelayedCall,
  scheduleRecurringCall,
  scheduleBulkCalls,
  getJobStatus,
  getQueueStats,
  cancelCall,
  closeQueue
} = require('../queues/callQueue');

async function runExamples() {
  console.log('📞 Call Queue System Examples\n');

  try {
    // Example 1: Schedule an immediate call
    console.log('1️⃣  Scheduling immediate call...');
    const immediateJob = await scheduleImmediateCall({
      to: '+1234567890', // Replace with a real number
      message: 'This is an immediate test call',
      priority: 'high',
      metadata: { source: 'example-script' }
    });
    console.log('✅ Immediate call scheduled:', immediateJob.jobId);
    console.log('');

    // Example 2: Schedule a delayed call (in 5 minutes)
    console.log('2️⃣  Scheduling delayed call (5 minutes)...');
    const delayedJob = await scheduleDelayedCall({
      to: '+1234567890',
      message: 'This is a delayed test call',
      priority: 'normal'
    }, 5 * 60 * 1000); // 5 minutes in milliseconds
    console.log('✅ Delayed call scheduled:', delayedJob.jobId);
    console.log('   Scheduled for:', delayedJob.scheduledFor);
    console.log('');

    // Example 3: Schedule a recurring call (every day at 9 AM)
    console.log('3️⃣  Scheduling recurring call (daily at 9 AM)...');
    const recurringJob = await scheduleRecurringCall({
      to: '+1234567890',
      message: 'Daily reminder call',
      priority: 'normal'
    }, '0 9 * * *');
    console.log('✅ Recurring call scheduled:', recurringJob.jobId);
    console.log('   Pattern:', recurringJob.pattern);
    console.log('');

    // Example 4: Schedule bulk calls
    console.log('4️⃣  Scheduling bulk calls...');
    const bulkJobs = await scheduleBulkCalls([
      {
        to: '+1111111111',
        message: 'Bulk call 1',
        priority: 'high',
        metadata: { campaign: 'Q4-2025' }
      },
      {
        to: '+2222222222',
        message: 'Bulk call 2',
        priority: 'normal',
        metadata: { campaign: 'Q4-2025' }
      },
      {
        to: '+3333333333',
        message: 'Bulk call 3',
        priority: 'low',
        metadata: { campaign: 'Q4-2025' }
      }
    ]);
    console.log(`✅ ${bulkJobs.length} bulk calls scheduled`);
    console.log('');

    // Wait a bit for processing
    console.log('⏳ Waiting 3 seconds...\n');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Example 5: Check job status
    console.log('5️⃣  Checking job status...');
    const jobStatus = await getJobStatus(immediateJob.jobId);
    console.log('Job Status:', {
      jobId: jobStatus.jobId,
      state: jobStatus.state,
      progress: jobStatus.progress,
      attemptsMade: jobStatus.attemptsMade
    });
    console.log('');

    // Example 6: Get queue statistics
    console.log('6️⃣  Getting queue statistics...');
    const stats = await getQueueStats();
    console.log('Queue Stats:', stats);
    console.log('');

    // Example 7: Cancel the recurring job (cleanup)
    console.log('7️⃣  Cancelling recurring job...');
    await cancelCall(recurringJob.jobId);
    console.log('✅ Recurring job cancelled');
    console.log('');

    console.log('✅ All examples completed successfully!');
    console.log('');
    console.log('📊 Final Queue Stats:');
    const finalStats = await getQueueStats();
    console.log(finalStats);

  } catch (error) {
    console.error('❌ Error running examples:', error.message);
  } finally {
    // Cleanup
    console.log('\n🔌 Closing queue connections...');
    await closeQueue();
    console.log('👋 Done!');
    process.exit(0);
  }
}

// Run the examples
runExamples();
