# Shopify Webhook Integration Guide

This guide explains how to set up Shopify abandoned cart webhooks to automatically create leads in VoMindAI.

## Overview

The endpoint `/shopify/webhook` accepts Shopify webhook notifications and:
1. **Verifies HMAC signature** using your Shopify webhook secret
2. **Extracts customer & cart data** from the webhook payload
3. **Creates a lead record** in the database with cart metadata
4. **Triggers outbound calls** (optional) to follow up on abandoned carts

## Configuration

### 1. Add Environment Variables

Add these to your `.env` file:

```env
# Shopify Webhook Configuration
SHOPIFY_WEBHOOK_SECRET=your_shopify_webhook_secret_here
```

**Get your Webhook Secret:**
- Go to your Shopify Admin → Apps and integrations → Webhooks
- Create a new webhook subscription
- Shopify will provide you the secret when you configure the endpoint

### 2. Configure Shopify Webhook

In your **Shopify Admin**:

1. Navigate to **Apps and integrations** → **Webhooks**
2. Click **Create webhook**
3. Fill in the details:
   - **Topic**: Select one or more of:
     - `Cart/create` - New cart created
     - `Cart/update` - Cart updated (abandoned)
     - `Checkout/abandon` - Checkout abandoned *(recommended)*
     - `Customer/create` - New customer
   - **URL**: `https://yourdomain.com/shopify/webhook` (or ngrok URL for testing)
   - **API version**: Latest available
4. Click **Save**
5. Copy the **Webhook secret** provided by Shopify
6. Add it to your `.env` file as `SHOPIFY_WEBHOOK_SECRET`

## API Endpoint

### POST /shopify/webhook

**Authentication**: HMAC signature verification (automatic)

**Webhook Topic**: Any of these trigger lead creation:
- `cart/create`
- `cart/update`
- `checkout/abandon`
- `customer/create`

**Payload Structure** (Example Abandoned Cart):
```json
{
  "id": 12345678,
  "email": "customer@example.com",
  "token": "abc123def456",
  "customer": {
    "id": 987654321,
    "first_name": "John",
    "last_name": "Doe",
    "email": "customer@example.com",
    "phone": "+1-555-555-5555",
    "company": "ACME Corp"
  },
  "line_items": [
    {
      "id": 11111,
      "title": "Awesome Product",
      "quantity": 2,
      "price": "29.99",
      "sku": "PROD-001"
    }
  ],
  "subtotal_price": "59.98",
  "total_price": "65.98"
}
```

**Response**:
```json
{
  "success": true,
  "message": "Lead created successfully from Shopify webhook",
  "leadId": 42,
  "email": "customer@example.com"
}
```

## What Gets Stored

When a webhook is received, a lead is created with:

| Field | Source | Example |
|-------|--------|---------|
| `name` | customer.first_name + customer.last_name | John Doe |
| `email` | customer.email | customer@example.com |
| `phone` | customer.phone (validated) | +15555555555 |
| `company` | customer.company | ACME Corp |
| `lead_source` | hardcoded | shopify |
| `lead_status` | hardcoded | new |
| `lead_priority` | cart value | high (for abandoned carts) |
| `metadata` | cart details JSON | see below |

**Metadata Object**:
```json
{
  "shopify_cart_token": "abc123def456",
  "shopify_customer_id": 987654321,
  "cart_total": "65.98",
  "cart_items_count": 1,
  "cart_items": [
    {
      "title": "Awesome Product",
      "quantity": 2,
      "price": "29.99",
      "sku": "PROD-001"
    }
  ],
  "cart_url": "https://example.myshopify.com/cart/abc123",
  "abandoned_at": "2025-11-26T10:30:00.000Z"
}
```

## Testing Locally

### Using ngrok for tunneling

If you're developing locally, expose your server to the internet:

```bash
# In another terminal, run ngrok
ngrok http 3000

# Copy the HTTPS URL (e.g., https://abc123.ngrok.io)
# Use this URL when configuring the Shopify webhook
```

### Test with curl

Generate a valid HMAC signature and send a test webhook:

