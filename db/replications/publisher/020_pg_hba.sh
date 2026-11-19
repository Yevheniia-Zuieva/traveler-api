#!/usr/bin/env bash
set -euo pipefail
# Р”РѕР·РІРѕР»РёС‚Рё РїС–РґРєР»СЋС‡РµРЅРЅСЏ РґР»СЏ РїРѕС‚РѕРєРѕРІРѕС— СЂРµРїР»С–РєР°С†С–С— С‚Р° pg_basebackup
echo "host replication repuser 0.0.0.0/0 md5" >> "${PGDATA}/pg_hba.conf"
echo "host all repuser 0.0.0.0/0 md5" >> "${PGDATA}/pg_hba.conf"