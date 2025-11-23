# Call SID Integration Guide

## Overview

This document explains how `call_sid` (Twilio Call SID) is tracked and linked across the leads, call_events, and conversation_transcripts tables.

## Schema Changes

### Leads Table - New Column

A new `call_sid` column has been added to the `leads` table:

```sql
ALTER TABLE leads
ADD COLUMN IF NOT EXISTS call_sid VARCHAR(50) UNIQUE;

CREATE INDEX idx_leads_call_sid ON leads(call_sid);
```

- **Type:** VARCHAR(50) - Stores Twilio Call SID
- **Unique:** Yes - Each lead can be linked to one call (most recent)
- **Indexed:** Yes - For fast lookups by call_sid

## Data Flow

### 1. Outbound Calls (Queue-Based)

**Flow:** Lead → Schedule Call → Call Worker → Twilio → Lead Updated

```
┌─────────────────────────────────────────────────────────────┐
│ POST /api/queue/schedule-call                               │
│ Payload: { to, message, lead_id, ... }                      │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ callQueue.add('make-call', { lead_id, to, message })        │
│ Job added to Redis queue: outbound-calls                     │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ callWorker processes job                                     │
│ Step 1: Initiate Twilio call                                │
│   → Receives callSid from Twilio                            │
│                                                              │
│ Step 2: Update database (if models available)               │
│   → models.Lead.update(lead_id, {                           │
│       call_sid: callSid,                                    │
│       lead_status: 'contacted',                             │
│       last_contacted_at: now,                               │
│       notes: `Outbound call ${callSid} initiated`           │
│     })                                                       │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ ✅ Lead now has call_sid linked                             │
│ ✅ Lead status: 'contacted'                                 │
│ ✅ Accessible via:                                          │
│    - models.Lead.findById(lead_id)                          │
│    - models.Lead.findByCallSid(call_sid)                    │
└─────────────────────────────────────────────────────────────┘
```

### 2. Inbound Calls (WebSocket Media Stream)

**Flow:** Inbound Call → Media Stream → OpenAI Session → Transcripts & Lead Updated

```
┌─────────────────────────────────────────────────────────────┐
│ Incoming Twilio call to /media-stream-twiml                 │
│ Twilio sends media stream to WebSocket                       │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ WebSocket 'start' event                                      │
│ - callSid received from Twilio                              │
│ - OpenAIRealtimeSession created with models                 │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ OpenAI conversation happens                                  │
│ Messages exchanged with user                                 │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ saveTranscriptToDatabase() called                            │
│ Step 1: Save transcript to conversation_transcripts         │
│   → { call_sid, role, message, timestamp }                  │
│                                                              │
│ Step 2: Try to link to lead (if models available)           │
│   → Find existing lead by call_sid (fast path)              │
│   → If not found:                                           │
│     - Get call details from call_events table               │
│     - Find lead with matching phone number                  │
│     - Update lead with call_sid                             │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ ✅ Transcript saved with call_sid                           │
│ ✅ Lead linked to call_sid (if found)                       │
│ ✅ All related data discoverable:                           │
│    - Lead → Call → Transcripts                              │
│    - Call → Lead, Transcripts                               │
│    - Transcript → Call → Lead                               │
└─────────────────────────────────────────────────────────────┘
```

## Database Relationships

### Table Links via call_sid

```
┌──────────────┐              ┌──────────────────┐
│    leads     │              │  call_events     │
├──────────────┤              ├──────────────────┤
│ id (PK)      │              │ id (PK)          │
│ phone        │───┐    ┌────→│ call_sid (FK)    │
│ call_sid (FK)│───┼────┤     │ to_number        │
│ lead_status  │   │    │     │ from_number      │
│ ...          │   │    │     │ call_status      │
└──────────────┘   │    │     │ duration         │
                   │    │     │ ...              │
                   │    │     └──────────────────┘
                   │    │
                   │    │     ┌──────────────────────┐
                   │    └────→│conversation_transcripts
                   │          ├──────────────────────┤
                   └─────────→│ id (PK)              │
                              │ call_sid (FK)        │
                              │ speaker/role         │
                              │ message/content      │
                              │ timestamp            │
                              │ ...                  │
                              └──────────────────────┘
```

## API Methods

### Lead Model

```javascript
// Find lead by call_sid
const lead = await models.Lead.findByCallSid(callSid);

// Update lead with call_sid
await models.Lead.updateCallSid(leadId, callSid);

// Or use generic update
await models.Lead.update(leadId, {
  call_sid: callSid,
  lead_status: 'contacted'
});
```

### Finding Related Data

