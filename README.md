# Travel Planner REST API

Travel Planner REST API built with FastAPI, PostgreSQL, and `asyncpg`, fully containerized with Docker and Docker Compose. The system is designed to handle concurrent editing of travel plans using robust ACID transactions, configurable isolation levels, and optimistic locking to prevent data conflicts.

---

## System Overview

The API manages travel itineraries and their associated locations while ensuring strict data integrity under concurrent access. All operations are asynchronous, optimized for low-latency responses, deployable as isolated multi-container services, and covered by automated functional, integration, and performance test suites.

---

## Core Entities

### TravelPlan

```typescript
{
  id: UUID
  title: string
  description?: string
  start_date?: date
  end_date?: date
  budget?: decimal
  currency: string = 'USD'
  is_public: boolean = false
  version: integer = 1 // Optimistic locking
  created_at: timestamp
  updated_at: timestamp
}
```

### Location

```typescript
{
  id: UUID
  travel_plan_id: UUID (FK)
  name: string
  address?: string
  latitude?: decimal
  longitude?: decimal
  visit_order: integer // Auto-incremented sequence
  arrival_date?: timestamp
  departure_date?: timestamp
  budget?: decimal
  notes?: text
  created_at: timestamp
}
```

---

## Implemented API Endpoints

### Travel Plans

* `GET /api/travel-plans` — Retrieve all travel plans with location counts.
* `POST /api/travel-plans` — Create a new travel plan with input validation.
* `GET /api/travel-plans/{id}` — Get full plan details including sorted locations.
* `PUT /api/travel-plans/{id}` — Update travel plan with optimistic locking version check.
* `DELETE /api/travel-plans/{id}` — Delete travel plan with cascade deletion of locations.

### Locations

* `POST /api/travel-plans/{id}/locations` — Add a location to a plan with automatic ordering.
* `PUT /api/locations/{id}` — Update single location details with parent locking.
* `DELETE /api/locations/{id}` — Remove a location from a travel plan.

### System & Transactions

* `GET /health` — Health check endpoint returning database connectivity, uptime, and system status.
* `GET /api/system/isolation-test` — Verification endpoint designed to test and validate PostgreSQL transaction isolation levels (e.g., `READ COMMITTED`, `REPEATABLE READ`, `SERIALIZABLE`) and verify concurrent read/write behavior under different isolation guarantees.

---

## Containerization & Deployment (Docker)

The application and database are packaged and orchestrated using `Dockerfile` and `docker-compose.yml` following container security and reliability best practices:

- **Multi-Stage Build & Minimal Image:** Built via a multi-stage Dockerfile (target: runtime) with `.dockerignore` exclusions to minimize image footprint.
- **Security Hardening:** The API container (`travel_planner_api`) runs as a non-root user (`1000:1000`) with `no-new-privileges:true` and a read-only root filesystem backed by tmpfs mounts (`/tmp`, `/app/tmp`).
- **Service Orchestration & Networking:** Dedicated containers for the FastAPI service (`travel_planner_api`) and PostgreSQL database (`travel_planner_db`) communicate over an isolated bridge network (`travel_planner_network`).
- **Persistent Storage:** Named volumes (`postgres_data` and `app_logs`) persist database state and application logs across container restarts.
- **Health Checks & Startup Ordering:** Both services define native healthcheck probes (`pg_isready` for PostgreSQL and `GET /health` for FastAPI), ensuring the API starts only after the database reports `service_healthy`.
- **Resource Limits:** Explicit CPU and memory quotas prevent host resource exhaustion under heavy load (0.5 CPU / 512MB RAM for app; 1.0 CPU / 1GB RAM for postgres).

### Quick Start with Docker Compose

#### Configure Environment Variables

Copy the safe template `.env.example` to `.env` (which is excluded from version control via `.gitignore`) and set your database credentials:

```bash
cp .env.example .env
```

**Key environment variables:**

- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` — Database initialization credentials.
- `DATABASE_URL` — Async PostgreSQL connection string (`postgresql+asyncpg://...`).
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` — Database connection parameters.
- `APP_PORT` — Host port mapped to the FastAPI container (default: 4567).

#### Build and Start Containers

```bash
docker compose up -d --build
```

#### Verify Service Health

Open `http://localhost:4567/health` or query via curl:

