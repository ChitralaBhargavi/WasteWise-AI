# WasteWise AI

WasteWise AI is a student project exploring waste segregation, disposal guidance, community reporting, and collection coordination. The project includes a React/Vite frontend, Express API, MongoDB models, cookie-based authentication, citizen and collector workflows, admin tools, and a separate FastAPI image-classification service. The AI service and integration are implemented, but no trained model or dataset is included; genuine inference remains unavailable until a verified model is trained and configured.

## Project structure

The frontend stays at the repository root; the API and the optional-model AI service are independent services.

```text
FSDProject/
├── public/                  # Static frontend assets
├── src/
│   ├── components/          # Protected route UI
│   ├── contexts/            # React authentication state
│   ├── lib/                 # Fetch API client and CSRF handling
│   ├── pages/               # Landing, auth, account, citizen and collector screens
│   ├── App.jsx
│   └── main.jsx
├── server/
│   ├── src/
│   │   ├── config/          # Environment and MongoDB configuration
│   │   ├── controllers/     # Authentication, health, citizen, and collector handlers
│   │   ├── middleware/      # Auth, roles, CSRF, logging, errors
│   │   ├── models/          # Mongoose schemas and models
│   │   ├── routes/          # Auth, health, citizen, and collector routes
│   │   ├── test/            # Isolated MongoDB-backed API tests
│   │   └── utils/           # Cookie and CSRF helpers, async file logging
│   ├── .env.example
│   └── package.json
├── ai-service/
│   ├── app/                 # FastAPI routes, image validation and ONNX inference
│   ├── tests/               # Model-independent service tests
│   ├── training/            # Reproducible training pipeline for licensed local data
│   ├── requirements.txt
│   └── .env.example
├── index.html
└── package.json
```

## Prerequisites

- Node.js 20.19+ or 22.12+ and npm
- MongoDB Community Server running locally on `127.0.0.1:27017`
- Python 3.11+ only if running or testing the optional AI service
- VS Code (recommended)

Start the MongoDB Windows service from an elevated PowerShell terminal if it is installed as a service, then check connectivity:

```powershell
Start-Service MongoDB
Get-Service MongoDB
Test-NetConnection 127.0.0.1 -Port 27017
```

If MongoDB is already running or is managed another way, skip `Start-Service`. In MongoDB Compass connect to `mongodb://127.0.0.1:27017`. The application database is `wastewise_ai`. Automated API tests use `wastewise_ai_auth_test`; they clear only their test records and do not drop databases or collections.

## Run the frontend

From the project root:

```powershell
if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }
npm ci
npm run dev
```

Vite prints the local URL, normally `http://localhost:5173`. Frontend checks:

```powershell
npm run build
npm run lint
```

The frontend `.env.example` sets `VITE_API_BASE_URL=/api`. During local development, all API calls use `/api` and Vite proxies them to `http://localhost:3000`, avoiding direct browser-to-API requests. The backend development origin allowlist includes the default Vite port (`http://localhost:5173`) and its first fallback (`http://localhost:5174`); add the exact origin to both `FRONTEND_ORIGIN` and `CORS_ORIGINS` if Vite selects another port. For deployments, route `/api` to the backend on the serving origin, or set `VITE_API_BASE_URL` to the backend URL and allow the frontend's exact origin in the backend CORS configuration. Never put backend secrets in a Vite environment file; `VITE_*` variables are exposed to browser code.

## Configure and run the backend

In a second VS Code terminal, from the project root, copy the example only if a local environment file does not already exist:

```powershell
Set-Location .\server
npm ci
if (-not (Test-Path .env)) {
  Copy-Item .env.example .env
  $jwtSecret = node -e "process.stdout.write(require('node:crypto').randomBytes(48).toString('base64url'))"
  (Get-Content .env -Raw).Replace(
    'JWT_SECRET=replace-with-a-unique-random-secret-of-at-least-32-characters',
    "JWT_SECRET=$jwtSecret"
  ) | Set-Content .env -Encoding ascii
}
npm run dev
```

The API will not start if `JWT_SECRET` is missing, is shorter than 32 characters, or is still the example placeholder. The random secret is local-only; do not commit `server/.env` or place backend secrets in the frontend. MongoDB must be reachable before the API starts listening.

The environment template configures:

```dotenv
PORT=3000
NODE_ENV=development
FRONTEND_ORIGIN=http://localhost:5173,http://localhost:5174
CORS_ORIGINS=http://localhost:5173,http://localhost:5174
MONGODB_URI=mongodb://127.0.0.1:27017/wastewise_ai
MONGODB_DB_NAME=wastewise_ai
JWT_SECRET=<generate a unique secret locally>
JWT_ISSUER=wastewise-ai-api
JWT_AUDIENCE=wastewise-ai-client
JWT_EXPIRES_IN_SECONDS=900
AUTH_COOKIE_NAME=ww_access
CSRF_COOKIE_NAME=ww_csrf
COOKIE_SAME_SITE=lax
```

`FRONTEND_ORIGIN` is checked by CSRF protection and `CORS_ORIGINS` controls credentialed CORS. Use the exact frontend origins for both (comma-separated when there is more than one). The local template lists the default Vite origin and its first fallback; if Vite selects another port, add that exact origin to both settings and restart the API. The API defaults to `http://localhost:3000`; change `PORT` only if the frontend API URL and local setup are adjusted to match.

For a normal start, use `npm start` from `server/`; for development with file watching, use `npm run dev`.

## Authentication architecture

- Passwords are hashed with bcrypt before persistence. `passwordHash` is excluded from normal Mongoose queries and all API output.
- Public registration only creates a `citizen`. Requests containing unsupported fields such as `role` or `passwordHash` are rejected.
- Login sets a 15-minute HS256 JWT in an HttpOnly, host-only cookie scoped to `/api`. The token contains only the user ID as its application claim; signature, issuer, audience, and expiry are verified on protected requests.
- `requireAuth` loads the current user from MongoDB for each protected request. `requireRole('admin')` and `requireRole('collector')` authorize from this database-backed role, not from frontend state or request data.
- The API uses a signed double-submit CSRF token. The frontend calls `GET /api/auth/csrf`, retains the returned token in memory, and sends it in `X-CSRF-Token` for every state-changing request. The matching CSRF cookie is HttpOnly. Tokens are HMAC-signed using a key derived from the JWT secret with a separate context label.
- Every state-changing request also requires an allowed `Origin` or `Referer`; CORS is credentialed and restricted to configured exact origins. CORS is not used as a substitute for CSRF protection.
- Logout clears the browser cookie but does not revoke a previously copied, stateless JWT. A copied access token remains usable until its short expiry (15 minutes); server-side token revocation is not implemented in this phase. Deleting a user prevents further sessions because protected requests reload the user from MongoDB.
- Legacy user documents from before `passwordHash` existed are retained and cannot authenticate until a future account recovery/migration workflow is implemented. No records are deleted or auto-promoted.