```javascript
// Get lead and all related data
const lead = await models.Lead.findById(leadId);
// lead.call_sid is now available

// Get call events for a lead
const callEvents = await supabase
  .from('call_events')
  .select('*')
  .eq('call_sid', lead.call_sid);

// Get transcripts for a lead
const transcripts = await supabase
  .from('conversation_transcripts')
  .select('*')
  .eq('call_sid', lead.call_sid);

// Or use models
const transcripts = await models.ConversationTranscript.findByCallSid(lead.call_sid);
```

## API Endpoints

### Get Lead with Call Information

```bash
GET /api/leads/:id

Response:
{
  "success": true,
  "data": {
    "id": 123,
    "name": "John Doe",
    "phone": "+1234567890",
    "call_sid": "CA1234567890abcdef",
    "lead_status": "contacted",
    "last_contacted_at": "2025-11-23T10:30:00Z",
    ...
  }
}
```

### Get All Leads (with call_sid)

```bash
GET /api/leads?limit=10&offset=0

Response includes leads with call_sid field if available
```

### Get Call Transcripts

```bash
GET /transcripts/:callSid

Response:
{
  "callSid": "CA1234567890abcdef",
  "transcripts": [
    {
      "id": 1,
      "call_sid": "CA1234567890abcdef",
      "role": "user",
      "content": "Hello",
      "timestamp": "2025-11-23T10:30:00Z"
    },
    ...
  ],
  "messageCount": 5,
  "success": true
}
```

## Setup Instructions

### 1. Run Migration

Apply the SQL migration to your Supabase database:

```bash
# Option 1: Via Supabase Dashboard
# 1. Go to SQL Editor in Supabase
# 2. Create new query
# 3. Copy contents of migrations/add_call_sid_to_leads.sql
# 4. Run

# Option 2: Via scripts (if you have a migration runner)
npm run migrate
```

### 2. Verify Column Exists

```sql
-- Check if column was added
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'leads' AND column_name = 'call_sid';

-- Check index
SELECT indexname FROM pg_indexes WHERE tablename = 'leads';
```

### 3. Test the Integration

```bash
# 1. Start the server
npm start

# 2. Schedule an outbound call
curl -X POST http://localhost:3000/api/queue/schedule-call \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+1234567890",
    "message": "Hello from VoMindAI",
    "lead_id": 123,
    "priority": "normal"
  }'

# 3. Check the lead was updated
curl http://localhost:3000/api/leads/123

# Response should include:
# "call_sid": "CA..."
```

## Error Handling

### Lead Not Found During Transcript Save

If a lead cannot be found when saving transcripts:
- The transcript is still saved with call_sid
- A warning is logged: `⚠️  Could not update lead with call_sid`
- The call_events table will have the call_sid
- Manual linking can be done via API or database

### call_sid Already Linked

If a lead already has a call_sid when trying to link:
- The link is skipped (not updated)
- Log: `✅ Lead ${id} already has call_sid set`
- This prevents overwriting during conversation saves

## Troubleshooting

### Issue: Lead doesn't have call_sid after call

**Causes:**
1. Models not initialized - check `index.js` that `models` is initialized
2. lead_id not provided in job - include `lead_id` in schedule call payload
3. Database error - check server logs for DB errors

**Solution:**
```javascript
// Manually link
const lead = await models.Lead.findById(leadId);
const callEvent = await supabase
  .from('call_events')
  .select('call_sid')
  .eq('to_number', lead.phone)
  .order('created_at', { ascending: false })
  .limit(1)
  .single();

if (callEvent) {
  await models.Lead.updateCallSid(leadId, callEvent.call_sid);
}
```

### Issue: Transcripts don't show for lead

**Check:**
1. Lead has call_sid: `SELECT call_sid FROM leads WHERE id = ?`
2. call_events record exists: `SELECT * FROM call_events WHERE call_sid = ?`
3. Transcripts exist: `SELECT * FROM conversation_transcripts WHERE call_sid = ?`

### Issue: Duplicate call_sid

**Note:** The UNIQUE constraint on call_sid means each call can be linked to only one lead. If you try to update a different lead with the same call_sid, it will fail.

**Solution:**
```javascript
// First, unlink the old lead
await supabase
  .from('leads')
  .update({ call_sid: null })
  .eq('call_sid', callSid);

// Then, link the new lead
await models.Lead.updateCallSid(newLeadId, callSid);
```

## Summary

| Component | Change | Purpose |
|-----------|--------|---------|
| `leads` table | Added `call_sid` column | Link leads to calls |
| `Lead` model | Added `updateCallSid()`, `findByCallSid()` | API for call_sid operations |
| `callWorker` | Updates lead after call initiated | Immediate linkage for outbound |
| `OpenAIRealtimeSession` | Tries to link lead during transcript save | Linkage for inbound calls |
| Migration file | `add_call_sid_to_leads.sql` | Schema update script |

This ensures all lead-to-call relationships are traceable and accessible through a single call_sid identifier.
