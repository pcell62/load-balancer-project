// worker.js
const http = require('http');
const https = require('https');
const httpProxy = require('http-proxy');
const fs = require('fs');
const cookie = require('cookie'); // Use cookie parsing library
const config = require('./config');
const ServerPool = require('./serverPool');
// Optional: const logger = require('./utils/logger'); // If using a separate logger

let serverPool = new ServerPool(config.servers, config.loadBalancingAlgorithm, config.healthCheck);
let requestCounter = 0; // Simple counter per worker

// --- Proxy Server Setup ---
const proxy = httpProxy.createProxyServer({
    xfwd: true, // Add X-Forwarded-* headers
    proxyTimeout: config.proxyTimeout,
    // Note: connectTimeout is not a direct option in http-proxy,
    // it's handled by the underlying net.Socket 'timeout' event during connection phase.
    // The main 'proxyTimeout' covers the whole proxy request lifecycle.
});

proxy.on('error', (err, req, res, target) => {
    // This catches errors *during* proxying (e.g., backend connection refused AFTER selection)
    console.error(`[${process.pid}] Proxy error for target ${target?.host}:${target?.port}:`, err.code || err.message);

    // Mark the specific target server as unhealthy immediately
    if (target?.host && target?.port) {
        const serverId = `${target.host}:${target.port}`;
        const targetServer = serverPool.getServerById(serverId);
        if (targetServer) {
            serverPool.markServerUnhealthy(targetServer, `Proxy Error: ${err.code || 'Unknown'}`);
            // Decrement connection count as the request failed
            serverPool.decrementConnections(serverId);
        }
    }

    // Send appropriate error response to client
    if (!res.headersSent) {
        // Distinguish between connection errors and other issues if possible
        const statusCode = (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND') ? 502 : 500;
        res.writeHead(statusCode, { 'Content-Type': 'text/plain' });
        res.end(`Proxy Error: ${statusCode === 502 ? 'Bad Gateway' : 'Internal Server Error'}`);
    } else {
        // If headers already sent, we can only abruptly end the connection
        res.end();
    }
});

// --- Main HTTP/HTTPS Server Logic ---
const requestHandler = (req, res) => {
    requestCounter++;
    let stickySessionId = null;

    // 1. Handle Sticky Sessions
    if (config.stickySession.enabled) {
        const cookies = cookie.parse(req.headers.cookie || '');
        stickySessionId = cookies[config.stickySession.cookieName];
        // Optional: Add validation here if needed (e.g., check format)
    }

    // 2. Select Backend Server
    const targetServer = serverPool.getNextServer(stickySessionId); // Pass sticky ID

    if (!targetServer) {
        console.warn(`[${process.pid}] No healthy backend servers available!`);
        res.writeHead(503, { 'Content-Type': 'text/plain' });
        res.end('Service Unavailable: No backend servers are healthy.');
        return;
    }

    const targetUrl = `http://${targetServer.host}:${targetServer.port}`; // Assuming backends are HTTP
    // console.log(`[${process.pid}] Routing ${req.method} ${req.url} to -> ${targetUrl} (Conn: ${targetServer.activeConnections})`);

    // 3. Set Sticky Session Cookie (if needed)
    if (config.stickySession.enabled && stickySessionId !== targetServer.id) {
        // Set cookie if it wasn't present, or if the chosen server changed (e.g., sticky target was down)
        res.setHeader('Set-Cookie', cookie.serialize(
            config.stickySession.cookieName,
            targetServer.id,
            config.stickySession.cookieOptions
        ));
         // console.log(`[${process.pid}] Setting sticky cookie for ${targetServer.id}`);
    }

    // 4. Proxy the Request
    proxy.web(req, res, {
        target: targetUrl,
        // Useful options:
        // secure: false, // Set to false if backend uses self-signed certs (use with caution)
        // changeOrigin: true, // Changes the 'Host' header to the target URL's host
    }, (err) => {
        // Error handling specific to *this* proxy attempt (handled by the global proxy 'error' event now)
        // We still need to decrement connection count here if the global handler didn't catch it
        // or if we want redundancy.
        serverPool.decrementConnections(targetServer.id); // Ensure decrement happens on error
    });


    // 5. Decrement connection count when client finishes
    // 'finish' event is reliable for indicating response has been sent.
    res.on('finish', () => {
        serverPool.decrementConnections(targetServer.id);
        // console.log(`[${process.pid}] Request finished for ${targetServer.id} (Conn: ${targetServer.activeConnections})`);
    });

    // Handle client abruptly closing connection before response finishes
    req.on('close', () => {
         if (!res.writableEnded) { // If response hasn't finished sending
             serverPool.decrementConnections(targetServer.id);
             // console.log(`[${process.pid}] Client closed connection prematurely for ${targetServer.id} (Conn: ${targetServer.activeConnections})`);
         }
     });
};

// --- Create Servers ---
let httpServer, httpsServer;

if (config.port) {
    httpServer = http.createServer(requestHandler);
    httpServer.on('error', (err) => console.error(`[${process.pid}] HTTP Server Error:`, err));
}

if (config.enableHttps && config.httpsPort) {
    try {
        const options = {
            key: fs.readFileSync(config.sslPaths.key),
            cert: fs.readFileSync(config.sslPaths.cert)
        };
        httpsServer = https.createServer(options, requestHandler);
        httpsServer.on('error', (err) => console.error(`[${process.pid}] HTTPS Server Error:`, err));
    } catch (err) {
        console.error(`[${process.pid}] Failed to create HTTPS server: ${err.message}. Check SSL certificate paths.`);
        // Decide if this is fatal. For simplicity, we'll let the worker continue if HTTP is enabled.
        if (!httpServer) process.exit(1); // Exit if neither server could start
    }
}

// --- Metrics Server (Optional, runs only in one worker or master) ---
// Note: For accurate aggregate metrics, the master should collect from workers,
// or use an external system. This basic version shows per-worker metrics.
let metricsServer;
function startMetricsServer() {
    if (config.metrics.enabled) {
        metricsServer = http.createServer((req, res) => {
            if (req.url === config.metrics.endpoint && req.method === 'GET') {
                const metrics = {
                    workerPid: process.pid,
                    requestsHandled: requestCounter,
                    serverPool: serverPool.getMetrics(),
                    uptimeSeconds: process.uptime(),
                    memoryUsage: process.memoryUsage(),
                };
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(metrics, null, 2));
            } else {
                res.writeHead(404);
                res.end('Not Found');
            }
        });
        metricsServer.listen(config.metrics.port, () => {
            console.log(`[${process.pid}] Metrics server listening on port ${config.metrics.port}`);
        });
        metricsServer.on('error', (err) => console.error(`[${process.pid}] Metrics Server Error:`, err));
    }
}


