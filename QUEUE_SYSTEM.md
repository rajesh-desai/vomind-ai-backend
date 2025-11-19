# Call Queue System Documentation

## Overview

The VoMindAI Call Queue System uses **BullMQ** to manage scheduled outbound calls with advanced features like:

- ✅ Immediate call scheduling
- ⏰ Delayed/scheduled calls
- 🔄 Recurring calls (cron-based)
- 📦 Bulk call scheduling
- 🔁 Automatic retries on failure
- 📊 Queue monitoring and statistics
- ⏸️ Pause/resume queue
- 🎯 Priority-based processing

## Prerequisites

### 1. Install Redis

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install redis-server
sudo systemctl start redis
sudo systemctl enable redis
```

**macOS:**
```bash
brew install redis
brew services start redis
```

**Docker:**
```bash
docker run -d -p 6379:6379 redis:alpine
```

### 2. Verify Redis is Running
```bash
redis-cli ping
# Should return: PONG
```

## Configuration

Add these environment variables to your `.env` file:

```env
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Call Worker Configuration
CALL_WORKER_CONCURRENCY=5
```

## API Endpoints

### 1. Schedule Immediate Call

**POST** `/api/queue/schedule-call`

```json
{
  "to": "+1234567890",
  "message": "Hello from VoMindAI",
  "lead_id": "123",
  "priority": "high",
  "metadata": {
    "campaign": "Q4 Outreach"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Call scheduled successfully",
  "jobId": "1",
  "status": "scheduled",
  "data": { ... }
}
```

### 2. Schedule Delayed Call

**POST** `/api/queue/schedule-delayed-call`

**Option A: Using specific date/time**
```json
{
  "to": "+1234567890",
  "message": "Scheduled call",
  "scheduleAt": "2025-11-20T10:00:00Z",
  "priority": "normal"
}
```

**Option B: Using delay in milliseconds**
```json
{
  "to": "+1234567890",
  "message": "Call in 1 hour",
  "delayMs": 3600000,
  "priority": "normal"
}
```

### 3. Schedule Recurring Call

**POST** `/api/queue/schedule-recurring-call`

```json
{
  "to": "+1234567890",
  "message": "Daily reminder",
  "cronExpression": "0 9 * * *",
  "priority": "normal"
}
```

**Common Cron Patterns:**
- `0 9 * * *` - Every day at 9:00 AM
- `0 9 * * 1` - Every Monday at 9:00 AM
- `0 */2 * * *` - Every 2 hours
- `*/30 * * * *` - Every 30 minutes

### 4. Schedule Bulk Calls

**POST** `/api/queue/schedule-bulk-calls`

```json
{
  "calls": [
    {
      "to": "+1234567890",
      "message": "Bulk call 1",
      "lead_id": "123",
      "priority": "high"
    },
    {
      "to": "+0987654321",
      "message": "Bulk call 2",
      "lead_id": "124",
      "priority": "normal"
    }
  ]
}
```

### 5. Get Job Status

**GET** `/api/queue/job/:jobId`

**Response:**
```json
{
  "success": true,
  "jobId": "1",
  "state": "completed",
  "progress": 100,
  "data": { ... },
  "attemptsMade": 1,
  "failedReason": null
}
```

**Job States:**
- `waiting` - In queue, not started
- `active` - Currently processing
- `completed` - Successfully finished
- `failed` - Failed after retries
- `delayed` - Scheduled for future

### 6. Cancel Scheduled Call

**DELETE** `/api/queue/job/:jobId`

### 7. Retry Failed Call

**POST** `/api/queue/job/:jobId/retry`

### 8. Queue Statistics

**GET** `/api/queue/stats`

**Response:**
```json
{
  "success": true,
  "stats": {
    "waiting": 5,
    "active": 2,
    "completed": 150,
    "failed": 3,
    "delayed": 10,
    "total": 170
  }
}
```

### 9. Get Waiting Jobs

**GET** `/api/queue/waiting?start=0&end=10`

### 10. Get Active Jobs

**GET** `/api/queue/active?start=0&end=10`

### 11. Get Failed Jobs

**GET** `/api/queue/failed?start=0&end=10`

### 12. Clean Old Jobs

**POST** `/api/queue/clean`

```json
{
  "grace": 3600000,
  "limit": 1000
}
```

### 13. Pause Queue

**POST** `/api/queue/pause`

Temporarily stops processing new jobs.

### 14. Resume Queue

**POST** `/api/queue/resume`

Resumes processing jobs.

## Priority Levels

- `high` - Priority 1 (processed first)
- `normal` - Priority 2 (default)
- `low` - Priority 3 (processed last)

## Retry Configuration

Failed calls are automatically retried with:
- **Max Attempts:** 3
- **Backoff Strategy:** Exponential
- **Initial Delay:** 2 seconds
- **Backoff Multiplier:** 2x each retry

Example retry timeline:
- Attempt 1: Immediate
- Attempt 2: 2 seconds delay
- Attempt 3: 4 seconds delay

## Rate Limiting

The worker is configured with rate limiting:
- **Max Jobs:** 10 calls
- **Time Window:** 60 seconds

This prevents overwhelming Twilio or your system.

## Monitoring

### Check Queue Health

```bash
# Get queue statistics
curl http://localhost:3000/api/queue/stats

# Get active jobs
curl http://localhost:3000/api/queue/active

# Get failed jobs
curl http://localhost:3000/api/queue/failed
```

### Monitor Logs

The system provides detailed logging:
- 📞 🔄 - Call processing started
- 📞 ✅ - Call completed successfully
- 📞 ❌ - Call failed
- 📞 ⏰ - Call delayed/scheduled

## Use Cases

### 1. Lead Follow-up Campaign

```bash
curl -X POST http://localhost:3000/api/queue/schedule-delayed-call \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+1234567890",
    "message": "Following up on your inquiry",
    "lead_id": "123",
    "scheduleAt": "2025-11-20T14:00:00Z",
    "priority": "high"
  }'
