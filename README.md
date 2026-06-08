# FoodSave Backend

Production-oriented Node.js + TypeScript + Express backend for the FoodSave user, partner, and charity portals.

## Stack

- Node.js 20+
- TypeScript strict mode
- Express
- Supabase Auth + PostgreSQL via `@supabase/supabase-js`
- PostgreSQL pool via `pg`
- Socket.io realtime events
- Zod request validation
- Helmet, CORS allowlist, rate limiting

## Supabase Setup

1. Create a Supabase project.
2. Open Supabase SQL Editor.
3. Run the full migration script at `database/001_foodsave_schema.sql`.
4. Run the realtime seller reputation migration at `database/002_seller_reputation_realtime.sql`.
5. Run the auth flow migration at `database/003_auth_flow.sql`.
6. Run the OAuth auth migration at `database/004_oauth_auth_flow.sql`.
7. Run the phone OTP auth migration at `database/005_phone_otp_auth_flow.sql`.
8. Run the eco impact tracker migration at `database/006_eco_impact_tracker.sql`.
9. Run the nearby GPS deals indexes at `database/007_store_geo_nearby_deals.sql`.
10. In Supabase Auth, enable email/password sign-in and phone sign-in. Configure an SMS provider so Supabase can send OTP to real phone numbers.
11. In Supabase Auth Providers, enable Google. In Google Cloud authorized redirect URIs, add the Supabase callback URL, for example `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`. Add the frontend URL, for example `https://YOUR_FRONTEND_DOMAIN/FOODSAVE_USER.html`, to Supabase Auth redirect URLs.
12. In Supabase Auth Providers, enable Facebook with your Facebook App ID/secret and request `email,public_profile`. In Facebook Login valid OAuth redirect URIs, add the Supabase callback URL, for example `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`. Add the frontend URL, for example `https://YOUR_FRONTEND_DOMAIN/FOODSAVE_USER.html`, to Supabase Auth redirect URLs.
13. In Supabase Auth Email Templates, make sure the OTP email includes the 6-digit token, usually via the template variable `{{ .Token }}`.
14. Create manual users only when needed. Normal registration should call the backend auth endpoints with one of:
   - `customer`
   - `partner`
   - `charity`
   - `admin`

The migration creates a trigger on `auth.users` so every new auth user receives a row in `public.profiles`.

## Local Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Fill `.env` with values from Supabase Project Settings:

```bash
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
PASSWORD_RESET_REDIRECT_URL=http://localhost:8080/reset-password
GOOGLE_OAUTH_REDIRECT_URL=http://localhost:5500/FOODSAVE_USER.html
FACEBOOK_OAUTH_REDIRECT_URL=http://localhost:5500/FOODSAVE_USER.html
GOOGLE_OTP_EXPIRES_SECONDS=600
PHONE_OTP_EXPIRES_SECONDS=600
CORS_ORIGINS=http://localhost:3000,http://localhost:5173,http://localhost:5500,http://127.0.0.1:5500
SOCKET_CORS_ORIGINS=http://localhost:3000,http://localhost:5173,http://localhost:8081,http://10.0.2.2:8081
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=foodsave
DATABASE_USER=postgres
DATABASE_PASSWORD=foodsave_secure_local_password
DATABASE_SSL=false
DATABASE_SSL_REJECT_UNAUTHORIZED=true
```

Use the service role key only on the backend. Do not expose it in frontend HTML or client bundles.

## Commands

```bash
npm run dev
npm run typecheck
npm run build
npm start
```

## API Base

Backend default base URL:

```text
http://localhost:8080/api/v1
```

Authenticated endpoints require:

```text
Authorization: Bearer <supabase_access_token>
```

The standalone HTML frontends store the current auth session in:

```text
localStorage["foodsave.auth.session"]
```

When opened from `file://` or a localhost frontend dev server, the standalone HTML files call:

```text
http://localhost:8080/api/v1
```

OAuth providers cannot redirect back to `file://`. For Google/Facebook login locally, serve the static frontend over HTTP, for example `http://localhost:5500/FOODSAVE_USER.html`, and add that same URL to Supabase Auth redirect URLs. For Facebook, the Facebook App valid OAuth redirect URI should be the Supabase callback URL: `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`.

When served from a production HTTP/HTTPS domain, the HTML files call the same origin by default:

```text
https://your-frontend-domain.com/api/v1
```

If the API is on a different domain, set this before loading `frontend/foodsave-auth-client.js` and `frontend/foodsave-live-data.js`:

```html
<script>window.FOODSAVE_API_BASE = "https://api.foodsave.vn/api/v1";</script>
```

You can also configure the script tag or a meta tag:

```html
<meta name="foodsave-api-base" content="https://api.foodsave.vn/api/v1">
<script src="frontend/foodsave-auth-client.js" data-api-base="https://api.foodsave.vn/api/v1"></script>
```

## Auth Flow

