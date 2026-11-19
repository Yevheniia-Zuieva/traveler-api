#!/usr/bin/env bash
set -euo pipefail

echo "Waiting for publisher to be ready..."
until pg_isready -h postgres -p 5432 -U repuser -d travel_planner_db; do
  echo "Publisher not ready, waiting..."
  sleep 2
done
echo "Publisher is ready!"