## Authentication endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/auth/csrf` | Set CSRF cookie and return the CSRF request token |
| `POST` | `/api/auth/register` | Create a citizen and set the access cookie |
| `POST` | `/api/auth/login` | Verify credentials and set the access cookie |
| `POST` | `/api/auth/logout` | CSRF-protected cookie clearing |
| `GET` | `/api/auth/me` | Return the authenticated safe user |
| `GET` | `/api/health` | API status and actual MongoDB connection status |

Authentication state is discovered from `/api/auth/me` when the React app loads. JWTs and passwords are never stored in browser storage or returned in JSON. Account and citizen-report pages are protected by a reusable React route component.

### PowerShell registration and session example

Run these commands in a separate terminal while the API is running:

```powershell
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$origin = "http://localhost:5173"
$csrfResponse = Invoke-RestMethod `
  -Uri http://localhost:3000/api/auth/csrf `
  -WebSession $session `
  -Headers @{ Origin = $origin }
$headers = @{
  Origin = $origin
  "X-CSRF-Token" = $csrfResponse.data.csrfToken
}
$body = @{
  name = "Demo Citizen"
  email = "citizen@example.test"
  password = "a-long-demo-password"
} | ConvertTo-Json

$registered = Invoke-RestMethod `
  -Uri http://localhost:3000/api/auth/register `
  -Method Post `
  -WebSession $session `
  -Headers $headers `
  -ContentType "application/json" `
  -Body $body
$registered
Invoke-RestMethod -Uri http://localhost:3000/api/auth/me -WebSession $session -Headers @{ Origin = $origin }
```

The registration response shape is `{ "data": { "user": { "id", "name", "email", "role", "createdAt" } } }`. The JWT is only in the `Set-Cookie` header and is not included in the JSON. `GET /api/auth/me` has the same safe user shape. Invalid credentials return HTTP `401` with the same `Invalid email or password.` message whether the email exists or not. Validation errors return `400`; duplicate email returns `409`; missing/invalid CSRF or disallowed origins return `403`.

Logout requires a fresh CSRF token as well:

```powershell
$csrfResponse = Invoke-RestMethod `
  -Uri http://localhost:3000/api/auth/csrf `
  -WebSession $session `
  -Headers @{ Origin = $origin }
$headers["X-CSRF-Token"] = $csrfResponse.data.csrfToken
Invoke-RestMethod `
  -Uri http://localhost:3000/api/auth/logout `
  -Method Post `
  -WebSession $session `
  -Headers $headers `
  -ContentType "application/json" `
  -Body "{}"
