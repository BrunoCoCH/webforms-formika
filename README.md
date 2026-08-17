# Webforms -- GDPR Contact Form Backend

A Cloudflare Worker that receives contact form submissions from any website, stores them in TimeTonic, and sends notification emails via Resend. GDPR, Swiss nLPD-compliant.

**Worker URL:** `https://contact-worker.example.workers.dev/contact`

## How It Works

```
Browser form submit
        |
        v
  POST /contact  (JSON body)
        |
        v
  Cloudflare Worker
   1. Check Origin against SITE_CONFIG
   2. Validate fields (first_name, email, message required)
   3. Honeypot check (website_url field)
   4. Write row to TimeTonic CRM
   5. Send notification email via Resend
   6. Return { ok: true }
```

## Files

| File | Description |
|---|---|
| `contactform_endpoint.js` | **Deployed worker code** (JavaScript). This is what runs on Cloudflare. |
| `Contactform_endpoint.ts` | TypeScript source (reference). Same logic with types. |
| `SITE_CONFIG.json` | Allowed origins configuration (copy this into the Cloudflare env var). |
| `Lovable Script.yaml` | Integration instructions for Lovable-built sites. |
| `Webflow Script.yaml` | Integration instructions for Webflow sites. |
| `docs/` | **GitHub Pages site** — landing page + setup UI under `docs/admin/` (see below). |
| `README.md` | This file. |

## Public vs private values

This repo can switch between public-safe placeholders and private real values.

If you want your private repo to use your real addresses, keep them in a local file that is not committed:

1. Copy `private-values.example.json` to `private-values.json`
2. Replace placeholders with your real values
3. Run:

```
powershell -ExecutionPolicy Bypass -File .\scripts\apply-private.ps1
```

The script updates docs/source files in-place for your local/private usage.

To switch back to public/anonymized values, run:

```
powershell -ExecutionPolicy Bypass -File .\scripts\apply-public.ps1
```

You can also restore anonymized tracked files directly with git:

```
git restore README.md Contactform_endpoint.ts contactform_endpoint.js "Webflow Script.yaml" "Lovable Script.yaml" SITE_CONFIG.json docs/index.html docs/CNAME CNAME docs/admin/app.js docs/admin/index.html
```

---

## Admin UI (configure new websites)

The setup tool lives in **`docs/admin/`** so it can be served by **GitHub Pages** from the `/docs` folder.

**Live URL (after Pages is enabled):**

