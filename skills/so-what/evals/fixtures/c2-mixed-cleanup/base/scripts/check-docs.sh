#!/usr/bin/env bash
set -euo pipefail
grep -rq "TODO" docs && { echo "TODO left in docs"; exit 1; }
exit 0
