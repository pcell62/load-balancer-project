// loadBalancer.js
const cluster = require('cluster');
const os = require('os');
const config = require('./config');
// Optional: const fs = require('fs'); // For watching config files

const numCPUs = config.numWorkers || os.cpus().length;

if (cluster.isMaster) {
    console.log(`Master ${process.pid} is running`);
    console.log(`Forking ${numCPUs} workers...`);

    const workers = new Map();

    // Fork workers.
    for (let i = 0; i < numCPUs; i++) {
        forkWorker(i);
    }

    // --- Worker Management ---
    function forkWorker(id) {
        const worker = cluster.fork({ WORKER_ID: id }); // Pass ID if needed
        workers.set(worker.process.pid, worker);
        console.log(`Worker ${worker.process.pid} started.`);

        // Optional: Assign specific tasks (like metrics server) to one worker
        if (id === 0 && config.metrics.enabled) {
             // Send message to worker 0 telling it to start the metrics server
             // Use timeout to ensure worker is ready to receive messages
            setTimeout(() => {
                worker.send({ type: 'startMetrics' });
            }, 1000); // Adjust delay if needed
        }
    }

    cluster.on('exit', (worker, code, signal) => {
        const pid = worker.process.pid;
        console.log(`Worker ${pid} died (code: ${code}, signal: ${signal}). Forking a new one...`);
        workers.delete(pid);
        // Don't overwhelm system if workers keep crashing rapidly
        setTimeout(() => forkWorker(workers.size), 1000); // Restart after 1 second delay
    });

    // --- Graceful Shutdown for Master ---
    const shutdownMaster = (signal) => {
        console.log(`\nMaster ${process.pid} received ${signal}. Shutting down workers...`);
        // Send shutdown message to all workers
        workers.forEach(worker => {
             try {
                 worker.send('shutdown');
             } catch (err) {
                 console.error(`Master: Error sending shutdown to worker ${worker.process.pid}`, err);
             }
        });

        // Allow time for workers to shut down
        setTimeout(() => {
            console.log("Master shutting down.");
            process.exit(0);
        }, 5000); // Give workers 5 seconds
    };

    process.on('SIGTERM', () => shutdownMaster('SIGTERM'));
    process.on('SIGINT', () => shutdownMaster('SIGINT'));

    // --- Dynamic Config Reload (Basic Example using SIGHUP) ---
    /*
    process.on(config.dynamicConfigReloadSignal, () => {
        console.log(`Master ${process.pid} received ${config.dynamicConfigReloadSignal}. Reloading configuration...`);
        try {
            // Re-read or fetch your configuration here
            // For simplicity, let's assume we re-read config.js (Node caches modules, so this needs care)
            // A better approach is reading a JSON file or using a dedicated config management system.

            // Example: Reading a theoretical 'servers.json'
            // const newServersConfig = JSON.parse(fs.readFileSync('servers.json', 'utf8'));
            // const newConfig = { servers: newServersConfig }; // Only update parts you want workers to know

            // Invalidate cache for config.js if needed (use with caution)
            delete require.cache[require.resolve('./config')];
            const reloadedConfigModule = require('./config'); // Re-require

            console.log("Broadcasting config update to workers...");
            workers.forEach(worker => {
                try {
                    // Send only the relevant parts of the config to workers
                    worker.send({ type: 'updateConfig', config: { servers: reloadedConfigModule.servers } });
                } catch (err) {
                    console.error(`Master: Error sending config update to worker ${worker.process.pid}`, err);
                }
            });
            console.log("Config update broadcast complete.");

        } catch (err) {
            console.error("Error reloading configuration:", err);
        }
    });
    console.log(`Master: Send 'kill -${config.dynamicConfigReloadSignal} ${process.pid}' to reload config.`);
    */

} else {
    // --- Worker Process ---
    console.log(`Worker ${process.pid} starting... (ID: ${process.env.WORKER_ID})`);
    const workerLogic = require('./worker');

    // Listen for message from master to start metrics server
    process.on('message', (msg) => {
        if (msg && msg.type === 'startMetrics') {
            console.log(`[${process.pid}] Received instruction to start metrics server.`);
            workerLogic.startMetricsServer();
        }
    });

    // Start the main HTTP/HTTPS listeners
    workerLogic.startListening();
}