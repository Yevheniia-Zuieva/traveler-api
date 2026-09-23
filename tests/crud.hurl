# Test 1: Create travel plan
POST {{host}}/api/travel-plans
Content-Type: application/json
{
  "title": "Test European Journey",
  "description": "Comprehensive testing scenario",
  "start_date": "2025-06-01",
  "end_date": "2025-06-15",
  "budget": 2500.00,
  "currency": "EUR",
  "is_public": true
}

HTTP 201
[Captures]
plan_id: jsonpath "$.id"
plan_version: jsonpath "$.version"

[Asserts]
jsonpath "$.title" == "Test European Journey"
jsonpath "$.description" == "Comprehensive testing scenario"
jsonpath "$.start_date" == "2025-06-01"
jsonpath "$.end_date" == "2025-06-15"
jsonpath "$.budget" == 2500.00
jsonpath "$.currency" == "EUR"
jsonpath "$.is_public" == true
jsonpath "$.version" == 1
jsonpath "$.id" matches "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"

# Test 2: Get created plan
GET {{host}}/api/travel-plans/{{plan_id}}

HTTP 200
[Asserts]
jsonpath "$.id" == "{{plan_id}}"
jsonpath "$.title" == "Test European Journey"
jsonpath "$.version" == 1
jsonpath "$.locations" exists

# Test 3: Update plan (successful)
PUT {{host}}/api/travel-plans/{{plan_id}}
Content-Type: application/json
{
  "title": "Updated European Journey",
  "description": "Modified during testing",
  "budget": 2800.00,
  "version": {{plan_version}}
}

HTTP 200
[Captures]
updated_version: jsonpath "$.version"

[Asserts]
jsonpath "$.title" == "Updated European Journey"
jsonpath "$.description" == "Modified during testing"
jsonpath "$.budget" == 2800.00
jsonpath "$.version" == 2

# Test 4: Update with old version (conflict)
PUT {{host}}/api/travel-plans/{{plan_id}}
Content-Type: application/json
{
  "title": "Should Fail Update",
  "version": {{plan_version}}
}

HTTP 409
[Asserts]
jsonpath "$.error" contains "Conflict"
jsonpath "$.error" contains "modified"

# Test 5: Delete plan
DELETE {{host}}/api/travel-plans/{{plan_id}}

HTTP 204

# Test 6: Verify deletion
GET {{host}}/api/travel-plans/{{plan_id}}

HTTP 404
[Asserts]
jsonpath "$.error" contains "not found"