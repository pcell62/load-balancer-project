// serverPool.js
const http = require('http');
const https = require('https'); // Needed if health checking HTTPS backends (less common)

class ServerPool {
    constructor(servers = [], algorithm = 'ROUND_ROBIN', healthCheckConfig = {}) {
        // Internal structure: Add unique ID and potentially active connection count
        this.servers = servers.map((s, index) => ({
            ...s,
            id: `${s.host}:${s.port}`, // Unique ID for sticky sessions/tracking
            healthy: true,
            weight: s.weight ?? 1,     // Default weight
            currentWeight: 0,         // For WRR algorithm
            activeConnections: 0,     // Basic counter for 'Least Connections' (if implemented)
        }));
        this.algorithm = algorithm;
        this.healthCheckConfig = healthCheckConfig;
        this.healthCheckIntervalId = null;
        this.currentIndex = -1; // For Round Robin

        // --- Precompute for Weighted algorithms ---
        this.gcdWeight = 0;
        this.maxWeight = 0;
        this.weightedServerList = []; // For simpler weighted random/RR
        this.totalWeight = 0;

        if (this.algorithm.includes('WEIGHTED')) {
            this.calculateWeights();
            this.buildWeightedList();
        }
        // --- End Weighted Precompute ---

        if (this.healthCheckConfig.enabled) {
            this.startHealthChecks();
        }
    }

    // --- Weight Calculation Helpers ---
    _gcd(a, b) {
        return b === 0 ? a : this._gcd(b, a % b);
    }

    calculateWeights() {
        const healthyServers = this.getHealthyServers();
        if (!healthyServers.length) return;

        this.gcdWeight = healthyServers.reduce((acc, server) => this._gcd(acc, server.weight), healthyServers[0].weight);
        this.maxWeight = Math.max(...healthyServers.map(s => s.weight));
        this.totalWeight = healthyServers.reduce((sum, server) => sum + server.weight, 0);
    }

    buildWeightedList() {
         this.weightedServerList = [];
         this.servers.forEach(server => {
             // Add server to the list 'weight' times
             for (let i = 0; i < server.weight; i++) {
                 this.weightedServerList.push(server);
             }
         });
    }
    // --- End Weight Helpers ---

    getHealthyServers() {
        return this.servers.filter(server => server.healthy);
    }

    getServerById(id) {
        return this.servers.find(server => server.id === id);
    }

