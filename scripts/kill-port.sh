#!/bin/bash
# Kill process on port 3000
lsof -ti:3000 | xargs kill -9 2>/dev/null
echo "Port 3000 freed"