```

### 2. Daily Reminders

```bash
curl -X POST http://localhost:3000/api/queue/schedule-recurring-call \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+1234567890",
    "message": "Your daily reminder",
    "cronExpression": "0 9 * * *",
    "priority": "normal"
  }'
```

### 3. Emergency Broadcast

```bash
curl -X POST http://localhost:3000/api/queue/schedule-bulk-calls \
  -H "Content-Type: application/json" \
  -d '{
    "calls": [
      {"to": "+1111111111", "message": "Emergency alert", "priority": "high"},
      {"to": "+2222222222", "message": "Emergency alert", "priority": "high"}
    ]
  }'
```

## Troubleshooting

### Redis Connection Failed

**Error:** `ECONNREFUSED 127.0.0.1:6379`

**Solution:**
```bash
# Check if Redis is running
redis-cli ping

# Start Redis
sudo systemctl start redis  # Linux
brew services start redis    # macOS
```

### Worker Not Processing Jobs

**Check:**
1. Redis is running
2. Worker initialized successfully (check server logs)
3. Queue is not paused: `POST /api/queue/resume`

### Jobs Failing Repeatedly

**Check:**
1. Twilio credentials are correct
2. Phone numbers are valid
3. PUBLIC_URL is accessible (use ngrok for local dev)
4. Check failed jobs: `GET /api/queue/failed`

## Production Deployment

### Redis Production Setup

For production, use a managed Redis service:
- **AWS ElastiCache**
- **Redis Cloud**
- **Azure Cache for Redis**
- **DigitalOcean Managed Redis**

Update your `.env`:
```env
REDIS_HOST=your-redis-host.com
REDIS_PORT=6379
REDIS_PASSWORD=your-secure-password
```

### Scaling Workers

Increase concurrency for higher throughput:
```env
CALL_WORKER_CONCURRENCY=20
```

### High Availability

Run multiple worker instances for redundancy:
```bash
# Instance 1
node index.js

# Instance 2 (on another server)
node index.js
```

BullMQ automatically distributes jobs across workers.

## Best Practices

1. **Use Priority Wisely** - Reserve `high` for urgent calls
2. **Monitor Failed Jobs** - Check `/api/queue/failed` regularly
3. **Clean Old Jobs** - Run cleanup periodically
4. **Rate Limiting** - Respect Twilio's rate limits
5. **Graceful Shutdown** - Use `SIGTERM` or `SIGINT` to stop server
6. **Database Logging** - All calls are logged to Supabase automatically

## Support

For issues or questions:
1. Check server logs for error messages
2. Verify Redis connection
3. Check queue statistics
4. Review failed jobs for patterns
