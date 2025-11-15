
const validatePhoneNumber = (phoneNumber) => {
  const cleaned = phoneNumber.replace(/[^\d+]/g, '');
  const usaPattern = /^(\+1|1)?[2-9]\d{2}[2-9]\d{6}$/;
  
  const indiaPattern = /^(\+91|91)?[6-9]\d{9}$/;
  
  // Check if it matches USA pattern
  if (usaPattern.test(cleaned)) {
    const digits = cleaned.replace(/^\+?1?/, '');
    return {
      isValid: true,
      country: 'USA',
      formatted: `+1${digits}`,
      original: phoneNumber
    };
  }
  
  // Check if it matches India pattern
  if (indiaPattern.test(cleaned)) {
    const digits = cleaned.replace(/^\+?91?/, '');
    return {
      isValid: true,
      country: 'India',
      formatted: `+91${digits}`,
      original: phoneNumber
    };
  }
  
  // Invalid phone number
  return {
    isValid: false,
    country: null,
    formatted: null,
    original: phoneNumber,
    error: 'Invalid phone number format. Supported countries: USA (+1) and India (+91)'
  };
};

module.exports = {
  validatePhoneNumber
};