```

The old unauthenticated `/api/db-test/*` routes have been removed from normal routing and return `404`. Phase 3 models and database records are retained.

## Phase 5: Citizen waste reporting

Signed-in citizen accounts can create waste reports, list only their own reports, and view a report's review decision, collection status, and chronological history. The backend enforces ownership in each MongoDB query using the authenticated user's database identity. Client-supplied owner, status, role, and unknown fields are rejected. A new report starts in collection status `reported` and review status `pending_review`; initial collection history records the authenticated citizen.

The existing `WasteReport` collection is preserved. `reportedBy` is now required for newly created reports; no destructive migration or automatic ownership assignment was performed. Pre-existing Phase 3 reports without `reportedBy` remain in MongoDB and are not shown in any citizen's list because ownership cannot be safely inferred. Older reports with no `statusHistory` are represented with an empty history.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/reports` | Create a report as the authenticated citizen |
| `GET` | `/api/reports?page=1&limit=20` | List the authenticated citizen's reports |
| `GET` | `/api/reports/:id` | View one owned report and its status history |
| `GET` | `/api/reports/:id/image` | Stream a report photo to its owner, an admin, or an assigned collector |

Example create request:

```json
{
  "category": "plastic",
  "description": "Plastic bottles near the community park",
  "location": {
    "address": "Community park entrance",
    "latitude": 12.9716,
    "longitude": 77.5946
  }
}
```

`POST /api/reports` requires the existing JWT cookie, an allowed `Origin` or `Referer`, and the CSRF cookie/header pair. The shared React API client fetches and sends the CSRF token automatically. The endpoint accepts a JSON body for text-only compatibility or `multipart/form-data` with `category`, optional `description`, optional JSON `location`, and optional `image` file. Successful creation returns HTTP `201` with `{ "data": { "report": { "id", "category", "description", "location", "status", "reviewStatus", "reviewHistory", "imageUrl", "statusHistory", "createdAt", "updatedAt" } } }`; optional properties are omitted when absent. The server always sets `reportedBy`, collection status, and review status; internal owner and actor IDs are not included in citizen API responses.

Example PowerShell commands, using the logged-in web session from the authentication example above:

```powershell
$csrfResponse = Invoke-RestMethod `
  -Uri http://localhost:3000/api/auth/csrf `
  -WebSession $session `
  -Headers @{ Origin = $origin }
$headers["X-CSRF-Token"] = $csrfResponse.data.csrfToken
$reportBody = @{
  category = "plastic"
  description = "Plastic bottles near the community park"
  location = @{
    address = "Community park entrance"
    latitude = 12.9716
    longitude = 77.5946
  }
} | ConvertTo-Json -Depth 5
$createdReport = Invoke-RestMethod `
  -Uri http://localhost:3000/api/reports `
  -Method Post `
  -WebSession $session `
  -Headers $headers `
  -ContentType "application/json" `
  -Body $reportBody
$createdReport
$reportId = $createdReport.data.report.id

Invoke-RestMethod -Uri "http://localhost:3000/api/reports?page=1&limit=20" `
  -WebSession $session -Headers @{ Origin = $origin }
Invoke-RestMethod -Uri "http://localhost:3000/api/reports/$reportId" `
  -WebSession $session -Headers @{ Origin = $origin }
```

The list response contains a `data` array and `pagination` metadata (`page`, `limit`, `totalItems`, `totalPages`). The default page size is 20 and the maximum is 100. Results are newest-first. Malformed IDs and invalid input return `400`; missing or non-owned reports both return `404`. Citizens cannot update report status through these endpoints. Later collector/admin workflows must append status-history events only from authorized backend operations, recording the actor and transition timestamp.

The React app provides a citizen dashboard, report creation form, My Reports list, report detail/status history, validation feedback, and loading/empty/error states. It uses the existing credentialed API client and does not store authentication tokens in browser storage.

Report creation checks the same category against active reports within 50 metres using stored coordinates. Pending-review, accepted, assigned, and in-progress reports can block a duplicate; collected, verified, rejected, and records without complete coordinates do not. Configure the radius with `DUPLICATE_REPORT_RADIUS_METERS` (1–1,000 metres). A duplicate returns `409 Conflict`; another citizen's report ID and private details are not included in that response.

## Phase 6: Collector workflow

Collector access is based on the current user's role loaded from MongoDB by the existing authentication middleware. A JWT role claim, client role field, or frontend route is never sufficient authorization. Public registration continues to create citizens only. Collector accounts must be provisioned by a trusted operator; this phase adds no role-assignment UI or public account-promotion endpoint.

At the end of Phase 6 there was no admin assignment workflow. Phase 7 adds the protected assignment workflow described below. Collector APIs only expose reports that have a non-cancelled `CollectionRequest` whose `assignedCollector` matches the authenticated collector.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/collector/reports?page=1&limit=20` | Paginated, newest-first assigned reports |
| `GET` | `/api/collector/reports/:id` | Retrieve a report only while assigned to the current collector |
| `PATCH` | `/api/collector/reports/:id/status` | Apply the next allowed status to an assigned report |

Collector pagination defaults to 20 and is capped at 100. A malformed report ID returns `400`; a missing report or report not assigned to that collector returns the same `404`. Collector responses omit citizen owner IDs and status-history actor IDs.

The collector endpoints expose only accepted reports with an active assignment. Valid collection status transitions are sequential and follow the existing `WasteReport` status enum:

| Current status | Allowed collector update |
| --- | --- |
| `reported` | `assigned` (set by an administrator when assigning an accepted report) |
| `assigned` | `in_progress` |
| `in_progress` | `collected` |
| `collected` | No further collector update; `verified` remains reserved for a future authorized workflow |

For each accepted update, the server atomically changes the report's current status and appends a status-history entry containing `previousStatus`, the new `status`, timestamp, and collector `changedBy` reference. Existing history fields and legacy entries remain valid. State-changing requests use the same origin and CSRF protections as authentication and citizen report creation. Citizens cannot use the collector endpoints, and their citizen report endpoints do not permit status changes.

The React app adds a role-protected collector dashboard and assigned report detail/status screen. Both use the existing API client, cookie authentication, CSRF mechanism, and shared status history. Role mismatch redirects do not expose protected data.

## Phase 7: Admin dashboard and secure assignment

An administrator's authorization is confirmed from the database on every request by the existing `requireAuth` and `requireRole('admin')` middleware. Admin pages also use the existing role-aware route guard; that guard is convenience only, and every `/api/admin/*` endpoint independently requires the database-authorized admin role. Public registration remains citizen-only.

### Provision an existing admin account

There is no HTTP endpoint to grant roles. A trusted operator with access to the backend environment can promote an existing account by email. First create the user through the normal registration flow, then run this from the project root after setting up `server/.env` and confirming MongoDB is available:

```powershell
npm --prefix .\server run admin:promote -- existing-account@example.com
```

The script accepts exactly one syntactically valid email, requires a matching existing account, and only then promotes it. It has no default account, does not create users, and prints no credential or password-hash data. Sign in again after promotion so `/api/auth/me` refreshes the role from MongoDB.

### Admin pages and API

The frontend routes are `/admin` (overview), `/admin/reports` and `/admin/reports/:id`, `/admin/users`, and `/admin/assignments`. Only users with the database role `admin` can access them.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/admin/overview` | Database-derived totals, groupings, activity and collector workload |
| `GET` | `/api/admin/reports?page=1&limit=20&status=reported&category=plastic` | Newest-first report list with optional validated filters |
| `GET` | `/api/admin/reports/:id` | Report, citizen summary, status history and assignment summaries |
| `PATCH` | `/api/admin/reports/:id/review` | Accept a pending report or reject it with a required reason |
| `GET` | `/api/admin/users?page=1&limit=20&role=collector` | Safe paginated user profiles with optional role filter |
| `GET` | `/api/admin/collectors` | Minimal eligible collector list used by assignment selection |
| `GET` | `/api/admin/assignments?page=1&limit=20&status=assigned` | Paginated actual collection request records |
| `POST` | `/api/admin/reports/:id/assign` | Assign an eligible report; requires admin cookie, allowed origin and CSRF token |

Assignment request body:

```json
{ "collectorId": "a valid collector MongoDB ObjectId" }
```

Review request bodies are `{ "decision": "accepted" }` or `{ "decision": "rejected", "reason": "A clear reason, up to 500 characters" }`. Rejected or pending-review reports cannot be assigned.

Successful assignment returns HTTP `201` with the assignment (safe collector and report summaries) and the updated report status. Only `accepted`, collection-status-`reported` reports without a non-cancelled assignment are eligible. The backend verifies that the selected database user has the `collector` role; unknown fields, missing collectors, citizens/admins as collectors, malformed IDs, non-eligible reports, and existing active assignments are rejected. Duplicate assignment returns HTTP `409`; active assignment is not silently replaced. On assignment, the report moves from `reported` to `assigned` and history records the administrator as the actor. The collector can then continue the existing `assigned → in_progress → collected` transitions. Admins do not directly set arbitrary statuses.

Example successful response:

```json
{
  "data": {
    "assignment": {
      "id": "assignment-object-id",
      "status": "assigned",
      "collector": { "id": "collector-object-id", "name": "Collector Name", "email": "collector@example.test", "role": "collector" },
      "report": { "id": "report-object-id", "category": "plastic", "status": "assigned" },
      "createdAt": "2026-10-23T08:00:00.000Z",
      "updatedAt": "2026-10-23T08:00:00.000Z"
    },
    "report": { "id": "report-object-id", "status": "assigned" }
  }
}
```

The model has a sparse unique `activeAssignmentKey` index used for assignments created by this workflow. It avoids requiring a destructive migration or imposing an index over legacy assignments. The endpoint checks existing non-cancelled assignments and the unique key arbitrates concurrent new attempts. Assignment creation and the report status/history update span two MongoDB documents and are **not a transaction**: the implementation uses a compare-and-set report update and removes the newly inserted assignment if that update loses a race. As with any non-transactional two-document operation, process termination between those writes can leave an assignment record without the status update; inspect/reconcile such records operationally. No transaction support is assumed.

### Overview metric definitions

- Registered users are all user documents; citizen and collector totals filter by the current stored role. Admin accounts are included in total but not those two role subtotals.
- Report total counts each `WasteReport` document once. Status and category charts group each report by its current stored value; they do not join assignments.
- Unassigned eligible reports are reports in `reported` status with no related `CollectionRequest` whose status is not `cancelled`. This includes reports with cancelled-only history; multiple active request rows do not multiply the report count.
- Active collection requests are `CollectionRequest` documents whose status is anything except `cancelled`; cancelled is counted separately. Collector workload groups those active request documents by assigned collector (request count, not distinct-report count).
- The daily trend counts reports created on each of the last 30 UTC calendar dates, based on `WasteReport.createdAt`; missing dates are returned as zero.

Charts use the real aggregated API response and accessible CSS/HTML visualizations; no chart dependency, mock values, environmental savings estimate, or synthetic history was added. Report and user tables are paginated (default 20, maximum 100) with validated filters. Password hashes are not selected or serialized. Old reports with missing owners and assignments with missing related documents remain viewable as unavailable summaries.

## Automated tests

With MongoDB running, from `server/`:

```powershell
npm test
```

The Node test-runner suite uses the actual Express middleware and a dedicated `wastewise_ai_auth_test` database. It clears only test users, assignments, and reports in that dedicated test database; it never drops a database/collection or connects to the normal `wastewise_ai` database.

Phase 7 verification: `npm --prefix .\\server test` passed all 32 tests against local MongoDB using the isolated `wastewise_ai_auth_test` database; `npm run build`, `npm run lint`, and `node --check` for all 30 backend JavaScript files passed. The suite covers prior authentication, citizen, collector tests and the new admin authorization, aggregation, filtering, assignment, history, concurrency, and promotion-input scenarios. A live browser check verified admin sign-in, overview, report filtering, assignment, refreshed metrics, and collector visibility/status history. Temporary browser-test records were removed. Results describe this workspace run and do not guarantee another machine's setup.

## Phase 8: AI image-classification service

### Readiness and model availability

The repository contained no trained model artifact, saved class mapping, training notebook, or dataset during Phase 8 inspection. Therefore, the application does **not** currently produce a category prediction. The FastAPI service starts without a model, reports `model.ready: false`, and returns HTTP `503` for valid classification uploads. Express and the citizen UI surface this state instead of inventing results. No model accuracy or evaluation metrics are claimed.

The service accepts only an ONNX model plus a JSON manifest in the configured model directory. The loader validates that the manifest's exact label order is `plastic`, `paper`, `metal`, `glass`, `organic`, `other`; inputs are RGB, resized to 224×224, NCHW float values in `[0,1]`; and model outputs are six logits in that order. Inference applies softmax. The reported confidence is the predicted class's softmax score; scores are explicitly **not calibrated probabilities**. ONNX and JSON are used instead of unsafe pickle-style serialization. A compatible file loading successfully does not establish provenance or training quality: only configure a model you have verified was genuinely trained and have permission to use.

### Start FastAPI on Windows PowerShell

Use Python 3.11 or newer. From the project root:

```powershell
Set-Location .\ai-service
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
.\.venv\Scripts\python.exe -m app.main
```

The default binds only to `127.0.0.1:8000`. Do not bind to a public interface; if a container deployment requires a non-loopback bind address, keep the service on a private application network and firewall it from public clients. The service does not expose CORS endpoints or require a second public authentication mechanism; Express is the intended access boundary. It checks the model files once at process startup, so restart FastAPI after adding or replacing a model artifact.

The AI service settings are `AI_HOST`, `AI_PORT`, `AI_MODEL_DIR`, `AI_MODEL_FILE`, `AI_MODEL_MANIFEST_FILE`, `AI_MAX_UPLOAD_BYTES` (default 5 MiB), and `AI_MAX_IMAGE_PIXELS` (default 40 million). The server's `AI_SERVICE_URL` defaults to `http://127.0.0.1:8000`; `AI_UPLOAD_MAX_BYTES` defaults to 5 MiB and `AI_REQUEST_TIMEOUT_MS` to 10 seconds. Example values only are in [ai-service/.env.example](./ai-service/.env.example) and [server/.env.example](./server/.env.example). The existing `server/.env` is not altered by this phase.

The FastAPI `/health` response separates service status and model readiness:

```json
{
  "status": "ok",
  "model": {
    "ready": false,
    "model_name": null,
    "model_version": null,
    "reason": "model_not_configured"
  }
}
```

`GET http://127.0.0.1:8000/health` may report the service healthy while its model is unavailable. The existing `GET http://localhost:3000/api/health` retains its API/database fields and adds an `ai` object, for example `{ "service": "available", "model": "not_ready" }` or `{ "service": "unavailable", "model": "unknown" }`. A remote service health timeout is bounded and does not prevent API startup.

### Citizen classification flow and API

Only a signed-in database-authorized citizen can call `POST /api/ai/classify`. The request also requires the existing allowed-origin and CSRF cookie/header protections. React uses the existing shared API client and credentials; JWTs are not put in browser storage. Express enforces the configured file limit, checks JPEG/PNG/WebP signatures, and forwards only in-memory bytes and a server-selected content type to FastAPI. FastAPI independently decodes the raster image, checks actual format, dimensions and upload size, and performs inference in memory. Neither service stores uploaded images or adds report/database fields. Admin, collector, and public visitors do not receive this feature.

Frontend route: `/classify` (citizen only). It displays the actual model result and scores when available, or a clear unavailable/error state; classification never creates a report.

FastAPI endpoints:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Service status and model readiness |
| `POST` | `/api/classify` | Internal multipart inference endpoint; returns `503` if the model is not ready |

Express endpoint:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/ai/classify` | Authenticated, CSRF-protected citizen upload and validated proxy response |

Multipart field name is `image`. Supported actual image formats are JPEG, PNG, and WebP; default maximum file size is 5 MiB. Filename extensions and user-supplied MIME types do not establish file validity. Empty, unsupported, corrupt, over-limit, or excessively large-dimension files receive safe `400`, `413`, or `415` responses. Model-not-ready is `503`; an AI service timeout is `504`; connection failure is `503`; malformed upstream output is `502`. No filesystem paths, stack traces, internal service URL, or secrets are returned to the browser.

Schematic successful response shape (placeholders only; these values are not a real response or prediction):

```json
{
  "data": {
    "inference_success": true,
    "predicted_category": "<one of the six supported categories>",
    "confidence": "<actual computed score>",
    "probabilities": "<actual model scores keyed by category>",
    "model_name": "<loaded model name>",
    "model_version": "<loaded model version>",
    "confidence_note": "Softmax scores are not calibrated probabilities and do not guarantee correctness.",
    "disposal_guidance": null
  }
}
```

This is intentionally schematic and not directly parseable as an API response. No category-specific disposal instructions currently exist in the application, so the response does not fabricate them and the UI advises users to check local rules.

### Dataset requirements and reproducible training

No dataset is bundled or downloaded. The best verified candidate is **UCI RealWaste**: [official UCI record](https://archive.ics.uci.edu/dataset/908/realwaste), [official metadata API](https://archive.ics.uci.edu/api/dataset?id=908), [official ZIP download](https://archive.ics.uci.edu/static/public/908/realwaste.zip). UCI describes 4,752 color images collected at an authentic landfill, created in 2023 by Sam Single, Saeid Iranmanesh, and Raad Raad, and states the dataset is licensed CC BY 4.0. Cite it as Single, S., Iranmanesh, S., & Raad, R., *RealWaste*, UCI Machine Learning Repository, DOI [10.24432/C5SS4G](https://doi.org/10.24432/C5SS4G); see also the authors' 2023 paper, [“RealWaste: A Novel Real-Life Data Set for Landfill Waste Classification Using Deep Learning”](https://www.mdpi.com/2078-2489/14/12/633). UCI's metadata gives source class counts: Cardboard 461, Food Organics 411, Glass 420, Metal 790, Miscellaneous Trash 495, Paper 500, Plastic 921, Textile Trash 318, Vegetation 436. These source details and terms should be rechecked on UCI before a training run; the archive was not downloaded or inspected in this workspace.

RealWaste has nine source labels, not the target six. The Colab notebook documents a candidate human-reviewed mapping: Cardboard + Paper → `paper`; Food Organics + Vegetation → `organic`; Miscellaneous Trash + Textile Trash → `other`; Plastic, Metal, and Glass map directly. Vegetation-to-organic and textile-to-other may not fit every local collection policy, so inspect the images and category definitions; if not justified, collect and label appropriate examples. Never silently map `trash` or another ambiguous catch-all. The notebook requires explicit mapping approval and stores original-to-target mapping and the source-file audit in the artifacts. The UCI metadata does not document object/scene group IDs or recommended splits; manual group curation is required, and making one group per image is not an acceptable leakage-control strategy. It requires the dataset to be prepared as described below before training.

TrashNet is a less suitable alternative: the [authors' repository](https://github.com/garythung/trashnet) reports controlled-background images in glass, paper, cardboard, plastic, metal, and trash; there is no organic category, and `trash` is not an established synonym for `other`. The authors link to a Hugging Face copy; confirm image licensing separately from the software license before reuse. It cannot supply the required six categories alone.

Keep images of the same physical object, scene, and capture session in one group to avoid train/test leakage. The Colab notebook checks exact hashes and near-duplicate perceptual hashes, and stops for duplicates across groups that could leak across splits.

Prepare this structure, with at least seven independent group directories per category and at least ten supported images per category:

```text
datasets/waste-six-class/
├── plastic/<globally-unique-object-or-scene-group>/*.jpg
├── paper/<globally-unique-object-or-scene-group>/*.jpg
├── metal/<globally-unique-object-or-scene-group>/*.jpg
├── glass/<globally-unique-object-or-scene-group>/*.jpg
├── organic/<globally-unique-object-or-scene-group>/*.jpg
└── other/<globally-unique-object-or-scene-group>/*.jpg
```

The previous local `train_model.py` script trains a small CNN from scratch on CPU. For GPU-enabled Colab training, use [WasteWiseAI_Colab_Training.ipynb](./ai-service/training/WasteWiseAI_Colab_Training.ipynb), which invokes `train_colab_model.py`: torchvision ResNet18 transfer learning from explicit `ResNet18_Weights.IMAGENET1K_V1` weights (review upstream weight/data terms before reuse), auto-select CUDA with CPU fallback, inverse-frequency loss weights, deterministic group-based 70/15/held-out-test splits, validation macro-F1 early stopping, and Drive checkpoints saved after each epoch. Checkpoints are resumable only when the dataset mapping/splits and training configuration match. The model embeds ImageNet mean/std normalization so the ONNX graph still receives the serving contract's raw RGB 224×224 NCHW float `[0,1]` input. It exports six logits in exact manifest order, runs ONNX checker/runtime and PyTorch-vs-ONNX smoke tests, and writes model manifest, training config, split manifest and measured held-out evaluation report.

Prepare this structure with at least seven globally unique, non-empty object/scene group directories per category and at least one readable image in each split:

In Google Colab, open the notebook, select a GPU runtime if available, upload the source dataset ZIP or read it from Drive, and upload `train_colab_model.py` if prompted. For UCI RealWaste, manually organize images into independent object/scene subfolders under each of the nine original source-label folders before running the notebook. The notebook inspects those source labels and applies the approved mapping into target category folders; it writes `source-labels.csv` with original and mapped labels/paths. Do not discard original labels or make one group per image. The notebook reports image/group counts, missing labels, corrupt files, class imbalance and duplicate/near-duplicate conflicts before training. It does not download a dataset automatically or guess class mappings.

Optional local training dependencies and local CPU/GPU invocation use:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-training.txt
.\.venv\Scripts\python.exe training\train_colab_model.py `
  --dataset-dir .\datasets\waste-six-class `
  --dataset-name "UCI RealWaste" `
  --dataset-license "CC BY 4.0 (verify current terms)" `
  --dataset-provenance "https://archive.ics.uci.edu/dataset/908/realwaste" `
  --source-label-mapping-json '{"Cardboard":"paper","Paper":"paper","Food Organics":"organic","Vegetation":"organic","Glass":"glass","Metal":"metal","Plastic":"plastic","Miscellaneous Trash":"other","Textile Trash":"other"}' `
  --output-dir .\models `
  --checkpoint .\checkpoints\last-checkpoint.pt `
  --epochs 12 `
  --batch-size 32
```

For local recovery, add `--resume-from .\checkpoints\last-checkpoint.pt`. In Colab the notebook stores resumable checkpoints and output artifacts on Drive. Extract the resulting archive, then from the project root place its serving artifacts as follows (set `$artifactDir` to the extracted archive folder):

```powershell
$artifactDir = (Resolve-Path .\WasteWiseAI-model-artifacts).Path
New-Item -ItemType Directory -Force .\ai-service\models | Out-Null
Copy-Item (Join-Path $artifactDir "waste-classifier.onnx") .\ai-service\models\
Copy-Item (Join-Path $artifactDir "model-manifest.json") .\ai-service\models\
```

Keep evaluation/training/split/source-label records with experiment documentation. Restart FastAPI from `ai-service/` and check readiness:

```powershell
Set-Location .\ai-service
.\.venv\Scripts\python.exe -m app.main
# In another terminal:
Invoke-RestMethod http://127.0.0.1:8000/health
```

Require `model.ready: true` before using classification. Model artifacts, datasets, and training outputs are git-ignored. The notebook has not yet been trained or evaluated in this repository, so no measured metrics are available or claimed.

### Phase 8 checks

Run Python service tests from `ai-service/` after installing `requirements.txt`:

```powershell
Set-Location .\ai-service
.\.venv\Scripts\python.exe -m pytest .\tests
```

They do not download model weights or require a dataset. They cover service/model readiness, image decode and spoof validation, dimensions/size limits, malformed/missing uploads, and safe errors. The notebook's real ONNX inference smoke test runs only after training in Colab. The Express integration suite uses a local mocked upstream and is not a real model test.

Phase 8 verification in this workspace: `npm --prefix .\\server test` passed **37 tests, 0 failed** against the isolated `wastewise_ai_auth_test` database; the Express AI tests use a local mocked upstream. `.\.venv\Scripts\python.exe -m pytest .\tests\ -q` passed **14 tests, 0 failed** from `ai-service/`; Python emitted one Starlette deprecation warning because its TestClient currently uses `httpx` (no test failed). `npm run build` and `npm run lint` passed, `node --check` passed for all 33 backend JavaScript files, and Python `compileall` passed for the AI app, tests, and training scripts. The Colab notebook JSON and all Python cells also passed syntax compilation. No ONNX inference or end-to-end browser test was performed because there is no trained model; no prediction, evaluation metric, or accuracy result is claimed.

## Phase 9: Admin filtered report export

Administrators can download a UTF-8 CSV from the Waste reports page. The export reuses the page's validated status and category filters and includes **all matching records**, not only the current paginated results. It contains report ID, category, current status, description, location/address coordinates, citizen name/email, assigned collector name, and report creation/update timestamps. Values come directly from MongoDB; no synthetic records or estimates are included.

The endpoint is `GET /api/admin/reports/export.csv?status=assigned&category=metal`. Like the other admin routes, it requires the authenticated database-backed `admin` role. Invalid filters return `400`; anonymous users and other roles are rejected. The response is marked `Cache-Control: no-store`, and text values that could be interpreted as spreadsheet formulas are escaped before CSV quoting.

Export verification from the project root:

```powershell
npm --prefix .\\server test
npm run lint
npm run build
```

## Phase 9 limitations

The admin CSV export is implemented. Maps are still not available, and environmental impact savings are not estimated because the application does not currently collect validated geographic boundaries or impact-measurement data. Existing analytics charts and report filters continue to use real MongoDB-backed results.

## Phase 10: Responsive UI, accessibility, and workflow verification

The existing React and Bootstrap layouts now keep report tables scrollable on narrow screens instead of clipping their contents, and pagination and administrator navigation wrap for mobile widths. Main routes include a keyboard-accessible skip link and visible keyboard focus. Report-creation validation errors are shown next to and programmatically associated with their fields; form-level API errors remain announced. Data tables have accessible captions and column headers, the activity chart exposes its daily values to assistive technology, and reduced-motion preferences are respected. Duplicate submissions are guarded for report creation, sign-in/registration, AI uploads, logout, assignment, and collector status updates.

The Express API integration suite continues to cover role authorization, CSRF-protected writes, input validation, ownership/assignment boundaries, and administrator filtering/export. There is no configured automated browser/device test runner in this project, so responsive visual and keyboard checks remain manual; do not treat build/test checks as a substitute for those checks.

Run automated checks from the project root:

```powershell
npm --prefix .\\server test
npm run lint
npm run build
```

For manual responsive and workflow verification, start MongoDB and the backend using the setup instructions above, then run `npm run dev`. In browser developer tools, check 320px, 768px, and desktop widths; verify tables scroll within their wrappers, page controls wrap, and the landing navigation toggles. Use Tab/Shift+Tab to inspect focus and the skip link. Sign in using citizen, collector, and admin accounts to verify their existing routes and actions, including the AI model-not-ready message and admin filtered CSV download. The backend test suite uses the isolated `wastewise_ai_auth_test` database.

## Phase 11: Final verification and college demo readiness

### Local startup order

1. Start MongoDB Community Server and confirm `127.0.0.1:27017` is reachable.
2. In a terminal at the project root, configure and start the API:

   ```powershell
   Set-Location .\server
   npm ci
   if (-not (Test-Path .env)) {
     Copy-Item .env.example .env
     $jwtSecret = node -e "process.stdout.write(require('node:crypto').randomBytes(48).toString('base64url'))"
     (Get-Content .env -Raw).Replace(
       'JWT_SECRET=replace-with-a-unique-random-secret-of-at-least-32-characters',
       "JWT_SECRET=$jwtSecret"
     ) | Set-Content .env -Encoding ascii
   }
   npm run dev
   ```

   The API waits for its initial MongoDB connection before listening on port 3000. Check `http://localhost:3000/api/health`; `database.status` should be `connected`.
3. Optional, for the honest model-not-ready screen when the AI service is reachable, open another terminal:

   ```powershell
   Set-Location .\ai-service
   if (-not (Test-Path .env)) { Copy-Item .env.example .env }
   .\.venv\Scripts\python.exe -m app.main
   ```

   Install its requirements first if its virtual environment is not set up, as described under Phase 8. With no verified model installed, health must report `model.ready: false`; no classification is returned.
4. In a project-root terminal, install/run the frontend:

   ```powershell
   if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }
   npm ci
   npm run dev
   ```

   Open the Vite URL, normally `http://localhost:5173`. Keep `FRONTEND_ORIGIN` and `CORS_ORIGINS` in `server/.env` aligned with this exact origin. `VITE_API_BASE_URL` is public frontend configuration only; do not put secrets in it.

### Roles and demonstration sequence

- **Citizen:** Register normally. Create reports, review owned reports and status history, and visit the classifier page. Registration only creates citizens.
- **Collector:** Collector accounts are provisioned by a trusted operator; there is no public role-change endpoint. Register the account, then have an operator change its role to `collector` in the local `wastewise_ai` database using MongoDB Compass. Sign out and sign in again to refresh the database-backed role.
- **Admin:** Register the account and promote that existing user from the project root with `npm --prefix .\server run admin:promote -- admin@example.test`. The command requires `server/.env` and a reachable MongoDB; it does not create accounts.

Suggested college demo:

1. As a citizen, register/sign in, create a report with a category and optional location, then show the new report and status history.
2. Show the classifier readiness message. Without a verified model it must say prediction is unavailable; do not present a fabricated result.
3. As an admin, show real overview analytics, filter the report list, export the filtered CSV, and assign the citizen report to the provisioned collector.
4. As that collector, open the assigned report and advance its allowed status; show the updated status history.
5. Return as the citizen to show the report status update, then sign out and confirm protected screens require authentication.

Do not use real personal information or real passwords for a classroom demo. Use synthetic demo account details, do not display or share secrets, and do not promote accounts outside a local/demo database.

### Final verification commands

From the project root:

```powershell
npm --prefix .\server test
npm run lint
npm run build
Get-ChildItem .\server\src -Recurse -Filter *.js | ForEach-Object { node --check $_.FullName; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
```

Optional AI service tests, after setting it up:

```powershell
Set-Location .\ai-service
.\.venv\Scripts\python.exe -m pytest .\tests\ -q
```

The Node test suite requires local MongoDB and uses only `wastewise_ai_auth_test`. There is no configured browser end-to-end test runner. A successful test/build does not establish that the live browser workflows or a model have been verified.

### Readiness and limits

The project is suitable for a **local college demonstration** after MongoDB, the API, and Vite are running and demo roles are provisioned. Production deployment remains pending: rate limiting, account recovery, server-side session/token revocation, monitoring, and operational review of multi-document assignment consistency are not implemented. Maps, validated environmental-impact measurements, and genuine AI inference with a verified model are also unavailable.

## Production deployment requirements

- Serve the frontend and API over HTTPS. `NODE_ENV=production` automatically marks both auth cookies `Secure`.
- Store a unique, randomly generated `JWT_SECRET` in the deployment secret manager. Do not use the example placeholder.
- Configure exact frontend origins; never use wildcard CORS with credentials.
- Same-site deployments can use `COOKIE_SAME_SITE=lax`. For a genuinely cross-site frontend/API deployment, set `COOKIE_SAME_SITE=none` (accepted only in production, with Secure cookies), use HTTPS for both services, configure a specific `FRONTEND_ORIGIN`, and retain the CSRF token and Origin/Referer checks.
- Do not expose or deploy the application before rate limiting, operational monitoring, and a production account-recovery/revocation strategy are added.

## Current scope

Completed: React/Vite foundation, Express/Mongoose foundation, citizen registration/login/logout/session verification, database-backed role middleware, CSRF protection, frontend auth integration, citizen report workflow with optional validated photo and map location, admin review and accepted-only assignment, collector collection-progress workflow with Before/After proof, priority and overdue tracking, in-app notifications, admin dashboard/analytics, report/user/assignment views and filtered CSV export, and trusted existing-user promotion utility.

Not implemented: password reset/email verification, rate limiting, server-side JWT revocation, legacy-account migration, self-service collector account provisioning, transactional multi-document assignment, environmental impact estimates (no validated measurement data), and operational AI inference (blocked on an appropriately licensed dataset and verified trained model).

## Report photos, map locations, and admin review

Citizen reports can include an optional JPEG, PNG, or WebP photo up to 5 MiB by default. The API checks the decoded image format and request size, limits image dimensions, and re-encodes the photo before saving it outside MongoDB in a private local upload directory. Report documents store only a generated file key and content type; files are not served as static assets. `REPORT_IMAGE_MAX_BYTES` configures the upload limit (1,024 bytes through 20 MiB), and `REPORT_IMAGE_UPLOAD_DIR` configures the storage directory. The directory must be writable by the API process, excluded from source control, backed up/retained according to local operating policy, and placed on private persistent storage for deployment.

The original citizen photo remains the report's **BEFORE** photo. When an assigned collector moves an accepted report from `in_progress` to `collected`, the collector must submit a separate JPEG, PNG, or WebP **AFTER** cleanup photo. The same image size, decoded-format validation, dimension limits, safe re-encoding, generated private file naming, and authenticated image-serving controls are used. The AFTER photo is stored separately and does not replace the original. The database update commits its image reference, collected status, and proof-history event together; if the status update fails, the newly written file is removed. Older reports without proof continue to load normally.

Report images are streamed through an authenticated API endpoint. Citizens can view only their own report photos; administrators can view report photos; collectors can view either image only for a currently assigned, accepted report. Image responses use `nosniff` and private, non-cacheable headers. Do not expose the upload directory through a web server static-file mapping.

The report form supports pin selection/movement on an interactive Leaflet map, optional address search through the public OpenStreetMap Nominatim service, and an explicit user-initiated browser geolocation request. A selected coordinate pair must be confirmed before submission. Manual pin placement and address entry remain available if geocoding or location permission is unavailable. OpenStreetMap tiles and Nominatim are third-party public services with availability and usage policies; the app requires no paid API key. Saved coordinates and available address text appear in citizen, administrator, and assigned-collector report details.

Review and collection are separate state histories:

| Stage | State | Allowed action |
| --- | --- | --- |
| Submission | Review: `pending_review`; collection: `reported` | Citizen creates; only an admin may review |
| Accepted | Review: `accepted`; collection: `reported` | Admin may assign to a collector |
| Rejected | Review: `rejected`; collection remains unchanged | Admin must provide a rejection reason; assignment and collection are blocked |
| Assigned | Review: `accepted`; collection: `assigned` | Assigned collector may advance the report |
| In progress | Review: `accepted`; collection: `in_progress` | Assigned collector must submit an AFTER cleanup photo to mark it collected |
| Complete | Review: `accepted`; collection: `collected` | AFTER photo and proof event are stored; no further collector transition is available |

Only pending reports may receive one admin decision. Rejection reasons are required and limited to 500 characters. The API checks admin role, CSRF protection, decision values, and state transitions; client-side controls are not relied on for authorization. Admin report filters and CSV export include the review state, and dashboard analytics distinguish review states from collection states. Review decisions record the reviewer, decision time, and any rejection reason separately from collection status history. Citizen, administrator, and collector detail views label BEFORE and AFTER photos and display the proof submission in chronological report history.

The new environment settings are shown in `server/.env.example`:

```dotenv
REPORT_IMAGE_MAX_BYTES=5242880
REPORT_IMAGE_UPLOAD_DIR=uploads/reports
DUPLICATE_REPORT_RADIUS_METERS=50
REPORT_DUE_HOURS_LOW=72
REPORT_DUE_HOURS_MEDIUM=48
REPORT_DUE_HOURS_HIGH=24
REPORT_DUE_HOURS_URGENT=4
```

Local setup does not need extra map credentials. Run the frontend, backend, and MongoDB using the Phase 11 startup instructions. Install frontend/backend dependencies with `npm ci` from the project root and `server` directory respectively. Verify the backend workflow and frontend production output with:

```powershell
npm --prefix .\server test
npm run lint
npm run build
```

There is no configured frontend unit-test or browser end-to-end runner. Public OSM geocoding/tiles require network access; when unavailable, use the manual map pin or enter an address. Report image files are stored on the API host by default, so production deployment must provide private persistent file storage and backup/retention handling.

## Phase 2: Priority and overdue tracking

New reports receive `medium` priority; citizens cannot set priority or due-time fields. Only administrators can change priority using the protected report detail control and the server-validated admin API. The supported values are `low`, `medium`, `high`, and `urgent`. Existing reports without a priority are treated as `medium` without requiring a migration.

The server calculates the service-target deadline from `createdAt` and the current priority. Defaults are low: 72 hours, medium: 48 hours, high: 24 hours, and urgent: 4 hours. Override these durations using `REPORT_DUE_HOURS_LOW`, `REPORT_DUE_HOURS_MEDIUM`, `REPORT_DUE_HOURS_HIGH`, and `REPORT_DUE_HOURS_URGENT` in `server/.env`. Each must be an integer from 1 through 8,760 hours. Changing a report's priority recalculates its deadline from the original creation time. No due time or overdue state is persisted or accepted from a client.

Overdue is computed at request time and begins when the deadline is reached. Only reports with a valid `createdAt` timestamp can be overdue; missing or unparseable creation dates get no calculated due time and are treated as not overdue. Collected, verified, and rejected reports are never overdue. Reports pending review, accepted, assigned, or in progress may become overdue. Admin report filters and CSV export share the same server-side priority/overdue filter; the CSV includes priority, due time, and the calculated overdue value. Dashboard counts are database queries/aggregations, not client-side totals. Collectors see priority, target date, and overdue status for their assignments. Citizens see a simple handling/attention status; where service-target language is shown, it is explicitly not a guarantee.

Priority and overdue verification uses the backend test suite:

```powershell
npm --prefix .\server test
```

## Phase 3: In-app notifications

Authenticated citizens, collectors, and administrators have a Notifications link with an unread count. The notification center is paginated and supports refreshing, marking one notification read, and marking all notifications read. Updates are refreshed when navigating between pages and when the user opens or refreshes the notification center; the frontend does not use background polling.

Notifications are created for report submission (administrators), acceptance or rejection (the citizen), collector assignment (the citizen and assigned collector), work starting and collection completion (the citizen), and priority increases to high or urgent (administrators and the currently assigned collector). High/urgent report creation also notifies administrators if such a report is created by an authorized server workflow. Overdue notices are generated for the report owner and current assigned collector when either user's notification list is requested after the service target has passed. A unique notification key prevents repeated overdue checks or retried events from creating duplicates. Notification writes are best-effort and do not fail the report operation that triggered them.

The API derives the recipient exclusively from the authenticated HttpOnly-cookie session. List requests accept `page` and `limit` (default 20, maximum 50); read changes require the existing CSRF and allowed-Origin protections. Notification links use the role-specific report route, whose existing authorization and ownership/assignment checks remain authoritative. Messages avoid embedding personal data, and report review history/status history remain separate.

Run the backend integration suite, frontend lint, and production build from the project root:

```powershell
npm --prefix .\server test
npm run lint
npm run build
```

There is no configured browser end-to-end test runner. Manually verify notifications as a citizen, collector, and administrator: create/review/assign a report, advance collector status, raise priority, open a related report link, check the unread count, mark individual/all notifications read, and confirm another account cannot access or mark them.
