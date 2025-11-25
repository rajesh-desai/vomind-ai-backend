/**
 * Recording Manager for Twilio Calls
 * Handles downloading recordings from Twilio, uploading to Supabase Storage,
 * and managing recording metadata in the database
 */

const twilio = require('twilio');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const os = require('os');

class RecordingManager {
  constructor(twilioClient, supabase, models) {
    this.twilioClient = twilioClient;
    this.supabase = supabase;
    this.models = models;
    this.storageBucket = process.env.SUPABASE_STORAGE_BUCKET || 'call-recordings';
  }

  /**
   * Download recording from Twilio
   * @param {string} recordingSid - Twilio Recording SID
   * @param {string} accountSid - Twilio Account SID
   * @param {string} format - Audio format (mp3, wav, etc.)
   * @returns {Promise<Buffer>} Recording audio buffer
   */
  async downloadRecordingFromTwilio(recordingSid, accountSid, format = 'mp3') {
    try {
      console.log(`🎙️  Downloading recording ${recordingSid} from Twilio...`);

      const recordingUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${recordingSid}.${format}`;

      const response = await axios.get(recordingUrl, {
        auth: {
          username: process.env.TWILIO_ACCOUNT_SID,
          password: process.env.TWILIO_AUTH_TOKEN
        },
        responseType: 'arraybuffer'
      });

      console.log(`✅ Successfully downloaded recording ${recordingSid} (${response.data.length} bytes)`);
      return response.data;
    } catch (error) {
      console.error(`❌ Failed to download recording ${recordingSid}:`, error.message);
      throw error;
    }
  }

  /**
   * Upload recording to Supabase Storage
   * @param {Buffer} audioBuffer - Audio file buffer
   * @param {string} fileName - File name with extension
   * @returns {Promise<Object>} Upload result with URL and path
   */
  async uploadToSupabaseStorage(audioBuffer, fileName) {
    try {
      if (!this.supabase) {
        throw new Error('Supabase client not initialized');
      }

      console.log(`💾 Uploading ${fileName} to Supabase Storage (bucket: ${this.storageBucket})...`);

      // Generate file path with date-based structure
      const now = new Date();
      const dateFolder = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;
      const filePath = `${dateFolder}/${fileName}`;

      // Upload file to Supabase Storage
      const { data, error } = await this.supabase.storage
        .from(this.storageBucket)
        .upload(filePath, audioBuffer, {
          contentType: 'audio/mpeg',
          upsert: false
        });

      if (error) {
        throw error;
      }

      console.log(`✅ Recording uploaded to Supabase: ${filePath}`);

      // Generate signed URL (valid for 1 year)
      const { data: urlData, error: urlError } = await this.supabase.storage
        .from(this.storageBucket)
        .createSignedUrl(filePath, 60 * 60 * 24 * 365); // 1 year in seconds

      if (urlError) {
        console.warn(`⚠️  Could not generate signed URL:`, urlError.message);
      }

      return {
        success: true,
        path: filePath,
        url: urlData?.signedUrl || null,
        fileName: fileName,
        bucket: this.storageBucket
      };
    } catch (error) {
      console.error(`❌ Failed to upload to Supabase:`, error.message);
      throw error;
    }
  }

  /**
   * Save recording metadata to database
   * @param {Object} recordingData - Recording metadata
   * @returns {Promise<Object>} Saved recording record
   */
  async saveRecordingToDatabase(recordingData) {
    try {
      if (!this.models || !this.models.CallRecording) {
        throw new Error('CallRecording model not available');
      }

      console.log(`📝 Saving recording metadata for call ${recordingData.callSid}...`);

      const recording = await this.models.CallRecording.create({
        call_sid: recordingData.callSid,
        recording_sid: recordingData.recordingSid,
        call_event_id: recordingData.callEventId || null,
        lead_id: recordingData.leadId || null,
        storage_path: recordingData.storagePath,
        storage_url: recordingData.storageUrl,
        file_name: recordingData.fileName,
        file_size: recordingData.fileSize,
        duration: recordingData.duration,
        format: recordingData.format || 'mp3',
        status: 'completed',
        metadata: recordingData.metadata || {}
      });

      console.log(`✅ Recording metadata saved to database:`, recording.id);
      return recording;
    } catch (error) {
      console.error(`❌ Failed to save recording to database:`, error.message);
      throw error;
    }
  }

  /**
   * Process a recording end-to-end
   * @param {Object} params - Parameters
   * @returns {Promise<Object>} Complete recording result
   */
  async processRecording(params) {
    const {
      recordingSid,
      callSid,
      callEventId,
      leadId,
      duration,
      format = 'mp3'
    } = params;

    try {
      console.log(`🎬 Processing recording for call ${callSid}...`);

      // 1. Download from Twilio
      const audioBuffer = await this.downloadRecordingFromTwilio(
        recordingSid,
        process.env.TWILIO_ACCOUNT_SID,
        format
      );

      // 2. Upload to Supabase
      const fileName = `${callSid}_${recordingSid}.${format}`;
      const uploadResult = await this.uploadToSupabaseStorage(audioBuffer, fileName);

      // 3. Save to database
      const dbRecord = await this.saveRecordingToDatabase({
        callSid,
        recordingSid,
        callEventId,
        leadId,
        storagePath: uploadResult.path,
        storageUrl: uploadResult.url,
        fileName: uploadResult.fileName,
        fileSize: audioBuffer.length,
        duration,
        format,
        metadata: {
          uploadedAt: new Date().toISOString(),
          twilio: {
            accountSid: process.env.TWILIO_ACCOUNT_SID,
            recordingSid
          }
        }
      });

      console.log(`🎉 Recording processing complete for ${callSid}`);

      return {
        success: true,
        recording: dbRecord,
        storage: uploadResult,
        message: 'Recording processed and saved successfully'
      };
    } catch (error) {
      console.error(`❌ Error processing recording:`, error.message);
      return {
        success: false,
        error: error.message,
        recordingSid,
        callSid
      };
    }
  }

  /**
   * Delete recording from Supabase Storage
   * @param {string} filePath - File path in storage
   * @returns {Promise<boolean>} Success status
   */
  async deleteFromStorage(filePath) {
    try {
      if (!this.supabase) {
        throw new Error('Supabase client not initialized');
      }

      const { error } = await this.supabase.storage
        .from(this.storageBucket)
        .remove([filePath]);

      if (error) {
        throw error;
      }

      console.log(`✅ Deleted recording from storage: ${filePath}`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to delete recording:`, error.message);
      return false;
    }
  }

  /**
   * Get recording by call SID
   * @param {string} callSid - Twilio Call SID
   * @returns {Promise<Object>} Recording record
   */
  async getRecordingByCallSid(callSid) {
    try {
      if (!this.models || !this.models.CallRecording) {
        throw new Error('CallRecording model not available');
      }

      const recording = await this.models.CallRecording.findByCallSid(callSid);
      return recording;
    } catch (error) {
      console.error(`❌ Error fetching recording for ${callSid}:`, error.message);
      return null;
    }
  }

  /**
   * Get storage signed URL for a recording
   * @param {string} filePath - File path in storage
   * @param {number} expiresIn - Expiration time in seconds (default: 1 hour)
   * @returns {Promise<string>} Signed URL
   */
  async getSignedUrl(filePath, expiresIn = 3600) {
    try {
      if (!this.supabase) {
        throw new Error('Supabase client not initialized');
      }

      const { data, error } = await this.supabase.storage
        .from(this.storageBucket)
        .createSignedUrl(filePath, expiresIn);

      if (error) {
        throw error;
      }

      return data.signedUrl;
    } catch (error) {
      console.error(`❌ Failed to generate signed URL:`, error.message);
      return null;
    }
  }
}

module.exports = RecordingManager;
