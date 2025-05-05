import dotenv from 'dotenv';
import logger from './logger.js'; // Import the logger

dotenv.config({ path: 'local.env' });

logger.debug('Environment Variables:', process.env); // Use logger.debug for detailed info
logger.warn('This is a warning message.'); // Example warning
logger.error('This is an error message.'); // Example error

// Example of logging an object
const user = { id: 1, name: 'Test User' };
logger.info('User object:', user);

// Example of logging with string interpolation
const variable = process.env.MY_VARIABLE;
logger.info(`My variable value is: ${variable}`);
