// =============================================================================
// Contact Form Worker — Cloudflare Workers
// =============================================================================
//
// Receives contact form submissions via POST /contact, then:
//   1. Saves the data as a new row in TimeTonic (CRM_WEBSITES > Messages_Forms)
//   2. Sends a notification email via Resend to the site owner
//
// Deployed at: https://contact-worker.example.workers.dev
//
// Environment variables (set in Cloudflare dashboard):
//   TIMETONIC_SESSKEY  — TimeTonic API session key (secret)
//   TIMETONIC_USERID   — TimeTonic user ID, e.g. "your_userid" (plain text)
//   TIMETONIC_CATID    — TimeTonic category/table ID, e.g. "652923" (plain text)
//   RESEND_API_KEY     — Resend email API key (secret)
//   FROM_EMAIL         — Sender address for notifications (plain text)
//   SITE_CONFIG        — JSON string mapping allowed origins to site config (plain text)
//
// SITE_CONFIG format:
//   {
//     "https://example.com": { "site": "example.com", "notify_email": "info@example.com" },
//     "https://www.example.com": { "site": "example.com", "notify_email": "info@example.com" }
//   }
// =============================================================================

// TimeTonic field IDs for the Messages_Forms table (catId: 652923)
// To find these: open the table in TimeTonic > Table options > Organize columns
const TT_FIELDS = {
  site:       "8747764",  // URL field
  subject:    "8747778",  // Medium text
  message:    "8747781",  // Long text
  first_name: "8747765",  // Medium text
  company:    "8747775",  // Medium text
  last_name:  "8747766",  // Medium text
  email:      "8747767",  // Email field
  phone:      "8747768",  // Phone field
  status:     "8747755",  // Medium text
};

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);

    const siteConfigMap = getSiteConfig(env);
    const siteConfig = siteConfigMap[origin];

    // Handle CORS preflight (browsers send OPTIONS before cross-origin POST)
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin, siteConfig),
      });
    }

    // Only /contact is a valid path
    if (url.pathname !== "/contact") {
      return json({ error: "Not found" }, 404, origin, siteConfig);
    }

    // Reject requests from origins not in SITE_CONFIG
    if (!siteConfig) {
      return json({ error: "Forbidden origin" }, 403, origin, siteConfig);
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, origin, siteConfig);
    }

    try {
      const body = await request.json();

      // Honeypot: if the hidden field is filled, it's a bot — silently succeed
      if (body.website_url) {
        return json({ ok: true }, 200, origin, siteConfig);
      }

      // Use the site from the request body, or fall back to SITE_CONFIG
      const resolvedSite = sanitize(body.site) || siteConfig.site;
      const notifyEmail = siteConfig.notify_email;

      const first_name = sanitize(body.first_name);
      const last_name = sanitize(body.last_name);
      const email = sanitize(body.email);
      const phone = sanitize(body.phone);
      const company = sanitize(body.company);
      const subject = sanitize(body.subject);
      const message = sanitize(body.message);
      const status = sanitize(body.status) || "new";
      const notes = sanitize(body.notes) || "";

      // Required fields validation
      if (!first_name || !email || !message) {
        return json({ error: "Missing required fields" }, 400, origin, siteConfig);
      }

      if (!isValidEmail(email)) {
        return json({ error: "Invalid email" }, 400, origin, siteConfig);
      }

      // --- Step 1: Write to TimeTonic ---
      // TimeTonic API uses form-urlencoded POST with numeric field IDs.
      // Docs: https://timetonic.com/live/apidoc/
      const fieldValues = JSON.stringify({
        [TT_FIELDS.site]:       resolvedSite,
        [TT_FIELDS.first_name]: first_name,
        [TT_FIELDS.last_name]:  last_name,
        [TT_FIELDS.email]:      email,
        [TT_FIELDS.phone]:      phone,
        [TT_FIELDS.company]:    company,
        [TT_FIELDS.subject]:    subject,
        [TT_FIELDS.message]:    message,
        [TT_FIELDS.status]:     status,
      });

      // "tmp" + UUID signals a new row creation to TimeTonic
      const rowId = "tmp" + crypto.randomUUID();

      const ttParams = new URLSearchParams({
        req: "createOrUpdateTableRow",
        o_u: env.TIMETONIC_USERID,      // OAuth user ID
        u_c: env.TIMETONIC_USERID,      // Must match o_u
        sesskey: env.TIMETONIC_SESSKEY,
        catId: env.TIMETONIC_CATID,      // Table (category) ID, not the tab ID
        rowId,
        fieldValues,
      });

      const ttRes = await fetch("https://timetonic.com/live/api.php", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: ttParams.toString(),
      });

      const ttText = await ttRes.text();

      // Check HTTP-level failure
      if (!ttRes.ok) {
        return json({ error: "TimeTonic write failed", details: ttText }, 502, origin, siteConfig);
      }

      // TimeTonic returns HTTP 200 even on errors — must check the JSON body
      try {
        const ttJson = JSON.parse(ttText);
        if (ttJson.status !== "ok") {
          return json({ error: "TimeTonic write failed", details: ttJson }, 502, origin, siteConfig);
        }
      } catch (e) {
        return json({ error: "TimeTonic returned invalid JSON", details: ttText }, 502, origin, siteConfig);
      }

      // --- Step 2: Send notification email via Resend ---
      const fullName = `${first_name} ${last_name}`.trim();

      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: env.FROM_EMAIL,
          to: [notifyEmail],
          reply_to: email,               // So you can reply directly to the submitter
          subject: `New contact${subject ? `: ${subject}` : ""}`,
          html: `
            <h2>New contact form submission</h2>
            <p><strong>Site:</strong> ${escapeHtml(resolvedSite)}</p>
            <p><strong>Name:</strong> ${escapeHtml(fullName)}</p>
            <p><strong>Email:</strong> ${escapeHtml(email)}</p>
            <p><strong>Phone:</strong> ${escapeHtml(phone)}</p>
            <p><strong>Company:</strong> ${escapeHtml(company)}</p>
            <p><strong>Subject:</strong> ${escapeHtml(subject)}</p>
            <p><strong>Message:</strong><br>${escapeHtml(message).replace(/\n/g, "<br>")}</p>
          `,
        }),
      });

      const emailText = await emailRes.text();
      if (!emailRes.ok) {
        return json({ error: "Saved to TimeTonic, but email failed", details: emailText }, 502, origin, siteConfig);
      }

      return json({ ok: true }, 200, origin, siteConfig);

    } catch (e) {
      return json({ error: "Invalid request" }, 400, origin, siteConfig);
    }
  },
};

// =============================================================================
// Helper functions
// =============================================================================

/** Parse SITE_CONFIG from env (may be a JSON string or already an object) */
function getSiteConfig(env) {
  if (typeof env.SITE_CONFIG === "string") {
    return JSON.parse(env.SITE_CONFIG);
  }
  return env.SITE_CONFIG || {};
}

/** CORS headers — only allows origins listed in SITE_CONFIG */
function corsHeaders(origin, siteConfig) {
  const allowedOrigin = siteConfig ? origin : "null";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

/** JSON response helper with CORS headers */
function json(data, status, origin, siteConfig) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin, siteConfig),
    },
  });
}

/** Trim strings, return empty string for non-strings */
function sanitize(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Prevent XSS in the notification email HTML */
function escapeHtml(str) {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