- `FOODSAVE_USER.html` uses `frontend/foodsave-auth-client.js` to call `POST /auth/login`, `POST /auth/register/customer`, `POST /auth/password-reset`, and `POST /auth/logout`.
- Customer phone OTP login calls `POST /auth/phone/otp` with the user's phone number, Supabase sends the OTP by SMS, then the user enters the 6-digit code and the frontend calls `POST /auth/phone/verify` before saving the FoodSave session.
- Customer Google login calls `POST /auth/google/start`, redirects to Supabase Google OAuth, then automatically calls `POST /auth/google/otp` after the callback. The OTP is sent directly to the Google email returned by OAuth, not to a user-entered email. `POST /auth/google/verify` accepts only the challenge id and OTP before saving the FoodSave session.
- Customer Facebook login calls `POST /auth/facebook/start`, redirects the user to Facebook Login, asks the user to approve linking FoodSave with their Facebook account, then calls `POST /auth/facebook/callback` after consent. The backend verifies that the Supabase session belongs to Facebook and returns the FoodSave session immediately.
- `FOODSAVE_PARTNER.html` uses the same client script to call `POST /auth/login` with `expected_role: "partner"` and `POST /auth/register/partner`.
- `FOODSAVE_CHARITY.html` uses the same client script to call `POST /auth/login` with `expected_role: "charity"` and `POST /auth/register/charity`.
- Customer registration creates an active Supabase Auth user and `profiles` row.
- Partner registration creates a pending `profiles` row, a pending `stores` row, a `seller_reputation` row, and a pending `applications` row.
- Charity registration creates a pending `profiles` row, a pending `charity_profiles` row, and a pending `applications` row.
- Login accepts email or normalized Vietnam phone formats such as `0901234567`, `84901234567`, and `+84901234567`.
- Successful login returns the Supabase access token, refresh token, profile, and role-specific context. The frontend stores this in `localStorage["foodsave.auth.session"]`.

All responses use:

```json
{ "success": true, "data": {} }
```

or:

```json
{ "success": false, "error": { "code": "ERROR_CODE", "message": "Clear description" } }
```

## Main Routes

- `GET /health`
- `POST /auth/register/customer`
- `POST /auth/register/partner`
- `POST /auth/register/charity`
- `POST /auth/login`
- `POST /auth/google/start`
- `POST /auth/google/otp`
- `POST /auth/google/verify`
- `POST /auth/facebook/start`
- `POST /auth/facebook/callback`
- `POST /auth/phone/otp`
- `POST /auth/phone/verify`
- `POST /auth/refresh`
- `POST /auth/password-reset`
- `POST /auth/logout`
- `GET /catalog/products`
- `GET /catalog/products/:id`
- `GET /catalog/stores`
- `GET /catalog/stores/:id`
- `GET /catalog/vouchers`
- `POST /catalog/stores` partner/admin
- `POST /catalog/products` partner/admin
- `PATCH /catalog/products/:id` partner/admin
- `DELETE /catalog/products/:id` partner/admin
- `GET /profile/me`
- `PATCH /profile/me`
- `GET /cart`
- `POST /cart/items`
- `PATCH /cart/items/:id`
- `DELETE /cart/items/:id`
- `POST /orders`
- `GET /orders`
- `GET /orders/:id`
- `PATCH /orders/:id/status`
- `POST /orders/reviews`
- `POST /orders/complaints`
- `GET /orders/complaints/list`
- `PATCH /orders/complaints/:id` partner/admin
- `GET /donations`
- `POST /donations` partner/admin
- `PATCH /donations/:id/accept` charity/admin
- `PATCH /donations/:id/status`
- `GET /eco-impact/me`
- `GET /eco-impact/partner` partner/admin
- `GET /eco-impact/charity` charity/admin
- `GET /eco-impact/platform` admin
- `GET /eco-impact/leaderboard`
- `GET /charity/gallery`
- `GET /charity/profiles`
- `POST /charity/profiles`
- `POST /charity/volunteers`
- `POST /charity/reports`
- `POST /charity/gallery`
- `GET /notifications`
- `PATCH /notifications/:id/read`
- `PATCH /notifications/read-all`
- `GET /seller-reputation/:id` partner/admin
- `POST /seller-reputation/:id/cancellations` admin
- `POST /seller-reputation/:id/order-success` admin
- `PATCH /seller-reputation/:id/rating-average` admin
- `POST /support/contact`
- `POST /support/applications`

## Seller Reputation Realtime

Backend service functions are implemented in `src/services/sellerReputationService.ts`:

- `handleSellerCancellation(sellerId, orderId)` subtracts 5 trust points, inserts a `seller_violations` row, checks penalties, and emits `STORE_STATUS_CHANGED`.
- `checkAndApplyPenalties(sellerId)` bans sellers below 50 trust points, restricts sellers below 70 trust points or below 3.5 average rating, extends `restricted_until` by 48 hours, and emits `STORE_STATUS_CHANGED`.
- `handleOrderSuccess(sellerId, isCharityOrder)` adds 1 point for a normal order or 2 points for a charity order, restores eligible restricted sellers to `Active`, and emits `STORE_STATUS_CHANGED`.

