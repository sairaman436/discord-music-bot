/**
 * Enhanced logging utility with debug mode support
 */

const fs = require('fs');
const path = require('path');

// Check if debug mode is enabled
const DEBUG = process.env.DEBUG === 'true';

// Log file path
const LOG_FILE = path.join(__dirname, '..', 'bot.log');

/**
 * Write to log file
 */
function writeLog(level, message) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] [${level}] ${message}\n`;
  
  if (DEBUG) {
    fs.appendFileSync(LOG_FILE, logEntry);
  }
}

/**
 * Enhanced console logging with file output
 */
const logger = {
  info: (message) => {
    console.log(`[INFO] ${message}`);
    writeLog('INFO', message);
  },
  
  warn: (message) => {
    console.warn(`[WARN] ${message}`);
    writeLog('WARN', message);
  },
  
  error: (message) => {
    console.error(`[ERROR] ${message}`);
    writeLog('ERROR', message);
  },
  
  debug: (message) => {
    if (DEBUG) {
      console.log(`[DEBUG] ${message}`);
      writeLog('DEBUG', message);
    }
  },
  
  stream: (message) => {
    console.log(`[STREAM] ${message}`);
    writeLog('STREAM', message);
  },
  
  playback: (message) => {
    console.log(`[PLAYBACK] ${message}`);
    writeLog('PLAYBACK', message);
  }
};

module.exports = logger;