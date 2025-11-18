# Quick Start Guide - Call Queue System

## Step 1: Install Redis

### Ubuntu/Debian
```bash
sudo apt update
sudo apt install redis-server
sudo systemctl start redis
sudo systemctl status redis
```

### macOS
```bash
brew install redis
brew services start redis
```

### Docker
```bash
docker run -d -p 6379:6379 --name redis redis:alpine
```

## Step 2: Verify Redis

```bash
redis-cli ping
# Expected output: PONG
```

## Step 3: Configure Environment

Add to your `.env` file:

```env
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Call Worker Concurrency
CALL_WORKER_CONCURRENCY=5
```

## Step 4: Start the Server

```bash
npm start
```

You should see:
```
📞 Call queue worker initialized
Server is running on port 3000
```

## Step 5: Test the Queue

### Schedule an immediate call:

```bash
curl -X POST http://localhost:3000/api/queue/schedule-call \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+1234567890",
    "message": "Test call from queue",
    "priority": "high"
  }'
```

### Check queue statistics:

```bash
curl http://localhost:3000/api/queue/stats
```

### Get job status:

```bash
curl http://localhost:3000/api/queue/job/1
```

## Step 6: Monitor Queue

View active jobs:
```bash
curl http://localhost:3000/api/queue/active
```

View waiting jobs:
```bash
curl http://localhost:3000/api/queue/waiting
```

View failed jobs:
```bash
curl http://localhost:3000/api/queue/failed
```

## Common Issues

### Redis connection refused
**Error:** `ECONNREFUSED 127.0.0.1:6379`

**Fix:**
```bash
# Check if Redis is running
sudo systemctl status redis  # Linux
brew services list           # macOS

# Start Redis if not running
sudo systemctl start redis   # Linux
brew services start redis    # macOS
```

### Worker not processing jobs
**Check server logs for:**
- ✅ "Call queue worker initialized"
- ✅ "Worker started and ready to process jobs"

**If missing:**
1. Verify Redis is running
2. Check REDIS_HOST and REDIS_PORT in .env
3. Restart the server

## Next Steps

- Read [QUEUE_SYSTEM.md](./QUEUE_SYSTEM.md) for full documentation
- Run examples: `node examples/queueExamples.js`
- Check API endpoints in documentation
- Set up monitoring and alerts

## Production Checklist

- [ ] Use managed Redis service (AWS ElastiCache, Redis Cloud, etc.)
- [ ] Set REDIS_PASSWORD in production
- [ ] Configure appropriate CALL_WORKER_CONCURRENCY
- [ ] Set up queue monitoring
- [ ] Implement alerting for failed jobs
- [ ] Regular cleanup of old jobs
- [ ] Load testing for your call volume