```bash
#!/bin/bash

# Configuration
SECRET="your_shopify_webhook_secret"
WEBHOOK_URL="https://yourdomain.com/shopify/webhook"
# or for local testing:
# WEBHOOK_URL="http://localhost:3000/shopify/webhook"

# Create a test payload
PAYLOAD='{"id":12345,"email":"test@example.com","customer":{"id":999,"first_name":"Test","last_name":"User","email":"test@example.com","phone":"+15551234567"},"line_items":[{"title":"Test Product","quantity":1,"price":"99.99"}],"subtotal_price":"99.99","total_price":"99.99"}'

# Calculate HMAC
HMAC=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" -binary | base64)

# Send webhook
curl -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Hmac-SHA256: $HMAC" \
  -H "X-Shopify-Topic: cart/update" \
  -d "$PAYLOAD"
```

Save this as `test-shopify-webhook.sh`, make it executable, and run:

```bash
chmod +x test-shopify-webhook.sh
./test-shopify-webhook.sh
```

### Expected Response

```json
{
  "success": true,
  "message": "Lead created successfully from Shopify webhook",
  "leadId": 1,
  "email": "test@example.com"
}
```

Check your database to confirm the lead was created:

```bash
curl -s http://localhost:3000/api/leads | jq '.data[] | select(.lead_source=="shopify")'
```

## Error Handling

| Error | Cause | Resolution |
|-------|-------|-----------|
| `401 Invalid HMAC signature` | Wrong secret or tampered payload | Verify `SHOPIFY_WEBHOOK_SECRET` in `.env` matches Shopify |
| `503 Database not configured` | Supabase not initialized | Check `SUPABASE_URL` and keys in `.env` |
| `200 Webhook received, no lead data` | Missing email in payload | Ensure customer email is populated in Shopify |

## Workflow: Lead to Call

Once a lead is created from Shopify:

1. **Optional**: Automatically schedule an outbound call to the customer:

```bash
curl -X POST http://localhost:3000/api/queue/schedule-call \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+15551234567",
    "message": "Hi! We noticed you had items in your cart. Can we help?",
    "lead_id": 1,
    "priority": "high",
    "speakFirst": true,
    "initialMessage": "Hi John, thanks for your interest! Quick question—what brought you to our store today?"
  }'
```

2. **Track the call** and recording via `/api/lead/1/recordings`

## Supported Shopify Topics

- `cart/create` - Customer created a new cart
- `cart/update` - Cart updated (most common for abandoned carts)
- `checkout/abandon` - Checkout was abandoned after 1 hour (recommended)
- `customer/create` - New customer created in Shopify
- `customer/update` - Customer info updated

*Add more topics in the Shopify admin as needed.*

## Security Notes

- **Never commit `SHOPIFY_WEBHOOK_SECRET` to git** — keep it in `.env` only
- The endpoint **always verifies HMAC** before processing
- Invalid signatures are rejected with `401 Unauthorized`
- Webhook endpoint returns `200 OK` on success and soft-errors to prevent Shopify retries

## Troubleshooting

### Webhook not being received?

1. Check firewall/network — Shopify must reach your `PUBLIC_URL`
2. Verify ngrok is running (if local): `ngrok http 3000`
3. Check Shopify Admin → Apps → Webhooks → see "Recent deliveries" tab

### "HMAC verification failed" in logs?

1. Confirm `SHOPIFY_WEBHOOK_SECRET` is correct:
   ```bash
   grep SHOPIFY_WEBHOOK_SECRET .env
   ```
2. Restart your server after changing `.env`:
   ```bash
   pkill -f "node index.js"
   node index.js
   ```

### Lead not created?

1. Check server logs:
   ```bash
   tail -f logs/server.log | grep -i shopify
   ```
2. Verify customer email is present in Shopify cart data
3. Check Supabase leads table for new records:
   ```bash
   curl -s http://localhost:3000/api/leads | jq '.data[] | select(.lead_source=="shopify")'
   ```

## Next Steps

- [Optional] Auto-call abandoned cart customers using `/api/queue/schedule-call`
- [Optional] Set up lead automation to filter high-value carts
- [Optional] Create a dashboard to view Shopify leads and recording outcomes