    // --- Enhanced getNextServer ---
    getNextServer(stickySessionId = null) {
        let healthyServers = this.getHealthyServers();
        if (healthyServers.length === 0) {
            return null;
        }

        // 1. Handle Sticky Session
        if (stickySessionId) {
            const targetServer = healthyServers.find(s => s.id === stickySessionId);
            if (targetServer) {
                // console.log(`Sticky session: Routing to ${targetServer.id}`);
                this.incrementConnections(targetServer.id);
                return targetServer;
            }
            // If sticky server is unhealthy or not found, fall through to algorithm
            // console.log(`Sticky session server ${stickySessionId} not available/healthy.`);
        }

        // 2. Apply Load Balancing Algorithm
        let chosenServer = null;

        // Re-filter weighted list based on current health
        const healthyWeightedList = this.weightedServerList.filter(ws => ws.healthy);
        if(this.algorithm.includes('WEIGHTED') && healthyWeightedList.length === 0) {
            // Fallback if weighted list becomes empty but healthyServers is not (shouldn't happen often)
             healthyServers = this.getHealthyServers(); // Refresh just in case
             if (healthyServers.length === 0) return null;
             this.algorithm = 'ROUND_ROBIN'; // Temporarily fallback
             console.warn("Weighted list empty despite healthy servers, falling back to ROUND_ROBIN temporarily.");
        }


        switch (this.algorithm) {
            case 'RANDOM':
                const randomIndex = Math.floor(Math.random() * healthyServers.length);
                chosenServer = healthyServers[randomIndex];
                break;

            case 'WEIGHTED_RANDOM': // Simple Weighted Random using expanded list
                 if (healthyWeightedList.length > 0) {
                     const randomWeightedIndex = Math.floor(Math.random() * healthyWeightedList.length);
                     chosenServer = healthyWeightedList[randomWeightedIndex];
                 }
                 break;


            case 'WEIGHTED_ROUND_ROBIN': // Simple WRR using expanded list
                 if (healthyWeightedList.length > 0) {
                     this.currentIndex = (this.currentIndex + 1) % healthyWeightedList.length;
                     chosenServer = healthyWeightedList[this.currentIndex];
                 }
                 break;

            // --- More complex WRR (GCD based - potentially more efficient for large weights) ---
            /*
            case 'WEIGHTED_ROUND_ROBIN_GCD':
                // Requires re-calculating weights if health changes significantly
                while (true) {
                     this.currentIndex = (this.currentIndex + 1) % healthyServers.length;
                     if (this.currentIndex === 0) {
                         this.currentWeight = this.currentWeight - this.gcdWeight;
                         if (this.currentWeight <= 0) {
                             this.currentWeight = this.maxWeight;
                             if (this.currentWeight === 0) // All weights are 0?
                                 return null;
                         }
                     }
                     if (healthyServers[this.currentIndex].weight >= this.currentWeight) {
                         chosenServer = healthyServers[this.currentIndex];
                         break;
                     }
                 }
                 break;
            */

            case 'ROUND_ROBIN':
            default:
                this.currentIndex = (this.currentIndex + 1) % healthyServers.length;
                chosenServer = healthyServers[this.currentIndex];
                break;
        }

         // Should always have a server if healthyServers is not empty
        if (!chosenServer && healthyServers.length > 0) {
            console.warn("Algorithm failed to select a server, falling back to first healthy server.");
            chosenServer = healthyServers[0]; // Fallback
        }

        if (chosenServer) {
            this.incrementConnections(chosenServer.id);
        }

        return chosenServer;
    }

    // --- Connection Tracking (Basic) ---
    incrementConnections(serverId) {
        const server = this.getServerById(serverId);
        if (server) server.activeConnections++;
    }

    decrementConnections(serverId) {
        const server = this.getServerById(serverId);
        // Ensure counter doesn't go below zero
        if (server && server.activeConnections > 0) server.activeConnections--;
    }

    getMetrics() {
        const healthyCount = this.getHealthyServers().length;
        const unhealthyCount = this.servers.length - healthyCount;
        const serverDetails = this.servers.map(s => ({
            id: s.id,
            healthy: s.healthy,
            weight: s.weight,
            activeConnections: s.activeConnections // Note: Very basic count
        }));
        return {
            totalServers: this.servers.length,
            healthyServers: healthyCount,
            unhealthyServers: unhealthyCount,
            loadBalancingAlgorithm: this.algorithm,
            servers: serverDetails
        };
    }

    // --- Enhanced Health Check ---
    async checkSingleServer(server) {
        const options = {
            host: server.host,
            port: server.port,
            path: this.healthCheckConfig.path,
            method: this.healthCheckConfig.method || 'GET',
            timeout: this.healthCheckConfig.timeout,
            // Add agent if needed (e.g., for keep-alive, though less critical for health checks)
        };

        // Determine http or https based on server config (or assume http)
        const protocol = (server.protocol === 'https' ? https : http); // Add 'protocol: https' to server config if needed

        return new Promise((resolve) => {
            const req = protocol.request(options, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    const wasHealthy = server.healthy;
                    const expectedStatus = this.healthCheckConfig.expect?.statusCode ?? 200;
                    const expectedBodySubstring = this.healthCheckConfig.expect?.bodyIncludes;

                    let isStatusOk = res.statusCode === expectedStatus;
                    let isBodyOk = !expectedBodySubstring || (body.includes(expectedBodySubstring));

                    server.healthy = isStatusOk && isBodyOk;

                    if (wasHealthy !== server.healthy) {
                         const reason = !isStatusOk ? `Status: ${res.statusCode} (expected ${expectedStatus})` : `Body check failed`;
                        console.log(`Server ${server.id} changed status to ${server.healthy ? 'Healthy' : 'Unhealthy'} (${server.healthy ? 'OK' : reason})`);
                        if (server.healthy) this.recalculateWeightsIfNeeded(); // Recalculate if server becomes healthy
                    }
                    resolve();
                });
            });

