-- Migration: Add call_sid column to leads table
-- Purpose: Track Twilio call SID for each lead, linking to call_events and conversation_transcripts

-- Add call_sid column to leads table if it doesn't exist
ALTER TABLE leads
ADD COLUMN IF NOT EXISTS call_sid VARCHAR(50) UNIQUE;

-- Add index on call_sid for faster lookups
CREATE INDEX IF NOT EXISTS idx_leads_call_sid ON leads(call_sid);

-- Add comment to document the column
COMMENT ON COLUMN leads.call_sid IS 'Twilio Call SID from the most recent call associated with this lead';
