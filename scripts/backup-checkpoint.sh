#!/usr/bin/env bash
set -euo pipefail

# FloCafe Checkpoint Backup Utility
# Performs online, consistent SQLite backup of active database.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TAG="${1:-checkpoint-4.0.5}"
CHECKPOINT_DIR="${REPO_ROOT}/backups/checkpoints/${TAG}"
CHECKPOINT_DB="${CHECKPOINT_DIR}/flo.db"
TARGET_DB="${REPO_ROOT}/flo.db"
CONFIG_DB="${HOME}/.config/flo-desktop/flo.db"

mkdir -p "${CHECKPOINT_DIR}"

echo "=== FloCafe Checkpoint Backup [${TAG}] ==="

if [ -f "${TARGET_DB}" ]; then
  echo "Backing up workspace database (${TARGET_DB}) -> ${CHECKPOINT_DB}..."
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "${TARGET_DB}" ".backup '${CHECKPOINT_DB}'"
  else
    cp -p "${TARGET_DB}" "${CHECKPOINT_DB}"
  fi
fi

if [ -f "${CONFIG_DB}" ]; then
  mkdir -p "${CHECKPOINT_DIR}/config_flo_desktop"
  echo "Backing up desktop config database (${CONFIG_DB})..."
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "${CONFIG_DB}" ".backup '${CHECKPOINT_DIR}/config_flo_desktop/flo.db'"
  else
    cp -p "${CONFIG_DB}" "${CHECKPOINT_DIR}/config_flo_desktop/flo.db"
  fi
fi

if command -v sqlite3 >/dev/null 2>&1 && [ -f "${CHECKPOINT_DB}" ]; then
  INTEGRITY=$(sqlite3 "${CHECKPOINT_DB}" "PRAGMA integrity_check;")
  echo "Backup verification: ${INTEGRITY}"
fi

echo "=== Backup completed successfully in ${CHECKPOINT_DIR} ==="
