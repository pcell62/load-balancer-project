// serverPool.js
const http = require('http');
const { healthCheckStatusCode } = require('./config'); // Import expected status code

class ServerPool {
    constructor(servers = [], algorithm = 'ROUND_ROBIN', healthCheckConfig = {}) {
        this.servers = servers.map(s => ({ ...s, healthy: true })); // Assume healthy initially
        this.algorithm = algorithm;
        this.currentIndex = -1; // For Round Robin
        this.healthCheckConfig = healthCheckConfig;
        this.healthCheckIntervalId = null;

        if (this.healthCheckConfig.enabled) {
            this.startHealthChecks();
        }
    }

    getHealthyServers() {
        return this.servers.filter(server => server.healthy);
    }

    getNextServer() {
        const healthyServers = this.getHealthyServers();
        if (healthyServers.length === 0) {
            return null; // No healthy servers available
        }

        switch (this.algorithm) {
            case 'RANDOM':
                const randomIndex = Math.floor(Math.random() * healthyServers.length);
                return healthyServers[randomIndex];
            case 'ROUND_ROBIN':
            default:
                this.currentIndex = (this.currentIndex + 1) % healthyServers.length;
                return healthyServers[this.currentIndex];
        }
    }

    startHealthChecks() {
        if (this.healthCheckIntervalId) {
            clearInterval(this.healthCheckIntervalId); // Clear existing interval if any
        }

        console.log(`Starting health checks every ${this.healthCheckConfig.interval / 1000}s...`);
        this.healthCheckIntervalId = setInterval(
            () => this.checkHealth(),
            this.healthCheckConfig.interval
        );
        // Perform an initial check immediately
        this.checkHealth();
    }

    stopHealthChecks() {
        if (this.healthCheckIntervalId) {
            console.log('Stopping health checks...');
            clearInterval(this.healthCheckIntervalId);
            this.healthCheckIntervalId = null;
        }
    }

    async checkHealth() {
        // console.log('Performing health checks...'); // Can be noisy
        await Promise.all(this.servers.map(server => this.checkSingleServer(server)));
    }

    async checkSingleServer(server) {
        const options = {
            host: server.host,
            port: server.port,
            path: this.healthCheckConfig.path || '/',
            method: 'GET',
            timeout: this.healthCheckConfig.timeout,
        };

        return new Promise((resolve) => {
            const req = http.request(options, (res) => {
                const wasHealthy = server.healthy;
                // Check if status code matches the expected healthy code
                server.healthy = res.statusCode === healthCheckStatusCode;

                if (wasHealthy !== server.healthy) {
                    console.log(`Server ${server.host}:${server.port} changed status to ${server.healthy ? 'Healthy' : 'Unhealthy'} (Status: ${res.statusCode})`);
                }
                res.resume(); // Consume response data
                resolve();
            });

            req.on('error', (err) => {
                const wasHealthy = server.healthy;
                server.healthy = false;
                if (wasHealthy !== server.healthy) {
                    console.log(`Server ${server.host}:${server.port} changed status to Unhealthy (Error: ${err.code || err.message})`);
                }
                resolve();
            });

            req.on('timeout', () => {
                 const wasHealthy = server.healthy;
                 server.healthy = false;
                 if (wasHealthy !== server.healthy) {
                     console.log(`Server ${server.host}:${server.port} changed status to Unhealthy (Error: Timeout)`);
                 }
                 req.destroy(); // Destroy the request explicitly on timeout
                 resolve();
            });

            req.end();
        });
    }

    // Method to update servers dynamically (optional)
    updateServers(newServers) {
        this.stopHealthChecks();
        this.servers = newServers.map(s => ({ ...s, healthy: true }));
        this.currentIndex = -1;
        if (this.healthCheckConfig.enabled) {
            this.startHealthChecks();
        }
        console.log('Server pool updated.');
    }
}

module.exports = ServerPool;