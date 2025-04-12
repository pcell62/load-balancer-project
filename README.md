# Node.js HTTP Load Balancer

A simple yet comprehensive HTTP load balancer built with Node.js, demonstrating core load balancing concepts.

## Features

*   **Backend Server Pool:** Manages a list of configurable backend application servers.
*   **Load Balancing Algorithms:**
    *   Round Robin (default)
    *   Random
*   **Health Checks:** Periodically checks the health of backend servers using a configurable HTTP endpoint (`/health`). Unhealthy servers are automatically removed from rotation and re-added when they recover.
*   **HTTP Proxying:** Uses `http-proxy` to efficiently forward HTTP requests and responses. Includes `X-Forwarded-*` headers.
*   **Configuration:** Easy setup via `config.js` or environment variables (`.env` file supported).
*   **Error Handling:** Gracefully handles scenarios like no available healthy servers (503 Service Unavailable) or backend connection errors (502 Bad Gateway).
*   **Graceful Shutdown:** Handles SIGINT and SIGTERM signals for clean shutdown.
*   **Basic Logging:** Logs request routing, server status changes, and errors to the console.
*   **(Optional) WebSocket Support:** Includes commented-out code for basic WebSocket proxying.

## Prerequisites

*   Node.js (v14 or later recommended)
*   npm

## Installation

1.  Clone the repository:
    ```bash
    git clone <your-repo-url>
    cd load-balancer-project
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```

## Configuration

Configure the load balancer in `config.js` or by setting environment variables (using a `.env` file is recommended for sensitive data).

**Key Configuration Options:**

*   `LB_PORT` / `config.port`: Port the load balancer listens on (default: 8080).
*   `config.servers`: An array of backend server objects (`{ host: '...', port: ... }`).
*   `LB_ALGORITHM` / `config.loadBalancingAlgorithm`: Algorithm to use ('ROUND_ROBIN' or 'RANDOM', default: 'ROUND_ROBIN').
*   `config.healthCheck.enabled`: Enable/disable health checks (default: true).
*   `config.healthCheck.interval`: Interval in milliseconds (default: 10000).
*   `config.healthCheck.timeout`: Timeout for health check request in ms (default: 5000).
*   `config.healthCheck.path`: Path for health check requests (default: '/health').
*   `config.healthCheckStatusCode`: Expected HTTP status code for a healthy server (default: 200).

**Example `.env` file:**

```dotenv
LB_PORT=8080
LB_ALGORITHM=ROUND_ROBIN