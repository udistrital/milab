
const http = require('http');

const options = {
  host: '127.0.0.1',
  port: process.env.PORT || 4000,
  path: '/health',
  method: 'GET',
  timeout: 3000,
};

const req = http.request(options, (res) => {
  process.exit(res.statusCode === 200 ? 0 : 1);
});

req.on('timeout', () => {
  req.destroy();
  process.exit(1);
});

req.on('error', () => {
  process.exit(1);
});

req.end();
