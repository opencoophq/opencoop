# OpenCoop External API — Ecopower Integration

## Overview

OpenCoop provides an external API that allows Ecopower (Bronsgroen) to query any cooperative on the platform for shareholder data and Ecopower client status. Each cooperative that enables the Ecopower integration generates its own API key, giving Ecopower access to that cooperative's shareholders.

This means Ecopower can use a single integration to check shareholder status across all cooperatives on OpenCoop — each with their own API key.

**Base URL:** `https://opencoop.be/api/external`

## How It Works

1. A cooperative enables the Ecopower integration in their OpenCoop admin settings
2. The coop admin generates an API key and shares it with Ecopower
3. Ecopower uses that key to query the cooperative's shareholders and sync Ecopower client status
4. The cooperative can optionally configure a minimum share threshold — shareholders marked as Ecopower clients cannot sell below that threshold

## Authentication

All requests require a Bearer token in the `Authorization` header:

```
Authorization: Bearer <api-key>
```

Each API key is scoped to one cooperative. To query multiple cooperatives, use the API key provided by each coop. Regenerating a key invalidates the previous one immediately.

## Rate Limiting

- **100 requests per 60 seconds** per cooperative
- Exceeding the limit returns `429 Too Many Requests`

## Endpoints

### 1. Query Shareholders

Look up shareholders by email address and retrieve their share portfolio.

```
POST /shareholders/query
```

**Request body:**

```json
{
  "shareholders": [
    { "email": "jan.peeters@example.com" },
    { "email": "maria.janssens@example.com" },
    { "email": "unknown@example.com" }
  ]
}
```

- Maximum **500 emails** per request

**Response:**

```json
{
  "results": [
    {
      "email": "jan.peeters@example.com",
      "found": true,
      "firstName": "Jan",
      "lastName": "Peeters",
      "companyName": null,
      "type": "INDIVIDUAL",
      "totalShares": 10,
      "totalShareValue": 2500,
      "isEcoPowerClient": true,
      "ecoPowerId": "ECO-12345"
    },
    {
      "email": "maria.janssens@example.com",
      "found": true,
      "firstName": "Maria",
      "lastName": "Janssens",
      "companyName": null,
      "type": "INDIVIDUAL",
      "totalShares": 4,
      "totalShareValue": 1000,
      "isEcoPowerClient": false,
      "ecoPowerId": null
    },
    {
      "email": "unknown@example.com",
      "found": false
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `email` | string | The queried email address |
| `found` | boolean | Whether a shareholder with this email exists |
| `firstName` | string | First name (only if found) |
| `lastName` | string | Last name (only if found) |
| `companyName` | string \| null | Company name (for COMPANY type shareholders) |
| `type` | string | `INDIVIDUAL`, `COMPANY`, or `MINOR` |
| `totalShares` | number | Net vested shares (buys minus sells) |
| `totalShareValue` | number | Total value in EUR |
| `isEcoPowerClient` | boolean | Whether marked as Ecopower client |
| `ecoPowerId` | string \| null | Ecopower customer ID |

### 2. Update Ecopower Status

Batch update which shareholders are Ecopower clients.

```
PATCH /shareholders/ecopower
```

**Request body:**

```json
{
  "updates": [
    {
      "email": "jan.peeters@example.com",
      "isEcoPowerClient": true,
      "ecoPowerId": "ECO-12345"
    },
    {
      "email": "maria.janssens@example.com",
      "isEcoPowerClient": false
    }
  ]
}
```

- Maximum **500 updates** per request
- `ecoPowerId` is optional

**Response:**

```json
{
  "results": [
    { "email": "jan.peeters@example.com", "success": true },
    { "email": "maria.janssens@example.com", "success": true }
  ]
}
```

If a shareholder is not found:

```json
{ "email": "unknown@example.com", "success": false, "error": "not found" }
```

## Error Responses

| Status | Meaning |
|--------|---------|
| `401 Unauthorized` | Missing, invalid, or revoked API key |
| `400 Bad Request` | Invalid request body (check `message` field) |
| `429 Too Many Requests` | Rate limit exceeded — wait and retry |

Error body format:

```json
{
  "statusCode": 401,
  "message": "Invalid API key"
}
```

## Example (cURL)

```bash
# Query shareholders for a specific cooperative
curl -X POST https://opencoop.be/api/external/shareholders/query \
  -H "Authorization: Bearer COOP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "shareholders": [
      { "email": "jan.peeters@example.com" }
    ]
  }'

# Update Ecopower status for a specific cooperative
curl -X PATCH https://opencoop.be/api/external/shareholders/ecopower \
  -H "Authorization: Bearer COOP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "updates": [
      { "email": "jan.peeters@example.com", "isEcoPowerClient": true, "ecoPowerId": "ECO-12345" }
    ]
  }'
```

## Threshold Enforcement

When a cooperative configures an Ecopower minimum threshold (in their admin settings), shareholders marked as Ecopower clients cannot sell shares below that threshold. The threshold can be configured as:

- **Euro amount** — minimum portfolio value in EUR
- **Share count** — minimum number of shares

This is enforced automatically on share sale and transfer operations within OpenCoop. The external API does not enforce thresholds — it only reads and writes the `isEcoPowerClient` and `ecoPowerId` fields.
