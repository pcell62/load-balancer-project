const http = require('http');
const PORT = 3001;

const server = http.createServer((req, res) => {
    if (req.url === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
        return;
    }
    console.log(`[Server ${PORT}] Received ${req.method} ${req.url}`);
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(`Hello from Server ${PORT}!`);
});

server.listen(PORT, () => {
    console.log(`Backend server listening on port ${PORT}`);
});