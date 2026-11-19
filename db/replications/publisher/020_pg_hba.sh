#!/usr/bin/env bash
set -euo pipefail
# Р”РѕР·РІРѕР»РёС‚Рё subscriber РїС–РґРєР»СЋС‡Р°С‚РёСЃСЏ РїРѕ РїР°СЂРѕР»СЋ РґРѕ РІСЃС–С… Р±Р°Р· РїС–Рґ РєРѕСЂРёСЃС‚СѓРІР°С‡РµРј repuser
echo "host all repuser 0.0.0.0/0 md5" >> "${PGDATA}/pg_hba.conf"