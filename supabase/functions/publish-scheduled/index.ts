/**
 * Supabase Edge Function: publish-scheduled (Email Notification System)
 *
 * Sends email reminders to users when their scheduled posts are due,
 * so they can copy-paste the content and post to their social media manually.
 *
 * Deploy:  supabase functions deploy publish-scheduled
 * Invoke:  POST https://<ref>.supabase.co/functions/v1/publish-scheduled
 * Header:  x-job-key: <PUBLISH_JOB_SECRET>
 *
 * Required Supabase secrets (set via: supabase secrets set KEY=value):
 *   PUBLISH_JOB_SECRET        — shared secret for cron auth
 *   RESEND_API_KEY            — Resend email API key (https://resend.com)
 *   APP_URL                   — e.g. https://postrocket.hu
 *   SUPABASE_URL              (auto-injected by Supabase)
 *   SUPABASE_SERVICE_ROLE_KEY (auto-injected by Supabase)
 */

// deno-lint-ignore-file no-explicit-any
/// <reference lib="deno.ns" />

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const BATCH_LIMIT = 25; // posts to process per cron tick

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type DuePost = {
  id: string;
  post_id: string;
  scheduled_for: string;
  posts: {
    id: string;
    user_id: string;
    caption: string | null;
    image_url: string | null;
    profiles: {
      email: string;
    } | null;
  };
};

// ---------------------------------------------------------------------------
// Auth — timing-safe comparison (no Node.js crypto dependency)
// ---------------------------------------------------------------------------
function timingSafeEqual(a: string, b: string): boolean {
  const encA = new TextEncoder().encode(a);
  const encB = new TextEncoder().encode(b);
  if (encA.length !== encB.length) return false;
  let diff = 0;
  for (let i = 0; i < encA.length; i++) {
    diff |= encA[i] ^ encB[i];
  }
  return diff === 0;
}

function isAuthorized(req: Request): boolean {
  const expected = Deno.env.get("PUBLISH_JOB_SECRET");
  if (!expected) return false;
  const jobKey = req.headers.get("x-job-key");
  if (!jobKey) return false;
  return timingSafeEqual(jobKey, expected);
}

// ---------------------------------------------------------------------------
// Email via Resend
// ---------------------------------------------------------------------------
async function sendReminderEmail(
  toEmail: string,
  scheduledFor: string,
  caption: string | null,
  appUrl: string,
): Promise<void> {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) {
    throw new Error("RESEND_API_KEY is not configured.");
  }

  const scheduledDate = new Date(scheduledFor).toLocaleString("hu-HU", {
    timeZone: "Europe/Budapest",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const previewText = caption
    ? caption.slice(0, 120) + (caption.length > 120 ? "…" : "")
    : "(Képes poszt, szöveg nélkül)";

  const emailBody = `
<!DOCTYPE html>
<html lang="hu">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PostRocket – Poszt emlékeztető</title>
</head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;border:1px solid #e5e7eb;overflow:hidden;">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#f97316,#ea580c);padding:28px 32px;">
              <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">🚀 PostRocket</p>
              <p style="margin:6px 0 0;font-size:14px;color:rgba(255,255,255,0.85);">Poszt emlékeztető</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 16px;font-size:16px;color:#111827;font-weight:600;">
                🕐 Egy ütemezett posztod most esedékes!
              </p>
              <p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.6;">
                Az alábbi poszt a naptáradban <strong style="color:#374151;">${scheduledDate}</strong>-re volt ütemezve.
                Jelentkezz be a dashboardra, másold ki a szöveget, és posztold fel a kívánt platformra!
              </p>
              <!-- Post preview -->
              <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:16px;margin-bottom:24px;">
                <p style="margin:0 0 6px;font-size:11px;font-weight:600;color:#9ca3af;letter-spacing:0.05em;text-transform:uppercase;">Poszt előnézet</p>
                <p style="margin:0;font-size:14px;color:#374151;line-height:1.6;">${previewText}</p>
              </div>
              <!-- CTA -->
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:#f97316;border-radius:8px;">
                    <a href="${appUrl}/dashboard/posts"
                       style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">
                      Dashboard megnyitása →
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #f3f4f6;">
              <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.6;">
                Ezt az emailt a PostRocket küldötte, mert ez a poszt a naptáradban szerepelt.<br>
                Beállítások: <a href="${appUrl}/dashboard/account-billing" style="color:#f97316;">fiók beállítások</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "PostRocket <no-reply@postrocket.hu>",
      to: [toEmail],
      subject: `🚀 PostRocket – Ütemezett posztod most esedékes! (${scheduledDate})`,
      html: emailBody,
    }),
  });

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(
      `Resend API error ${res.status}: ${(payload as any)?.message ?? "unknown"}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed." }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!Deno.env.get("PUBLISH_JOB_SECRET")) {
    return new Response(
      JSON.stringify({ error: "PUBLISH_JOB_SECRET is not configured." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  if (!isAuthorized(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const appUrl = Deno.env.get("APP_URL") ?? "https://postrocket.hu";

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const nowIso = new Date().toISOString();

  // Fetch due posts that haven't been notified yet
  const { data: duePosts, error: fetchError } = await admin
    .from("scheduled_posts")
    .select(
      "id, post_id, scheduled_for, posts!inner(id, user_id, caption, image_url, profiles!inner(email))",
    )
    .eq("status", "scheduled")
    .lte("scheduled_for", nowIso)
    .is("notified_at", null)
    .order("scheduled_for", { ascending: true })
    .limit(BATCH_LIMIT);

  if (fetchError) {
    console.error("publish-scheduled: query error", fetchError.message);
    return new Response(JSON.stringify({ error: "Internal error." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const items = (duePosts ?? []) as unknown as DuePost[];
  const results: { id: string; success: boolean; message: string }[] = [];

  for (const item of items) {
    const userEmail = item.posts?.profiles?.email;

    if (!userEmail) {
      console.warn(
        `publish-scheduled: no email for post ${item.id}, skipping.`,
      );
      results.push({
        id: item.id,
        success: false,
        message: "No user email found.",
      });
      continue;
    }

    try {
      await sendReminderEmail(
        userEmail,
        item.scheduled_for,
        item.posts?.caption ?? null,
        appUrl,
      );

      // Mark as notified + published
      await admin
        .from("scheduled_posts")
        .update({
          status: "published",
          published_at: new Date().toISOString(),
          notified_at: new Date().toISOString(),
          error_message: null,
        })
        .eq("id", item.id);

      await admin
        .from("posts")
        .update({ status: "published" })
        .eq("id", item.post_id);

      results.push({
        id: item.id,
        success: true,
        message: "Notification sent.",
      });
    } catch (err: unknown) {
      const errorMsg =
        err instanceof Error ? err.message : "Notification failed";
      console.error(`publish-scheduled: failed for ${item.id}:`, errorMsg);

      await admin
        .from("scheduled_posts")
        .update({ error_message: errorMsg.slice(0, 1000) })
        .eq("id", item.id);

      results.push({ id: item.id, success: false, message: errorMsg });
    }
  }

  // Housekeeping: delete usage_logs older than 90 days
  try {
    await admin
      .from("usage_logs")
      .delete()
      .lt(
        "created_at",
        new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
      );
  } catch (cleanupErr) {
    console.error("Usage logs cleanup failed:", cleanupErr);
  }

  return new Response(JSON.stringify({ data: results }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
