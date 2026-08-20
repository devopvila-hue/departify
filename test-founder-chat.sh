#!/bin/bash

# Test Founder Chat - Direct OpenClaw Access
# This script tests the founder chat through the API

set -e

API_URL="https://api.departify.app"
ORG_ID="7a9f4986-23ba-4d47-8018-f92e304c539d"

echo "=== Founder Chat Acceptance Tests ==="
echo ""

# First, we need to get a valid auth token
# The user needs to provide this or we need to authenticate
echo "To test the founder chat, you need to:"
echo "1. Open the portal at https://departify.app"
echo "2. Log in as tres@tres.com"
echo "3. Open browser dev tools and get the auth token from:"
echo "   - Application > Local Storage > supabase.auth.token"
echo "   - Or from the Authorization header in network requests"
echo ""
echo "Then run this script with the token:"
echo "  ./test-founder-chat.sh YOUR_AUTH_TOKEN"
echo ""

if [ -z "$1" ]; then
  echo "No auth token provided. Exiting."
  exit 1
fi

AUTH_TOKEN="$1"

echo "Testing founder chat with token: ${AUTH_TOKEN:0:20}..."
echo ""

# Test 1: pwd
echo "=== Test 1: pwd ==="
curl -s -X POST "$API_URL/api/customer-zero/$ORG_ID/command-center/message" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "ejecuta pwd y dime el directorio"}' | jq -r '.reply // .error // "No response"'
echo ""

# Test 2: list skills
echo "=== Test 2: list skills ==="
curl -s -X POST "$API_URL/api/customer-zero/$ORG_ID/command-center/message" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "lista las skills instaladas"}' | jq -r '.reply // .error // "No response"'
echo ""

# Test 3: create file
echo "=== Test 3: create file ==="
curl -s -X POST "$API_URL/api/customer-zero/$ORG_ID/command-center/message" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "crea un archivo founder-test.txt con el texto DEPARTIFY-FOUNDER-OK"}' | jq -r '.reply // .error // "No response"'
echo ""

# Test 4: read file
echo "=== Test 4: read file ==="
curl -s -X POST "$API_URL/api/customer-zero/$ORG_ID/command-center/message" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "lee founder-test.txt"}' | jq -r '.reply // .error // "No response"'
echo ""

# Test 5: delete file
echo "=== Test 5: delete file ==="
curl -s -X POST "$API_URL/api/customer-zero/$ORG_ID/command-center/message" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "elimina founder-test.txt"}' | jq -r '.reply // .error // "No response"'
echo ""

echo "=== Tests Complete ==="
