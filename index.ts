import dotenv from 'dotenv';

dotenv.config({ path: 'local.env' });

console.log('Hello World');

console.log('Environment Variables:');
console.log(process.env);
