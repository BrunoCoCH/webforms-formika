export interface Env {
  TIMETONIC_SESSKEY: string;
  TIMETONIC_USERID: string;
  TIMETONIC_CATID: string;
  RESEND_API_KEY: string;

  FROM_EMAIL: string;
  SITE_CONFIG: {
    [origin: string]: {
      site: string;
      notify_email: string;
    };
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin, env),
      });
    }

    if (url.pathname !== "/contact") {
      return json({ error: "Not found" }, 404, origin, env);
    }

    const siteConfig = env.SITE_CONFIG?.[origin];
    if (!siteConfig) {
      return json({ error: "Forbidden origin" }, 403, origin, env);
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, origin, env);
    }

    try {
      const body = await request.json<any>();

      if (body.website_url) {
        return json({ ok: true }, 200, origin, env);
      }

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

      if (!first_name || !email || !message) {
        return json({ error: "Missing required fields" }, 400, origin, env);
      }

      if (!isValidEmail(email)) {
        return json({ error: "Invalid email" }, 400, origin, env);
      }

      const TT_FIELDS: Record<string, string> = {
        site:       "8747764",
        subject:    "8747778",
        message:    "8747781",
        first_name: "8747765",
        company:    "8747775",
        last_name:  "8747766",
        email:      "8747767",
        phone:      "8747768",
        status:     "8747755",
      };

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

      const rowId = "tmp" + crypto.randomUUID();

      const ttParams = new URLSearchParams({
        req: "createOrUpdateTableRow",
        o_u: env.TIMETONIC_USERID,
        u_c: env.TIMETONIC_USERID,
        sesskey: env.TIMETONIC_SESSKEY,
        catId: env.TIMETONIC_CATID,
        rowId,
        fieldValues,
      });

      const ttRes = await fetch("https://timetonic.com/live/api.php", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: ttParams.toString(),
      });

      const ttText = await ttRes.text();
      if (!ttRes.ok) {
        return json({ error: "TimeTonic write failed", details: ttText }, 502, origin, env);
      }

      try {
        const ttJson = JSON.parse(ttText);
        if (ttJson.status !== "ok") {
          return json({ error: "TimeTonic write failed", details: ttJson }, 502, origin, env);
        }
      } catch {
        return json({ error: "TimeTonic returned invalid JSON", details: ttText }, 502, origin, env);
      }

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
          reply_to: email,
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
        return json({ error: "Saved to TimeTonic, but email failed", details: emailText }, 502, origin, env);
      }

      return json({ ok: true }, 200, origin, env);
    } catch {
      return json({ error: "Invalid request" }, 400, origin, env);
    }
  },
};

function corsHeaders(origin: string, env: Env): Record<string, string> {
  const allowedOrigin = env.SITE_CONFIG?.[origin] ? origin : "null";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function json(data: unknown, status: number, origin: string, env: Env): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin, env),
    },
  });
}

function sanitize(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function escapeHtml(str: string): string {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}