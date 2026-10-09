# Travel Planner REST API

Travel Planner REST API built with FastAPI, PostgreSQL, and asyncpg. The system is designed to handle concurrent editing of travel plans using robust ACID transactions, configurable isolation levels, and optimistic locking to prevent data conflicts.

---

## System Overview

The API manages travel itineraries and their associated locations while ensuring strict data integrity under concurrent access. All operations are asynchronous, optimized for low-latency responses, and covered by automated performance and integration test suites.

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

API functional, schema validation, and concurrent access testing executed via [Hurl](https://hurl.dev/):

```powershell
hurl --test (Get-ChildItem ./tests/*.hurl) --variables-file ./tests/variables.properties
```

The functional test suite (`tests/`) covers:

* `crud.hurl` — End-to-end CRUD lifecycle operations.
* `management.hurl` — Entity relationship cascading and state management.
* `race-conditions.hurl` — Concurrent optimistic locking and version conflict assertions.
* `validation.hurl` — Request payload validation and constraint bounds testing.

### 2. Performance & Load Testing (Grafana k6)

Comprehensive performance analysis using [Grafana k6](https://k6.io/) located under `tests/performance-tests/`:

* **CI/CD Smoke Test:** `ci-performance-test.js` — Rapid (~1 min) execution verifying critical system SLOs during automated builds.
* **Load Profiles:**

  * `crud-load-test.js` & `read-heavy-load-test.js` — Baseline and read-intensive concurrency evaluation.
  * `write-heavy-load-test.js` & `location-management-load-test.js` — High-throughput transactional mutation testing.
  * `realistic-user-journey-test.js` — Weighted user behavior workflow simulations.
* **Stress & Reliability:**

  * `stress-test.js` & `spike-test.js` — Capacity limit and traffic surge resilience testing.
  * `endurance-test.js` — Long-duration soak testing to identify potential resource leaks.
  * `validation-load-test.js` — Edge-case and error-handling overhead validation under load.

Execute a performance test profile locally:

```bash
k6 run tests/performance-tests/ci-performance-test.js
```

## CI/CD Automation (GitHub Actions)

Continuous Integration is fully automated via GitHub Actions workflow (`.github/workflows/performance-tests.yml`):

1. **Environment Provisioning:** Automatically provisions a PostgreSQL 15 service container.
2. **Database Initialization:** Applies `docs/schema.sql` to instantiate the database structure.
3. **Application Bootstrapping:** Launches the FastAPI service instance using Uvicorn.
4. **Automated k6 Performance Verification:** Executes `ci-performance-test.js` against the live service and asserts strict SLA thresholds (`p(95)` read duration < 600ms, write duration < 1200ms, error rate < 5%).