- Site home (public repo `webforms-formika`): [https://example.github.io/webforms-formika/](https://example.github.io/webforms-formika/)
- Setup tool: [https://example.github.io/webforms-formika/admin/](https://example.github.io/webforms-formika/admin/)

**GitHub Pages settings:** Repository → **Settings** → **Pages** → Build and deployment → Source: **Deploy from a branch** → Branch: **main** → Folder: **`/docs`** → Save.

`docs/.nojekyll` disables Jekyll so all static files (including `app.js`) are served as-is.

**Custom domain (e.g. `setup.example.dev`):** The repo includes `docs/CNAME` with that hostname. After you set the domain under **Settings → Pages → Custom domain**, **commit and push** so `docs/CNAME` is on the branch GitHub publishes (`main`). If DNS is green but you still see **404**, it is usually (1) `CNAME` not yet in the published `docs/` folder, (2) Pages source not set to **`/docs`** on **`main`**, or (3) the latest push has not finished building (refresh after a few minutes).

**Local use:** open `docs/admin/index.html` in a browser, or run `npx serve docs` from the repo root.

**In the UI:**

1. Set **API base URL** if your Worker uses a custom domain.
2. **Add website**: site label, notification email, and every allowed origin (`https://www…`, etc.).
3. **Copy JSON** into Cloudflare → Worker → `SITE_CONFIG`.
4. Use the **Contact** or **Newsletter** tab for ready-made scripts (`contact-form` / `newsletter-form` form ids).

Data is stored in **localStorage** for that origin only (GitHub Pages vs `file://` are separate). API keys are never entered here.

---

## Setup Guide

### 1. Cloudflare Worker

The worker is already deployed. To redeploy after code changes:

1. Go to the Cloudflare Dashboard > Workers and Pages > `contact-worker-name`
2. Click "Edit code" (Quick Editor)
3. Paste the contents of `contactform_endpoint.js`
4. Click "Deploy"

Or use the Cloudflare API with an API token:

```
PUT https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/workers/scripts/contact-worker-name
Authorization: Bearer {API_TOKEN}
Content-Type: multipart/form-data
```

### 2. Environment Variables

Set these in the Cloudflare dashboard under Workers > `contact-worker-name` > Settings > Variables:

| Variable | Type | Value | Description |
|---|---|---|---|
| `TIMETONIC_SESSKEY` | **Secret** | *(your sesskey)* | TimeTonic API session key. Get it from your TimeTonic profile. |
| `TIMETONIC_USERID` | Plain text | `your_userid` | Your TimeTonic user ID (the `o_u` / `u_c` parameter). |
| `TIMETONIC_CATID` | Plain text | `652923` | TimeTonic category (table) ID for Messages_Forms. |
| `RESEND_API_KEY` | **Secret** | *(your key)* | Resend API key from resend.com/api-keys. |
| `FROM_EMAIL` | Plain text | `no-reply@example.com` | Sender address (must be verified in Resend). |
| `SITE_CONFIG` | Plain text | *(JSON string)* | Copy from `SITE_CONFIG.json`. Maps allowed origins to notification emails. |

### 3. TimeTonic Setup

The worker writes to the **CRM_WEBSITES** book, **Messages_Forms** table.

**Key identifiers:**
- Book: `b_c = crm_websites`, `b_o = your_userid`
- Table (category): `catId = 652923`
- Tab: `tabId = 747968` (not used in API calls -- use `catId` instead)

**Field IDs** (defined in the worker code as `TT_FIELDS`):

| Field | TimeTonic ID | Type |
|---|---|---|
| Site | 8747764 | URL |
| First Name | 8747765 | Medium text |
| Last Name | 8747766 | Medium text |
| Email | 8747767 | Email |
| Phone | 8747768 | Phone |
| Company | 8747775 | Medium text |
| Subject | 8747778 | Medium text |
| Message | 8747781 | Long text |
| Status | 8747755 | Medium text |

**To find field IDs yourself:** Open the table in TimeTonic, click the three dots (top-right), Table options, Organize columns, view the column IDs.

**TimeTonic API notes:**
- Endpoint: `https://timetonic.com/live/api.php` (NOT `api.timetonic.com`)
- Content-Type: `application/x-www-form-urlencoded` (NOT JSON)
- Auth requires both `sesskey` AND `o_u` / `u_c` on every call
- New rows use `rowId = "tmp" + UUID`
- Field values are sent as a JSON string in the `fieldValues` parameter, keyed by numeric field IDs
- The API returns HTTP 200 even on errors -- always check `response.status === "ok"`
- API docs: https://timetonic.com/live/apidoc/

### 4. Resend Setup

1. Sign up at resend.com
2. Add and verify your sending domain (e.g. `example.com`)
3. Create an API key
4. Set `FROM_EMAIL` to an address on your verified domain

### 5. Adding a New Website

To accept submissions from a new site:

**Step 1:** Edit `SITE_CONFIG.json` -- add the new origin(s):

```json
{
  "https://example.com": {
    "site": "example.com",
    "notify_email": "info@example.com"
  },
  "https://www.newsite.example": {
    "site": "newsite.example",
    "notify_email": "hello@newsite.example"
  }
}
```

Include both `https://newsite.example` and `https://www.newsite.example` if both are used.

**Step 2:** Update the `SITE_CONFIG` env var in Cloudflare with the new JSON string.

**Step 3:** Add the form + script to your website (see integration guides below).

---

## Frontend Integration

### Required JSON Payload

The frontend sends a POST request with this JSON body:

```json
{
  "site": "example.com",
  "first_name": "John",
  "last_name": "Doe",
  "email": "john@example.com",
  "phone": "+41 79 123 45 67",
  "company": "Acme SA",
  "subject": "Project inquiry",
  "message": "Hello, I would like to discuss a project.",
  "website_url": "",
  "status": "new",
  "notes": ""
}
```

**Required fields:** `first_name`, `email`, `message`

**Honeypot:** `website_url` must be a hidden field left empty. If filled (by a bot), the worker silently returns success without processing.

### Minimal JavaScript (works anywhere)

```javascript
const res = await fetch('https://contact-worker.example.workers.dev/contact', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    site: window.location.hostname,
    first_name: '...',
    last_name: '...',
    email: '...',
    phone: '...',
    company: '...',
    subject: '...',
    message: '...',
    website_url: '',
    status: 'new',
    notes: ''
  })
});

if (res.ok) {
  // Success
} else {
  const err = await res.json();
  // err.error contains the error message
}
```

### For Webflow

See `Webflow Script.yaml` for copy-paste integration instructions.

### For Lovable

See `Lovable Script.yaml` for AI builder instructions.

### For Newsletter Forms

Use the same endpoint with fewer fields. The worker requires `first_name`, `email`, and `message`, so for newsletter signups send:

```json
{
  "site": "example.com",
  "first_name": "Subscriber",
  "email": "user@example.com",
  "message": "Newsletter subscription",
  "subject": "Newsletter signup",
  "website_url": "",
  "status": "new",
  "notes": ""
}
```

---

## API Response Codes

| Status | Body | Meaning |
|---|---|---|
| 200 | `{ "ok": true }` | Success -- saved to TimeTonic and email sent |
| 400 | `{ "error": "Missing required fields" }` | Validation failed |
| 400 | `{ "error": "Invalid email" }` | Email format invalid |
| 400 | `{ "error": "Invalid request" }` | Malformed JSON body |
| 403 | `{ "error": "Forbidden origin" }` | Origin not in SITE_CONFIG |
| 404 | `{ "error": "Not found" }` | Wrong URL path (must be /contact) |
| 405 | `{ "error": "Method not allowed" }` | Must use POST |
| 502 | `{ "error": "TimeTonic write failed", ... }` | TimeTonic API error |
| 502 | `{ "error": "Saved to TimeTonic, but email failed", ... }` | Resend API error |

---

## Security

- **CORS:** Only origins in `SITE_CONFIG` are allowed. All other origins get a 403.
- **Honeypot:** The hidden `website_url` field catches bots.
- **Secrets:** `TIMETONIC_SESSKEY` and `RESEND_API_KEY` are stored as encrypted secrets in Cloudflare (never in code or git).
- **Input sanitization:** All inputs are trimmed. Email HTML is escaped to prevent XSS.
- **No API keys in frontend:** The frontend only sends form data. All API keys live server-side in the worker.
