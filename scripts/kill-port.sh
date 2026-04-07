#!/bin/bash
# Kill process on port 3000 with graceful shutdown
PID=$(lsof -ti:3000 2>/dev/null)
if [ -n "$PID" ]; then
  echo "Sending SIGTERM to PID $PID..."
  kill -15 $PID 2>/dev/null
  # Wait up to 3 seconds for graceful shutdown
  for i in 1 2 3; do
    sleep 1
    if ! kill -0 $PID 2>/dev/null; then
      echo "Process terminated gracefully"
      exit 0
    fi
  done
  # Force kill if still running
  echo "Force killing PID $PID..."
  kill -9 $PID 2>/dev/null
fi
echo "Port 3000 freed"
