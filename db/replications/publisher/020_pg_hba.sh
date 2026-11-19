#!/usr/bin/env bash
set -euo pipefail

# Replace default permissive host rule with scram-sha-256 restricted to internal Docker subnets
sed -i '/host all all all/d' "${PGDATA}/pg_hba.conf"

echo "host replication ${REP_USER} 172.16.0.0/12 scram-sha-256" >> "${PGDATA}/pg_hba.conf"
echo "host replication ${REP_USER} 192.168.0.0/16 scram-sha-256" >> "${PGDATA}/pg_hba.conf"
echo "host all all 172.16.0.0/12 scram-sha-256" >> "${PGDATA}/pg_hba.conf"
echo "host all all 192.168.0.0/16 scram-sha-256" >> "${PGDATA}/pg_hba.conf"