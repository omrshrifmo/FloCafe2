#!/usr/bin/env bash
set -euo pipefail

# FloCafe Checkpoint Restore Utility
# Restores the verified checkpoint database with safety auto-backup.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CHECKPOINT_DIR="${REPO_ROOT}/backups/checkpoints/checkpoint-4.0.2"
CHECKPOINT_DB="${CHECKPOINT_DIR}/flo.db"
CHECKPOINT_CONFIG_DB="${CHECKPOINT_DIR}/config_flo_desktop/flo.db"

TARGET_DB="${REPO_ROOT}/flo.db"
CONFIG_DB="${HOME}/.config/flo-desktop/flo.db"

echo "=== FloCafe Checkpoint Restore ==="

if [ ! -f "${CHECKPOINT_DB}" ]; then
  echo "Error: Checkpoint database not found at ${CHECKPOINT_DB}" >&2
  exit 1
fi

# Verify backup integrity before doing anything
echo "Verifying checkpoint database integrity..."
if command -v sqlite3 >/dev/null 2>&1; then
  INTEGRITY=$(sqlite3 "${CHECKPOINT_DB}" "PRAGMA integrity_check;")
  if [ "${INTEGRITY}" != "ok" ]; then
    echo "Error: Checkpoint integrity check failed: ${INTEGRITY}" >&2
    exit 1
  fi
  echo "Checkpoint integrity: OK"
fi

TIMESTAMP=$(date +"%Y%m%d%H%M%S")

# Safety copy of current working DB if present
if [ -f "${TARGET_DB}" ]; then
  SAFETY_TARGET="${TARGET_DB}.pre-restore-${TIMESTAMP}"
  echo "Creating safety backup of current workspace db -> ${SAFETY_TARGET}"
  cp -p "${TARGET_DB}" "${SAFETY_TARGET}"
fi

# Safety copy of config DB if present
if [ -f "${CONFIG_DB}" ]; then
  SAFETY_CONFIG="${CONFIG_DB}.pre-restore-${TIMESTAMP}"
  echo "Creating safety backup of current desktop config db -> ${SAFETY_CONFIG}"
  cp -p "${CONFIG_DB}" "${SAFETY_CONFIG}"
fi

# Restore target DB
echo "Restoring workspace database -> ${TARGET_DB}..."
cp -p "${CHECKPOINT_DB}" "${TARGET_DB}"

# Restore desktop config DB if directory or file exists
if [ -d "${HOME}/.config/flo-desktop" ]; then
  if [ -f "${CHECKPOINT_CONFIG_DB}" ]; then
    echo "Restoring desktop config database -> ${CONFIG_DB}..."
    cp -p "${CHECKPOINT_CONFIG_DB}" "${CONFIG_DB}"
  else
    echo "Copying checkpoint database to desktop config -> ${CONFIG_DB}..."
    cp -p "${CHECKPOINT_DB}" "${CONFIG_DB}"
  fi
fi

echo "=== Checkpoint restore completed successfully! ==="
