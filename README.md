# Advanced Node.js HTTP/S Load Balancer

An enhanced HTTP/S load balancer built with Node.js, demonstrating advanced concepts like clustering, HTTPS termination, weighted algorithms, sticky sessions, health checks, and basic metrics. Designed as a robust portfolio piece showcasing network programming and system design principles in Node.js.

## Overview

This project implements a high-availability load balancer that distributes incoming HTTP and HTTPS traffic across multiple backend application servers. It leverages the Node.js `cluster` module for multi-core utilization and resilience, `http-proxy` for efficient request forwarding, and includes several sophisticated features beyond basic round-robin balancing.

## Key Features

*   **Clustering:** Utilizes Node.js `cluster` module to fork worker processes across available CPU cores, improving performance and providing resilience against single-worker crashes.
*   **HTTP & HTTPS Termination:** Supports listening on both HTTP and HTTPS ports. Handles TLS/SSL decryption at the load balancer level, forwarding plain HTTP requests to backend servers.
*   **Multiple Load Balancing Algorithms:**
    *   Round Robin
    *   Random
    *   **Weighted Round Robin (WRR):** Distributes requests proportionally based on assigned server weights.
    *   **Weighted Random:** Selects servers randomly based on assigned weights.
*   **Advanced Health Checks:**
    *   Periodically checks backend server health via configurable HTTP(S) requests.
    *   Configurable path, method, interval, and timeout.
    *   Checks for specific expected **status codes**.
    *   (Optional) Checks if the response **body includes** a specific string.
    *   Automatically removes/re-adds servers from the pool based on health status.
    *   Immediate marking of servers as unhealthy on proxy connection errors.
*   **Sticky Sessions (Cookie-Based):**
    *   Ensures requests from the same client are routed to the same backend server using a configurable HTTP cookie.
    *   Gracefully handles cases where the sticky target server becomes unhealthy.
*   **Backend Server Pool Management:**
    *   Configurable list of backend servers with associated **weights**.
    *   Basic connection counting per backend server.
*   **Dynamic Configuration Reload (Basic):**
    *   Master process listens for a signal (`SIGHUP` by default) to trigger a basic reload of the server list configuration across workers (demonstrates IPC).
*   **Metrics Endpoint:**
    *   Exposes basic operational metrics (request counts, server pool status, uptime, memory usage) on a separate configurable port/endpoint (`/metrics`) via one worker process.
*   **Graceful Shutdown:** Handles `SIGINT` and `SIGTERM` signals for clean shutdown of master and worker processes.
*   **Robust Error Handling:** Provides appropriate HTTP error codes (502 Bad Gateway, 503 Service Unavailable) for various failure scenarios.
*   **Configuration:** Flexible configuration via `config.js` and environment variables (`.env` file support).
*   **(Optional) WebSocket Support:** Includes commented-out code structure for proxying WebSocket connections.

## Architecture

The load balancer runs in a clustered mode:

1.  **Master Process:**
    *   Starts first.
    *   Forks multiple **Worker Processes** (typically one per CPU core).
    *   Monitors worker health and restarts any that crash.
    *   Coordinates graceful shutdown.
    *   Handles signals for tasks like configuration reloading and broadcasts instructions to workers.
    *   Instructs one worker to start the metrics server.
2.  **Worker Processes:**
    *   Each worker runs an independent instance of the HTTP/S server and proxy logic.
    *   Listens on the configured HTTP/S ports (sharing the ports using clustering).
    *   Manages its own `ServerPool` instance (including health checks).
    *   Handles incoming requests: applies sticky session logic, selects a backend via the chosen algorithm, proxies the request, and handles responses/errors.
    *   Communicates with the master via IPC (Inter-Process Communication).

## Prerequisites

*   Node.js (v16 or later recommended)
*   npm
*   OpenSSL (for generating self-signed SSL certificates for HTTPS testing)

## Installation

1.  **Clone the repository:**
    ```bash
    git clone <your-repo-url>
    cd load-balancer-project
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    ```
3.  **Generate Self-Signed SSL Certificates (for HTTPS):**
    *   Create an `ssl` directory if it doesn't exist: `mkdir ssl`
    *   Run the OpenSSL command:
        ```bash
        openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 365 \
          -keyout ssl/key.pem -out ssl/cert.pem \
          -subj "/C=US/ST=State/L=City/O=Org/OU=Dept/CN=localhost"
        ```
    *   *(This creates `key.pem` and `cert.pem` in the `ssl/` directory, valid for 1 year for `localhost`)*

## Configuration

Configure the load balancer primarily through environment variables (using a `.env` file in the project root) or by modifying `config.js`. Environment variables override `config.js` defaults.

**`.env` Example:**

```dotenv
# General
LB_PORT=8080
LB_ENABLE_HTTPS=true
LB_HTTPS_PORT=8443
# LB_SSL_KEY_PATH=./ssl/key.pem # Optional: Override default path
# LB_SSL_CERT_PATH=./ssl/cert.pem # Optional: Override default path
LB_NUM_WORKERS=4 # Optional: Override default (number of CPU cores)

# Load Balancing & Servers (See config.js for server list structure)
LB_ALGORITHM=WEIGHTED_ROUND_ROBIN # Options: ROUND_ROBIN, RANDOM, WEIGHTED_ROUND_ROBIN, WEIGHTED_RANDOM
LB_STICKY_SESSIONS=true
# LB_STICKY_COOKIE_NAME=my_lb_session_cookie # Optional: Override default cookie name

# Health Checks
HC_ENABLED=true
HC_INTERVAL=15000 # Check every 15 seconds
HC_TIMEOUT=7000   # Timeout after 7 seconds
HC_PATH=/health
HC_METHOD=GET
HC_EXPECT_STATUS=200
# HC_EXPECT_BODY="Service OK" # Optional: Check if body contains this string

# Metrics
METRICS_ENABLED=true
METRICS_PORT=9091
# METRICS_ENDPOINT=/lb-metrics # Optional: Override default endpoint

# Proxy Behaviour
PROXY_TIMEOUT=30000 # 30 seconds backend request timeout