Order status updates are also linked:

- `PATCH /orders/:id/status` with `status: "completed"` calls `handleOrderSuccess`.
- `PATCH /orders/:id/status` with `status: "cancelled"` by partner/admin calls `handleSellerCancellation`.

Socket event payload:

```json
{
  "sellerId": "11111111-1111-1111-1111-111111111111",
  "status": "Restricted",
  "trustScore": 65,
  "ratingAverage": 4.2,
  "restrictedUntil": "2026-06-04T10:00:00.000Z",
  "reason": "TRUST_SCORE_BELOW_70",
  "message": "Cửa hàng tạm thời bị chặn đăng món mới trong 48 giờ.",
  "emittedAt": "2026-06-02T10:00:00.000Z"
}
```

React Native realtime components are in `mobile/src`:

- `mobile/src/components/DashboardSeller.tsx` listens to `STORE_STATUS_CHANGED` and disables or hides seller actions based on status.
- `mobile/src/components/FoodSaveUserMap.tsx` listens to the same event and immediately hides markers for `Restricted` or `Banned` stores.
- Both components should receive the current Supabase access token through the `authToken` prop so Socket.io can authenticate the connection before joining realtime rooms.

## Frontend Integration Notes

Replace the existing localStorage sync methods with HTTP calls:

- `FS.sync.pushOrder` -> `POST /orders`
- `FS.sync.getOrders` -> `GET /orders`
- `FS.sync.updateOrderStatus` -> `PATCH /orders/:id/status`
- `FS.sync.pushDonation` -> `POST /donations`
- `FS.sync.getDonations` -> `GET /donations`
- `FS.sync.acceptDonation` -> `PATCH /donations/:id/accept`
- `FS.sync.pushComplaint` -> `POST /orders/complaints`
- `FS.sync.getComplaints` -> `GET /orders/complaints/list`
- `FS.sync.getNotifs` -> `GET /notifications`
- `FS.sync.markNotifRead` -> `PATCH /notifications/:id/read`
- `FS.sync.getEcoImpactMe` -> `GET /eco-impact/me`
- `FS.sync.getEcoImpactPartner` -> `GET /eco-impact/partner`
- `FS.sync.getEcoImpactCharity` -> `GET /eco-impact/charity`
- `FS.sync.getEcoImpactPlatform` -> `GET /eco-impact/platform`
- `FS.sync.getEcoImpactLeaderboard` -> `GET /eco-impact/leaderboard`

## Eco Impact Tracker

- Completed orders and completed donations create idempotent rows in `eco_impact_events`.
- Orders use `products.estimated_weight_kg` when available and snapshot it into `order_items.product_metadata`; otherwise the service falls back to category estimates.
- Donations use the existing `donations.weight_kg`.
- Default factors live in `eco_impact_factors`: `2.5kg CO2/kg food`, `890L water/kg food`, and `0.35kg food/meal`.
- User, partner, charity, and admin dashboards read from the `/eco-impact/*` endpoints through `frontend/foodsave-live-data.js` or the admin standalone fetch helper.

## Product Expiry Labels

- Product labels are derived from `products.expires_at`: green for the 3-5 day safe window and other products above 24 hours, yellow for 24 hours or less, and red for 12 hours or less.
- Catalog reads sync active product labels before listing and hide expired products from customer-facing results.
- Product create/update accepts `expires_at` as the source of truth and recalculates `label`; manual label values are ignored.
- Checkout rejects expired products and snapshots the derived label into `order_items.product_metadata`.

## Nearby GPS Deals

- `GET /catalog/products` and `GET /catalog/stores` accept `lat`, `lng`, and `radius_km` query params. `latitude`/`longitude` aliases are also accepted.
- Product results include `distance_km` and `distance_text` when a user location is provided, and `sort=nearest` orders by distance after a precise Haversine calculation.
- The customer frontend stores the user's temporary GPS location in `localStorage["foodsave.nearby.location"]`, reloads nearby catalog data, and uses Browser Notification plus in-app notifications for nearby red/yellow or high-discount deals.
- Partner registration now stores `latitude` and `longitude` from the address picker so new stores can participate in nearby deal discovery.

## Deployment

1. Build the project:

```bash
npm run build
```

2. Deploy `dist/`, `package.json`, and production environment variables to your Node.js host.
3. Set `NODE_ENV=production`.
4. Set `CORS_ORIGINS` to the exact frontend origins, separated by commas.
5. Keep `SUPABASE_SERVICE_ROLE_KEY` in server-only secret storage.
6. For managed Postgres, set `DATABASE_URL`. It takes precedence over the split `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USER`, and `DATABASE_PASSWORD` variables.
7. Set `DATABASE_SSL=true` for hosted Postgres. If your provider uses a certificate chain unavailable to the runtime, set `DATABASE_SSL_REJECT_UNAUTHORIZED=false`.

Use `.env.production.example` as the production template, then replace every `YOUR_*` value with the real Supabase project URL, anon key, service role key, database password, and frontend domain.
