# Shopify Webhook Testing - curl Examples

## Quick Start

### 1. Generate a test HMAC and send webhook

```bash
# Set your secret
SECRET="your_shopify_webhook_secret"
WEBHOOK_URL="http://localhost:3000/shopify/webhook"

# Create payload (save as payload.json)
cat > payload.json << 'EOF'
{
  "id": 12345678,
  "email": "customer@example.com",
  "token": "abc123",
  "customer": {
    "id": 9876543,
    "first_name": "John",
    "last_name": "Doe",
    "email": "customer@example.com",
    "phone": "+1-555-123-4567"
  },
  "line_items": [
    {
      "title": "Awesome Product",
      "quantity": 2,
      "price": "49.99"
    }
  ],
  "subtotal_price": "99.98",
  "total_price": "99.98"
}
EOF

# Generate HMAC
HMAC=$(cat payload.json | openssl dgst -sha256 -hmac "$SECRET" -binary | base64)

# Send webhook
curl -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Hmac-SHA256: $HMAC" \
  -H "X-Shopify-Topic: cart/update" \
  -d @payload.json | jq
```

### 2. Using the test script (easier)

```bash
# Set your secret
export SHOPIFY_WEBHOOK_SECRET="your_shopify_webhook_secret"

# Run the test script
./test-shopify-webhook.sh

# Or test against a remote URL
./test-shopify-webhook.sh --url https://yourdomain.com/shopify/webhook --topic checkout/abandon
```

### 3. Check if lead was created

```bash
# View all Shopify leads
curl -s http://localhost:3000/api/leads | jq '.data[] | select(.lead_source=="shopify")'

# View specific lead by ID
curl -s http://localhost:3000/api/leads/1 | jq
```

## Shopify Webhook Topics

### Recommended: Checkout Abandoned

**Topic**: `checkout/abandon`

**Triggered**: When a checkout is abandoned for 1+ hour

```bash
HMAC=$(cat payload.json | openssl dgst -sha256 -hmac "$SECRET" -binary | base64)
curl -X POST "http://localhost:3000/shopify/webhook" \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Hmac-SHA256: $HMAC" \
  -H "X-Shopify-Topic: checkout/abandon" \
  -d @payload.json
```

### Cart Updated

**Topic**: `cart/update`

**Triggered**: Each time cart is modified

```bash
curl -X POST "http://localhost:3000/shopify/webhook" \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Hmac-SHA256: $HMAC" \
  -H "X-Shopify-Topic: cart/update" \
  -d @payload.json
```

### Customer Created/Updated

**Topic**: `customer/create` or `customer/update`

**Payload** (different structure):

```bash
cat > customer_payload.json << 'EOF'
{
  "id": 9876543,
  "first_name": "Jane",
  "last_name": "Smith",
  "email": "jane@example.com",
  "phone": "+1-555-987-6543",
  "orders_count": 3,
  "total_spent": "299.50"
}
EOF

HMAC=$(cat customer_payload.json | openssl dgst -sha256 -hmac "$SECRET" -binary | base64)
curl -X POST "http://localhost:3000/shopify/webhook" \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Hmac-SHA256: $HMAC" \
  -H "X-Shopify-Topic: customer/create" \
  -d @customer_payload.json
```

## Response Examples

### Success (201 Created)

```json
{
  "success": true,
  "message": "Lead created successfully from Shopify webhook",
  "leadId": 42,
  "email": "customer@example.com"
}
```

### HMAC Verification Failed (401)

```json
{
  "success": false,
  "error": "Invalid HMAC signature"
}
```

### No Email Found (200 - soft error)

```json
{
  "success": true,
  "message": "Webhook received, no lead data"
}
```

## Debugging

### 1. Check server logs

```bash
# While server is running, watch logs
tail -f server.log | grep -i shopify

# Should see:
# ✅ Shopify webhook verified - Topic: cart/update
# ✅ Lead created from Shopify webhook - ID: 42, Email: customer@example.com
```

### 2. Verify HMAC manually

```bash
SECRET="test_secret"
PAYLOAD='{"email":"test@example.com"}'
EXPECTED_HMAC=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" -binary | base64)
echo "Expected: $EXPECTED_HMAC"

# This is what you should send in X-Shopify-Hmac-SHA256 header
```

### 3. Test with jq to parse responses

```bash
# Pretty-print response
curl -s http://localhost:3000/api/leads | jq '.'

# Filter for Shopify leads only
curl -s http://localhost:3000/api/leads | jq '.data[] | select(.lead_source=="shopify")'

# Check metadata
curl -s http://localhost:3000/api/leads/42 | jq '.data.metadata'
```

## Integration with Call Queue

Once a lead is created from Shopify, automatically call them:

```bash
curl -X POST http://localhost:3000/api/queue/schedule-call \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+15551234567",
    "message": "Hi! We noticed you had items in your cart. Can we help?",
    "lead_id": 42,
    "priority": "high",
    "speakFirst": true,
    "initialMessage": "Hi John, thanks for your interest!"
  }' | jq
```

## Full Workflow Example

```bash
#!/bin/bash

# 1. Set environment
SECRET="shopify_webhook_secret"
BASE_URL="http://localhost:3000"
CUSTOMER_PHONE="+15551234567"

# 2. Send webhook
HMAC=$(cat payload.json | openssl dgst -sha256 -hmac "$SECRET" -binary | base64)
WEBHOOK_RESPONSE=$(curl -s -X POST "$BASE_URL/shopify/webhook" \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Hmac-SHA256: $HMAC" \
  -H "X-Shopify-Topic: checkout/abandon" \
  -d @payload.json)

# 3. Extract lead ID
LEAD_ID=$(echo "$WEBHOOK_RESPONSE" | jq -r '.leadId')
echo "Created lead: $LEAD_ID"

# 4. Schedule call
curl -X POST "$BASE_URL/api/queue/schedule-call" \
  -H "Content-Type: application/json" \
  -d "{
    \"to\": \"$CUSTOMER_PHONE\",
    \"message\": \"We noticed you abandoned your cart!\",
    \"lead_id\": $LEAD_ID,
    \"priority\": \"high\"
  }"

echo "Call scheduled for lead $LEAD_ID"
```