```bash
curl http://localhost:4567/health
```

### Container Monitoring & Operations

**Check container states and health status:**

```bash
docker compose ps
```

**Stream real-time API logs:**

```bash
docker compose logs -f app
```

**Monitor live CPU, memory, and I/O consumption:**

```bash
docker stats
```

---

## Concurrency Patterns & Architecture

* **Optimistic Locking:** Implemented on `travel_plans` using the `version` field to detect and reject conflicting writes with `HTTP 409 Conflict`.
* **Parent-Level Versioning:** Location modifications update the parent travel plan's version and timestamp, locking the resource and preventing race conditions.
* **Sequential Location Ordering:** Automatically assigns `visit_order = MAX(visit_order) + 1` within atomic database transactions.
* **Transaction Isolation Verification:** Supports explicit isolation level testing via dedicated system endpoints to evaluate phantom reads, non-repeatable reads, and serialization anomalies.
* **Cascade Deletes:** Foreign key constraints handle the automatic cleanup of child locations upon plan deletion.

## Database Design Requirements

* UUIDs utilized for all primary keys.
* Auto-assign `visit_order = MAX(visit_order) + 1` for newly added locations.
* Efficient indexing on foreign keys and frequently queried fields.
* Check constraints enforcing data validity (latitudes, longitudes, dates, non-negative budgets).
* Foreign key constraints with `ON DELETE CASCADE` for relational integrity.

## Testing & Quality Assurance

### 1. Integration Tests (Hurl)

API functional, schema validation, and concurrent access testing executed via Hurl against the containerized service (`http://localhost:4567`):

```powershell
hurl --test --variables-file tests/variables.properties --variable host=http://localhost:4567 tests/crud.hurl tests/management.hurl tests/validation.hurl tests/race-conditions.hurl
```

The functional test suite (`tests/`) covers:

* `crud.hurl` — End-to-end CRUD lifecycle operations.
* `management.hurl` — Entity relationship cascading and state management.
* `race-conditions.hurl` — Concurrent optimistic locking and version conflict assertions.
* `validation.hurl` — Request payload validation and constraint bounds testing.

### 2. Performance & Load Testing (Grafana k6)

Comprehensive performance analysis using Grafana k6 located under `tests/performance-tests/`, benchmarked across both local and containerized (`http://localhost:4567`) deployments:

**Smoke & CI/CD Tests:**

- `smoke-test.js` — Baseline health and CRUD verification under minimal load (5 VUs).
- `ci-performance-test.js` — Rapid (~1 min) execution verifying critical system SLOs during automated builds.

**Load Profiles:**

  * `crud-load-test.js` & `read-heavy-load-test.js` — Baseline and read-intensive concurrency evaluation (up to 100 VUs).
  * `write-heavy-load-test.js` & `location-management-load-test.js` — High-throughput transactional mutation testing.
  * `realistic-user-journey-test.js` — Weighted user behavior workflow simulations.

* **Stress & Reliability:**

  * `stress-test.js` (up to 600 VUs) & `spike-test.js` (surge up to 2,000 VUs) — Capacity limit, graceful degradation, and automatic recovery testing inside Linux-based containers.
  * `endurance-test.js` (40 min soak test at 100 VUs) — Long-duration stability verification confirming zero memory leaks and steady container resource utilization.
  * `validation-load-test.js` — Edge-case and error-handling overhead validation under load.

**Execute a performance test profile locally or against the Docker container:**

```bash
k6 run tests/performance-tests/smoke-test.js
```

---

## CI/CD Automation (GitHub Actions)

Continuous Integration is fully automated via GitHub Actions workflow (`.github/workflows/performance-tests.yml`):

1. **Environment Provisioning:** Automatically provisions a PostgreSQL 15 service container.
2. **Database Initialization:** Applies `docs/schema.sql` to instantiate the database structure.
3. **Application Bootstrapping:** Launches the FastAPI service instance using Uvicorn.
4. **Automated k6 Performance Verification:** Executes `ci-performance-test.js` against the live service and asserts strict SLA thresholds (`p(95)` read duration < 600ms, write duration < 1200ms, error rate < 5%).