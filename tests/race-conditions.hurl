# ===================================================================
# ENHANCED RACE CONDITION TESTS
# Multiple strategies for reliable race condition detection
# ===================================================================

# Setup: Create plan for race condition testing
POST {{host}}/api/travel-plans
Content-Type: application/json
{
  "title": "Race Condition Test Plan",
  "description": "Testing concurrent operations",
  "budget": 1000.00
}

HTTP 201
[Captures]
race_plan_id: jsonpath "$.id"
initial_version: jsonpath "$.version"

# Strategy 1: Rapid Sequential Updates (simulates race condition)
# Update 1: Should succeed
PUT {{host}}/api/travel-plans/{{race_plan_id}}
Content-Type: application/json
{
  "title": "First Update",
  "budget": 1100.00,
  "version": {{initial_version}}
}

HTTP 200
[Captures]
updated_version_1: jsonpath "$.version"

[Asserts]
jsonpath "$.version" == 2
jsonpath "$.title" == "First Update"

# Update 2: Using old version (should fail with 409)
PUT {{host}}/api/travel-plans/{{race_plan_id}}
Content-Type: application/json
{
  "title": "Second Update (Should Fail)",
  "budget": 1200.00,
  "version": {{initial_version}}
}

HTTP 409
[Asserts]
jsonpath "$.error" contains "Conflict"
jsonpath "$.current_version" == 2

# Strategy 2: Stress Test Location Auto-Ordering
# Rapidly create multiple locations to test concurrent insertion
POST {{host}}/api/travel-plans/{{race_plan_id}}/locations
Content-Type: application/json
{
  "name": "Location A",
  "budget": 100.00
}

HTTP 201
[Captures]
location_a_order: jsonpath "$.visit_order"

POST {{host}}/api/travel-plans/{{race_plan_id}}/locations
Content-Type: application/json
{
  "name": "Location B", 
  "budget": 150.00
}

HTTP 201
[Captures]
location_b_order: jsonpath "$.visit_order"

POST {{host}}/api/travel-plans/{{race_plan_id}}/locations
Content-Type: application/json
{
  "name": "Location C",
  "budget": 200.00
}

HTTP 201
[Captures]
location_c_order: jsonpath "$.visit_order"

# Verify proper ordering (should be 1, 2, 3)
GET {{host}}/api/travel-plans/{{race_plan_id}}

HTTP 200
[Asserts]
jsonpath "$.locations" count == 3
jsonpath "$.locations[0].visit_order" == 1
jsonpath "$.locations[1].visit_order" == 2
jsonpath "$.locations[2].visit_order" == 3

# Strategy 3: Cascade Delete Race Condition Test
DELETE {{host}}/api/travel-plans/{{race_plan_id}}

HTTP 204

# Verify complete deletion (locations should be gone too)
GET {{host}}/api/travel-plans/{{race_plan_id}}

HTTP 404