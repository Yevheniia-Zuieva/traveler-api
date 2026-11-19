#!/usr/bin/env bash
set -euo pipefail

echo "synchronous_standby_names = 'replica_1'" >> "${PGDATA}/postgresql.auto.conf"
pg_ctl -D "${PGDATA}" -m fast -w reload