// config.js
require('dotenv').config();
const path = require('path');

const config = {
    // --- General ---
    port: parseInt(process.env.LB_PORT || '8080', 10),
    httpsPort: parseInt(process.env.LB_HTTPS_PORT || '8443', 10),
    enableHttps: process.env.LB_ENABLE_HTTPS === 'true',
    sslPaths: {
        key: process.env.LB_SSL_KEY_PATH || path.join(__dirname, 'ssl/key.pem'),
        cert: process.env.LB_SSL_CERT_PATH || path.join(__dirname, 'ssl/cert.pem')
    },
    numWorkers: process.env.LB_NUM_WORKERS ? parseInt(process.env.LB_NUM_WORKERS, 10) : require('os').cpus().length, // Default to number of CPUs

    // --- Backend Servers ---
    servers: [
        // Weights are now included
        { host: 'localhost', port: 3001, weight: 5 },
        { host: 'localhost', port: 3002, weight: 3 },
        { host: 'localhost', port: 3003, weight: 1 },
        { host: 'localhost', port: 3004, weight: 1 },
        // Add more servers with weights
    ],

    // --- Load Balancing ---
    loadBalancingAlgorithm: process.env.LB_ALGORITHM || 'WEIGHTED_ROUND_ROBIN', // Options: 'ROUND_ROBIN', 'RANDOM', 'WEIGHTED_ROUND_ROBIN', 'WEIGHTED_RANDOM'
    stickySession: {
        enabled: process.env.LB_STICKY_SESSIONS === 'true',
        cookieName: process.env.LB_STICKY_COOKIE_NAME || 'lb_sticky_session',
        cookieOptions: {
            httpOnly: true,
            path: '/',
            maxAge: 3600 * 1000, // 1 hour in ms
             // secure: process.env.NODE_ENV === 'production', // Set Secure flag in production (requires HTTPS) - enable carefully
        }
    },

    // --- Health Checks ---
    healthCheck: {
        enabled: process.env.HC_ENABLED !== 'false', // default true
        interval: parseInt(process.env.HC_INTERVAL || '10000', 10),
        timeout: parseInt(process.env.HC_TIMEOUT || '5000', 10),
        path: process.env.HC_PATH || '/health',
        method: process.env.HC_METHOD || 'GET',
        // More specific checks
        expect: {
            statusCode: parseInt(process.env.HC_EXPECT_STATUS || '200', 10),
            // Optional: Check response body includes a specific string
            // bodyIncludes: process.env.HC_EXPECT_BODY || null
        }
    },

    // --- Operational ---
    metrics: {
        enabled: process.env.METRICS_ENABLED === 'true',
        port: parseInt(process.env.METRICS_PORT || '9091', 10), // Separate port for metrics
        endpoint: process.env.METRICS_ENDPOINT || '/metrics',
    },
    dynamicConfigReloadSignal: 'SIGHUP', // Signal to trigger config reload (if implemented)

    // --- Proxy Options ---
    proxyTimeout: parseInt(process.env.PROXY_TIMEOUT || '30000', 10), // Timeout for backend connection
    proxyConnectTimeout: parseInt(process.env.PROXY_CONNECT_TIMEOUT || '5000', 10), // Timeout specifically for establishing connection
};

// --- Basic Validation ---
const validAlgorithms = ['ROUND_ROBIN', 'RANDOM', 'WEIGHTED_ROUND_ROBIN', 'WEIGHTED_RANDOM'];
if (!validAlgorithms.includes(config.loadBalancingAlgorithm)) {
    console.warn(`Invalid loadBalancingAlgorithm "${config.loadBalancingAlgorithm}". Defaulting to WEIGHTED_ROUND_ROBIN.`);
    config.loadBalancingAlgorithm = 'WEIGHTED_ROUND_ROBIN';
}

if (config.enableHttps && (!config.sslPaths.key || !config.sslPaths.cert)) {
    console.error("HTTPS is enabled, but SSL key or certificate path is missing!");
    process.exit(1);
}

if (config.stickySession.enabled && config.numWorkers > 1) {
    console.warn("Sticky sessions with multiple workers rely on client cookies and may not guarantee stickiness if a worker handling the session dies. Ensure backend sessions are shared if necessary.");
}

// Ensure servers have weights if needed by algorithm
if (config.loadBalancingAlgorithm.includes('WEIGHTED')) {
    config.servers = config.servers.map(s => ({ ...s, weight: s.weight ?? 1 })); // Default weight 1 if missing
}


module.exports = config;