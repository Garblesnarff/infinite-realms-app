#!/bin/bash
# Simple script to test the Elysia server

echo "Starting Elysia server..."
bun src/index.ts &
SERVER_PID=$!

# Wait for server to start
sleep 3

echo ""
echo "Testing health endpoint..."
curl -s http://localhost:8889/health | jq .

echo ""
echo "Testing metrics endpoint (first 10 lines)..."
curl -s http://localhost:8889/metrics | head -10

echo ""
echo "Testing Swagger UI..."
curl -s http://localhost:8889/swagger | head -5

echo ""
echo "Shutting down server..."
kill $SERVER_PID

echo "Done!"
