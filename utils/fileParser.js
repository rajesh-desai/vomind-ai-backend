/**
 * File Parser Utility
 * Parses CSV and JSON files to extract lead data
 */

const { parse } = require('csv-parse/sync');

/**
 * Parse CSV buffer into lead objects
 * Supports columns: name, email, phone, company, lead_source, lead_status, lead_priority, message, notes
 * @param {Buffer} buffer - CSV file buffer
 * @returns {Array<Object>} Array of lead objects
 */
function parseCSV(buffer) {
  try {
    const content = buffer.toString('utf-8');
    const records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true
    });

    return records.map(record => ({
      name: record.name || null,
      email: record.email || null,
      phone: record.phone || null,
      company: record.company || null,
      lead_source: record.lead_source || 'file_import',
      lead_status: record.lead_status || 'new',
      lead_priority: record.lead_priority || 'medium',
      message: record.message || null,
      notes: record.notes || null,
      metadata: record.metadata ? JSON.parse(record.metadata) : null
    }));
  } catch (error) {
    throw new Error(`CSV parsing error: ${error.message}`);
  }
}

/**
 * Parse JSON buffer into lead objects
 * Supports both array and single object formats
 * @param {Buffer} buffer - JSON file buffer
 * @returns {Array<Object>} Array of lead objects
 */
function parseJSON(buffer) {
  try {
    const content = buffer.toString('utf-8');
    const data = JSON.parse(content);

    // Handle both array and single object
    const records = Array.isArray(data) ? data : [data];

    return records.map(record => ({
      name: record.name || null,
      email: record.email || null,
      phone: record.phone || null,
      company: record.company || null,
      lead_source: record.lead_source || 'file_import',
      lead_status: record.lead_status || 'new',
      lead_priority: record.lead_priority || 'medium',
      message: record.message || null,
      notes: record.notes || null,
      metadata: record.metadata || null
    }));
  } catch (error) {
    throw new Error(`JSON parsing error: ${error.message}`);
  }
}

/**
 * Parse file based on MIME type or extension
 * @param {Buffer} buffer - File buffer
 * @param {string} mimeType - MIME type or filename
 * @returns {Array<Object>} Array of lead objects
 */
function parseFile(buffer, mimeType) {
  if (!buffer || buffer.length === 0) {
    throw new Error('File buffer is empty');
  }

  // Detect format from MIME type or filename
  const isJSON = mimeType.includes('json') || mimeType.endsWith('.json');
  const isCSV = mimeType.includes('csv') || mimeType.includes('text/plain') || mimeType.endsWith('.csv');

  if (isJSON) {
    return parseJSON(buffer);
  } else if (isCSV) {
    return parseCSV(buffer);
  } else {
    throw new Error(`Unsupported file format: ${mimeType}. Supported: CSV, JSON`);
  }
}

/**
 * Validate lead records before inserting
 * @param {Array<Object>} leads - Array of lead objects
 * @returns {Object} { valid: Array, invalid: Array, errors: Array }
 */
function validateLeads(leads) {
  const valid = [];
  const invalid = [];
  const errors = [];

  leads.forEach((lead, index) => {
    const leadErrors = [];

    // At least one of name, email, phone required
    if (!lead.name && !lead.email && !lead.phone) {
      leadErrors.push('At least one of name, email, or phone is required');
    }

    // Email validation if provided
    if (lead.email && !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(lead.email)) {
      leadErrors.push(`Invalid email format: ${lead.email}`);
    }

    if (leadErrors.length > 0) {
      invalid.push(lead);
      errors.push({ row: index + 1, lead, errors: leadErrors });
    } else {
      valid.push(lead);
    }
  });

  return { valid, invalid, errors };
}

module.exports = {
  parseCSV,
  parseJSON,
  parseFile,
  validateLeads
};
