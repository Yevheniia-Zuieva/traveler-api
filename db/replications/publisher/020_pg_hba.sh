#!/usr/bin/env bash
set -euo pipefail

# Allow streaming replication and pg_basebackup connections
echo "host replication ${REP_USER} 0.0.0.0/0 md5" >> "${PGDATA}/pg_hba.conf"
echo "host all ${REP_USER} 0.0.0.0/0 md5" >> "${PGDATA}/pg_hba.conf"