             req.on('error', (err) => {
                this.markServerUnhealthy(server, `Error: ${err.code || err.message}`);
                resolve();
            });

            req.on('timeout', () => {
                this.markServerUnhealthy(server, 'Error: Timeout');
                req.destroy(); // Ensure socket is destroyed
                resolve();
            });

            req.end();
        });
    }

     markServerUnhealthy(server, reason) {
         const wasHealthy = server.healthy;
         server.healthy = false;
         if (wasHealthy !== server.healthy) {
             console.log(`Server ${server.id} changed status to Unhealthy (${reason})`);
             // Optional: Recalculate weights immediately when a server goes unhealthy
             // this.recalculateWeightsIfNeeded();
         }
     }


    recalculateWeightsIfNeeded() {
         if (this.algorithm.includes('WEIGHTED')) {
             // console.log('Recalculating weights due to health change...');
             this.calculateWeights();
             this.buildWeightedList(); // Rebuild the simple list too
         }
    }

    // --- Health Check Lifecycle (mostly unchanged) ---
     startHealthChecks() { /* ... unchanged ... */
         if (this.healthCheckIntervalId) clearInterval(this.healthCheckIntervalId);
         console.log(`[${process.pid}] Starting health checks every ${this.healthCheckConfig.interval / 1000}s...`);
         this.healthCheckIntervalId = setInterval(() => this.checkHealth(), this.healthCheckConfig.interval);
         this.checkHealth(); // Initial check
     }
     stopHealthChecks() { /* ... unchanged ... */
         if (this.healthCheckIntervalId) {
             console.log(`[${process.pid}] Stopping health checks...`);
             clearInterval(this.healthCheckIntervalId);
             this.healthCheckIntervalId = null;
         }
     }
     async checkHealth() { /* ... unchanged ... */
         // console.log(`[${process.pid}] Performing health checks...`);
         const checks = this.servers.map(server => this.checkSingleServer(server));
         await Promise.all(checks);
         // Recalculate weights *after* all checks are done for a cycle
         this.recalculateWeightsIfNeeded();
     }

    // --- Dynamic Update (Basic) ---
    updateServers(newServersConfig) {
        console.log(`[${process.pid}] Received request to update server pool...`);
        this.stopHealthChecks();

        const existingServers = new Map(this.servers.map(s => [s.id, s]));
        this.servers = newServersConfig.map((sConfig) => {
            const id = `${sConfig.host}:${sConfig.port}`;
            const existing = existingServers.get(id);
            return {
                ...sConfig,
                id: id,
                healthy: existing ? existing.healthy : true, // Preserve health status if server existed
                weight: sConfig.weight ?? 1,
                currentWeight: existing ? existing.currentWeight : 0, // Preserve state? Or reset? Resetting is simpler.
                activeConnections: existing ? existing.activeConnections : 0, // Preserve? Reset? Reset is safer.
            };
        });

        this.currentIndex = -1; // Reset round-robin index
        this.recalculateWeightsIfNeeded(); // Use the new weights/servers

        console.log(`[${process.pid}] Server pool updated. New server count: ${this.servers.length}`);
        if (this.healthCheckConfig.enabled) {
            this.startHealthChecks(); // Restart health checks with potentially new list/configs
        }
    }
}

module.exports = ServerPool;