// config.js
require('dotenv').config(); // Load .env file if it exists

const config = {
    port: process.env.LB_PORT || 8080, // Port for the load balancer to listen on
    servers: [
        // Add your backend server addresses here
        { host: 'localhost', port: 3001 },
        { host: 'localhost', port: 3002 },
        { host: 'localhost', port: 3003 },
        { host: 'localhost', port: 3004 },
        // Add more servers as needed
    ],
    loadBalancingAlgorithm: process.env.LB_ALGORITHM || 'ROUND_ROBIN', // 'ROUND_ROBIN' or 'RANDOM'
    healthCheck: {
        enabled: true,
        interval: 10000, // Check every 10 seconds
        timeout: 5000,   // Request timeout after 5 seconds
        path: '/health', // Path to check on backend servers
    },
    // Optional: Define expected healthy status code
    healthCheckStatusCode: 200,
};

// Basic validation
if (!['ROUND_ROBIN', 'RANDOM'].includes(config.loadBalancingAlgorithm)) {
    console.warn(`Invalid loadBalancingAlgorithm "${config.loadBalancingAlgorithm}". Defaulting to ROUND_ROBIN.`);
    config.loadBalancingAlgorithm = 'ROUND_ROBIN';
}

module.exports = config;