// --- Start Listening ---
function startListening() {
    if (httpServer) {
        httpServer.listen(config.port, () => {
            console.log(`[${process.pid}] Worker listening on HTTP port ${config.port}`);
        });
    }
    if (httpsServer) {
        httpsServer.listen(config.httpsPort, () => {
            console.log(`[${process.pid}] Worker listening on HTTPS port ${config.httpsPort}`);
        });
    }
}

// --- Graceful Shutdown ---
function gracefulShutdown() {
    console.log(`[${process.pid}] Worker shutting down...`);
    serverPool.stopHealthChecks();

    const closePromises = [];

    if (httpServer && httpServer.listening) {
        closePromises.push(new Promise(resolve => httpServer.close(resolve)));
    }
    if (httpsServer && httpsServer.listening) {
        closePromises.push(new Promise(resolve => httpsServer.close(resolve)));
    }
    if (metricsServer && metricsServer.listening) {
        closePromises.push(new Promise(resolve => metricsServer.close(resolve)));
    }

    // Close proxy server (important to release backend connections)
    closePromises.push(new Promise(resolve => proxy.close(resolve)));


    Promise.all(closePromises).then(() => {
        console.log(`[${process.pid}] Worker closed all servers.`);
        process.exit(0); // Exit gracefully
    }).catch(err => {
        console.error(`[${process.pid}] Error during worker shutdown:`, err);
        process.exit(1); // Exit with error
    });

    // Force exit after timeout
    setTimeout(() => {
        console.error(`[${process.pid}] Worker could not close connections in time, forcing exit.`);
        process.exit(1);
    }, 10000); // 10 seconds
}

// --- IPC (Inter-Process Communication) ---
process.on('message', (msg) => {
    if (msg === 'shutdown') {
        gracefulShutdown();
    }
    // Handle dynamic config updates (basic example)
    else if (msg.type === 'updateConfig' && msg.config) {
        // NOTE: A full config update is complex. This example focuses on updating servers.
        // A more robust solution might involve restarting workers or carefully merging configs.
        if (msg.config.servers) {
            serverPool.updateServers(msg.config.servers);
        } else {
             console.log(`[${process.pid}] Received config update message without server data.`);
        }
    }
});


// --- Exports (for master process) ---
module.exports = {
    startListening,
    startMetricsServer // Export function to control which worker starts it
};

// --- WebSocket Handling (Optional, add if needed) ---
/*
const setupWebSocketProxy = (server) => {
    server.on('upgrade', (req, socket, head) => {
        // Implement sticky session logic for WebSockets too if needed
        const targetServer = serverPool.getNextServer(); // Add stickySessionId if applicable
        if (targetServer) {
            const targetUrl = `ws://${targetServer.host}:${targetServer.port}`;
            console.log(`[${process.pid}] Routing WebSocket upgrade to -> ${targetUrl}`);
            proxy.ws(req, socket, head, { target: targetUrl }, (err) => {
                console.error(`[${process.pid}] WebSocket proxy error for ${targetUrl}:`, err.code || err.message);
                socket.destroy();
                // Decrement connection count? WS connections are long-lived, different tracking might be needed.
            });
             // Increment connection count? WS connection tracking needs care.
        } else {
            console.warn(`[${process.pid}] No healthy backend servers for WebSocket upgrade!`);
            socket.destroy();
        }
    });
};

if (httpServer) setupWebSocketProxy(httpServer);
if (httpsServer) setupWebSocketProxy(httpsServer);
*/