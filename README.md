# Travel Planner REST API

Travel Planner REST API built with FastAPI, PostgreSQL, and asyncpg. The system is designed to handle concurrent editing of travel plans using robust ACID transactions and optimistic locking to prevent data conflicts.

---

## System Overview

The API manages travel itineraries and their associated locations while ensuring strict data integrity under concurrent access. All operations are asynchronous and optimized for low-latency responses.

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

### System

* `GET /health` — Health check endpoint returning database connectivity, uptime, and system status.

## Concurrency Patterns & Architecture

* **Optimistic Locking:** Implemented on `travel_plans` using the `version` field to detect and reject conflicting writes with HTTP 409 Conflict.
* **Parent-Level Versioning:** Location modifications update the parent travel plan's version and timestamp, locking the resource and preventing race conditions.
* **Sequential Location Ordering:** Automatically assigns `visit_order = MAX(visit_order) + 1` within atomic database transactions.
* **Transaction Isolation:** All multi-step modifications run within isolated ACID transactions.
* **Cascade Deletes:** Foreign key constraints handle the automatic cleanup of child locations upon plan deletion.

## Database Design Requirements

* UUIDs utilized for all primary keys.
* Auto-assign `visit_order = MAX(visit_order) + 1` for newly added locations.
* Efficient indexing on foreign keys and frequently queried fields.
* Check constraints enforcing data validity (latitudes, longitudes, dates, non-negative budgets).
* Foreign key constraints with `ON DELETE CASCADE` for relational integrity.

## Testing

The project ensures test coverage using the Hurl tool:

```powershell
hurl --test (Get-ChildItem ./tests/*.hurl) --variables-file ./tests/variables.properties
```

The test suite covers:

* CRUD lifecycle operations (`crud.hurl`)
* Cascading and entity management (`management.hurl`)
* Race conditions and concurrent optimistic locking conflicts (`race-conditions.hurl`)
* Input validation and boundary constraints (`validation.hurl`)
