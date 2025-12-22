/**
 * Model Index - Export all ORM models
 * Provides a centralized way to initialize and access all models
 */

const Lead = require('./Lead');
const CallEvent = require('./CallEvent');
const ConversationTranscript = require('./ConversationTranscript');
const CallRecording = require('./CallRecording');
const User = require('./User');

/**
 * Initialize all models with a Supabase client
 * @param {Object} supabase - Supabase client instance
 * @returns {Object} Object containing all initialized models
 */
function initializeModels(supabase) {
  return {
    Lead: new Lead(supabase),
    CallEvent: new CallEvent(supabase),
    ConversationTranscript: new ConversationTranscript(supabase),
    CallRecording: new CallRecording(supabase),
    User: new User(supabase)
  };
}

module.exports = {
  Lead,
  CallEvent,
  ConversationTranscript,
  CallRecording,
  User,
  initializeModels
};
