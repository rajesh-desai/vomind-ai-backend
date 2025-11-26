#!/bin/bash

# Shopify Webhook Test Script
# Generates a valid HMAC signature and sends a test webhook to your VoMindAI instance

set -e

# Color codes for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Default values
WEBHOOK_SECRET="${SHOPIFY_WEBHOOK_SECRET:-.}"
WEBHOOK_URL="http://localhost:3000/shopify/webhook"
WEBHOOK_TOPIC="cart/update"

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --secret)
      WEBHOOK_SECRET="$2"
      shift 2
      ;;
    --url)
      WEBHOOK_URL="$2"
      shift 2
      ;;
    --topic)
      WEBHOOK_TOPIC="$2"
      shift 2
      ;;
    --help)
      echo "Shopify Webhook Test Script"
      echo ""
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --secret SECRET     Shopify webhook secret (default: env SHOPIFY_WEBHOOK_SECRET)"
      echo "  --url URL           Webhook endpoint URL (default: http://localhost:3000/shopify/webhook)"
      echo "  --topic TOPIC       Webhook topic (default: cart/update)"
      echo "  --help              Show this help message"
      echo ""
      echo "Example:"
      echo "  $0 --secret my_secret --url https://example.com/shopify/webhook --topic checkout/abandon"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Validate secret
if [ "$WEBHOOK_SECRET" = "." ]; then
  echo -e "${RED}Error: Shopify webhook secret not provided${NC}"
  echo ""
  echo "Either:"
  echo "  1. Set SHOPIFY_WEBHOOK_SECRET environment variable: export SHOPIFY_WEBHOOK_SECRET=your_secret"
  echo "  2. Pass --secret flag: $0 --secret your_secret"
  exit 1
fi

echo -e "${BLUE}=== Shopify Webhook Test ===${NC}"
echo ""
echo -e "Webhook URL:   ${YELLOW}$WEBHOOK_URL${NC}"
echo -e "Topic:         ${YELLOW}$WEBHOOK_TOPIC${NC}"
echo ""

# Create a realistic abandoned cart test payload
read -r -d '' PAYLOAD << 'EOF' || true
{
  "id": 12345678901234,
  "email": "customer@example.com",
  "token": "abc123def456ghi789",
  "cart_url": "https://example.myshopify.com/cart/abc123def456ghi789",
  "customer": {
    "id": 9876543210987,
    "email": "customer@example.com",
    "first_name": "John",
    "last_name": "Doe",
    "phone": "+1-555-123-4567",
    "company": "Tech Solutions Inc",
    "addresses": [
      {
        "address1": "123 Main St",
        "city": "San Francisco",
        "province": "California",
        "postal_code": "94103",
        "country": "United States",
        "company": "Tech Solutions Inc"
      }
    ]
  },
  "line_items": [
    {
      "id": 111111111111,
      "title": "Premium Widget",
      "quantity": 2,
      "price": "49.99",
      "sku": "WIDGET-PREM-001"
    },
    {
      "id": 222222222222,
      "title": "Deluxe Gadget",
      "quantity": 1,
      "price": "99.99",
      "sku": "GADGET-DLX-001"
    }
  ],
  "subtotal_price": "199.97",
  "total_price": "219.97"
}
EOF

# Calculate HMAC-SHA256 signature
echo -e "${BLUE}Generating HMAC signature...${NC}"
HMAC=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" -binary | base64)

echo -e "Signature: ${YELLOW}${HMAC:0:20}...${NC}"
echo ""

# Send the webhook
echo -e "${BLUE}Sending webhook request...${NC}"
echo ""

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Hmac-SHA256: $HMAC" \
  -H "X-Shopify-Topic: $WEBHOOK_TOPIC" \
  -H "X-Shopify-Shop-Id: 123456789012" \
  -H "X-Shopify-API-Version: 2024-10" \
  -d "$PAYLOAD")

# Parse HTTP status code (last line)
HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | head -n -1)

echo "HTTP Status: $HTTP_CODE"
echo ""
echo "Response:"
echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
echo ""

# Check result
if [ "$HTTP_CODE" = "201" ] || [ "$HTTP_CODE" = "200" ]; then
  echo -e "${GREEN}✓ Webhook accepted!${NC}"
  
  # Try to extract lead ID from response
  LEAD_ID=$(echo "$BODY" | jq -r '.leadId // empty' 2>/dev/null)
  if [ -n "$LEAD_ID" ]; then
    echo ""
    echo -e "${GREEN}New lead created:${NC}"
    echo "  Lead ID: $LEAD_ID"
    echo "  Email: customer@example.com"
    echo ""
    echo "View the lead:"
    echo "  curl http://localhost:3000/api/leads/$LEAD_ID | jq"
  fi
else
  echo -e "${RED}✗ Webhook failed (HTTP $HTTP_CODE)${NC}"
  exit 1
fi

echo ""
echo -e "${BLUE}Test complete!${NC}"
