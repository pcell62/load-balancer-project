// loadBalancer.js
const http = require('http');
const httpProxy = require('http-proxy');
const config = require('./config');
const ServerPool = require('./serverPool');

// Initialize Server Pool
const pool = new ServerPool(config.servers, config.loadBalancingAlgorithm, config.healthCheck);

// Create a proxy server instance
const proxy = httpProxy.createProxyServer({
    xfwd: true, // Add X-Forwarded-* headers
});

// Error handling for the proxy server itself (e.g., if it fails to start)
proxy.on('error', (err, req, res) => {
    console.error('Proxy error:', err);
    if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
    }
    res.end('Proxy error occurred.');
});


// Create the main HTTP server (the load balancer)
const server = http.createServer((req, res) => {
    const targetServer = pool.getNextServer();

    if (!targetServer) {
        console.warn('No healthy backend servers available!');
        res.writeHead(503, { 'Content-Type': 'text/plain' }); // 503 Service Unavailable
        res.end('Service Unavailable: No backend servers are healthy.');
        return;
    }

    const targetUrl = `http://${targetServer.host}:${targetServer.port}`;
    console.log(`Routing request ${req.method} ${req.url} to -> ${targetUrl}`);

    // Proxy the request to the selected backend server
    proxy.web(req, res, { target: targetUrl }, (err) => {
        // This error handler catches errors connecting to the *backend* server
        console.error(`Backend error for ${targetUrl}:`, err.code || err.message);

        // Mark the server as unhealthy immediately upon connection error
        // Note: The health check will also catch this, but this provides faster feedback
        const serverIndex = pool.servers.findIndex(s => s.host === targetServer.host && s.port === targetServer.port);
        if (serverIndex !== -1 && pool.servers[serverIndex].healthy) {
             pool.servers[serverIndex].healthy = false;
             console.log(`Marked ${targetServer.host}:${targetServer.port} as Unhealthy due to proxy error.`);
             // Optional: trigger an immediate health check run?
             // pool.checkHealth();
        }


        if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'text/plain' }); // 502 Bad Gateway
        }
        res.end('Bad Gateway: Could not connect to backend server.');
    });
});

// Optional: Handle WebSocket upgrades (if your backends use WebSockets)
/*
server.on('upgrade', (req, socket, head) => {
    const targetServer = pool.getNextServer();
    if (targetServer) {
        const targetUrl = `ws://${targetServer.host}:${targetServer.port}`;
         console.log(`Routing WebSocket upgrade request to -> ${targetUrl}`);
        proxy.ws(req, socket, head, { target: targetUrl }, (err) => {
            console.error(`WebSocket proxy error for ${targetUrl}:`, err.code || err.message);
            // Handle WebSocket specific errors if needed
             socket.destroy();
        });
    } else {
        console.warn('No healthy backend servers available for WebSocket upgrade!');
        socket.destroy(); // Close the client socket
    }
});
*/


// Start listening
server.listen(config.port, () => {
    console.log(`Load Balancer listening on port ${config.port}`);
    console.log(`Using algorithm: ${config.loadBalancingAlgorithm}`);
    console.log('Registered backend servers:');
    config.servers.forEach(s => console.log(`  - ${s.host}:${s.port}`));
});

// Graceful Shutdown
const gracefulShutdown = (signal) => {
    console.log(`\nReceived ${signal}. Shutting down gracefully...`);
    pool.stopHealthChecks();
    server.close(() => {
        console.log('HTTP server closed.');
        proxy.close(() => {
             console.log('Proxy server closed.');
             process.exit(0);
        });
    });

    // Force close after a timeout if servers don't close quickly
    setTimeout(() => {
        console.error('Could not close connections in time, forcing shutdown.');
        process.exit(1);
    }, 10000); // 10 seconds timeout
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT')); // Catches Ctrl+C