#!/bin/bash
# Shortcut: the real setup is scripts/setup.sh (see SETUP.md). Same options.
exec "$(cd "$(dirname "$0")" && pwd)/scripts/setup.sh" "$@"
