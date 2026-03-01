/**
 * Supabase Edge Function: publish-scheduled
 *
 * Replaces the Next.js /api/jobs/publish-scheduled route.
 * Runs on Deno — uses Web Crypto API instead of Node.js crypto.
 *
 * Deploy:  supabase functions deploy publish-scheduled
 * Invoke:  POST https://<ref>.supabase.co/functions/v1/publish-scheduled
 * Header:  x-job-key: <PUBLISH_JOB_SECRET>
 *
 * Required Supabase secrets (set via: supabase secrets set KEY=value):
 *   PUBLISH_JOB_SECRET
 *   META_TOKEN_ENCRYPTION_KEY
 *   SUPABASE_URL            (auto-injected by Supabase)
 *   SUPABASE_SERVICE_ROLE_KEY (auto-injected by Supabase)
 */

import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const META_GRAPH_BASE = "https://graph.facebook.com/v23.0";
const META_FETCH_TIMEOUT_MS = 25_000; // 25s per Meta call
const TOKEN_PREFIX = "enc:v1:";
const MAX_RETRIES = 3;
const BATCH_LIMIT = 5; // posts per cron tick

// ---------------------------------------------------------------------------
// Types  (mirror the Next.js route)
// ---------------------------------------------------------------------------
type ScheduledRow = {
  id: string;
  platform: "facebook" | "instagram";
  post_id: string;
  scheduled_for: string;
  retry_count: number;
  posts: {
    id: string;
    user_id: string;
    caption: string | null;
    image_url: string | null;
  };
};

type SocialAccountRow = {
  provider: "facebook" | "instagram";
  access_token: string;
  meta_page_id: string | null;
  instagram_account_id: string | null;
  refresh_token: string | null;
  account_name: string | null;
};

// ---------------------------------------------------------------------------
// Auth — timing-safe comparison (pure JS, no Node.js dependency)
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
// AES-256-GCM decryption using Web Crypto API
// Must match the Node.js encrypt/decrypt in lib/crypto.ts exactly.
// Format: "enc:v1:<iv_base64url>:<ciphertext_base64url>:<tag_base64url>"
// ---------------------------------------------------------------------------
function base64urlToBytes(str: string): Uint8Array {
  // Re-pad and convert base64url → base64
  const padded = str + "=".repeat((4 - (str.length % 4)) % 4);
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  // Use new Uint8Array (backed by ArrayBuffer) instead of Uint8Array.from
  // so Web Crypto API accepts it as BufferSource without type errors.
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function decryptAccessToken(value: string): Promise<string> {
  if (!value.startsWith(TOKEN_PREFIX)) {
    throw new Error("Token is not encrypted — expected enc:v1: prefix.");
  }

  const parts = value.slice(TOKEN_PREFIX.length).split(":");
  if (parts.length !== 3) {
    throw new Error("Encrypted secret is malformed.");
  }

  const [ivEncoded, encryptedEncoded, tagEncoded] = parts;
  const iv = base64urlToBytes(ivEncoded);
  const encrypted = base64urlToBytes(encryptedEncoded);
  const tag = base64urlToBytes(tagEncoded);

  const secretStr = Deno.env.get("META_TOKEN_ENCRYPTION_KEY");
  if (!secretStr) {
    throw new Error(
      "META_TOKEN_ENCRYPTION_KEY environment variable is required.",
    );
  }

  // Derive 32-byte key: SHA-256(secret) — same as Node's createHash("sha256").update(secret).digest()
  const rawKey = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secretStr),
  );

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );

  // Web Crypto AES-GCM expects ciphertext with tag appended
  const ciphertextWithTag = new Uint8Array(encrypted.length + tag.length);
  ciphertextWithTag.set(encrypted);
  ciphertextWithTag.set(tag, encrypted.length);

  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as unknown as Uint8Array<ArrayBuffer> },
    cryptoKey,
    ciphertextWithTag,
  );

  return new TextDecoder().decode(plaintext);
}

// ---------------------------------------------------------------------------
// Meta API helpers
// ---------------------------------------------------------------------------
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), META_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Meta API request timed out after 25 seconds.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function metaGet<T>(
  path: string,
  params: Record<string, string>,
): Promise<T> {
  const url = new URL(`${META_GRAPH_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetchWithTimeout(url.toString(), { method: "GET" });
  const payload = await res.json();
  if (!res.ok)
    throw new Error(payload?.error?.message || "Meta API GET failed.");
  return payload as T;
}

async function metaPost<T>(
  path: string,
  params: Record<string, string>,
): Promise<T> {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) body.set(k, v);
  const res = await fetchWithTimeout(`${META_GRAPH_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const payload = await res.json();
  if (!res.ok)
    throw new Error(payload?.error?.message || "Meta API POST failed.");
  return payload as T;
}

// ---------------------------------------------------------------------------
// Helpers — mirror lib/social-account.ts
// ---------------------------------------------------------------------------
function parseStoredImages(imageUrl: string | null): string[] {
  if (!imageUrl) return [];
  const trimmed = imageUrl.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (item): item is string => typeof item === "string" && !!item,
        );
      }
      return [];
    } catch {
      return [];
    }
  }
  if (trimmed.includes(",")) {
    return trimmed
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
  }
  return [trimmed];
}

function decodeAccountMeta(value: string | null): {
  pageId?: string;
  igUserId?: string;
} {
  if (!value) return {};
  try {
    return JSON.parse(value) ?? {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Instagram container polling
// ---------------------------------------------------------------------------
async function waitForInstagramContainer(
  creationId: string,
  accessToken: string,
): Promise<void> {
  for (let i = 0; i < 12; i++) {
    const status = await metaGet<{ status_code: string }>(`/${creationId}`, {
      access_token: accessToken,
      fields: "status_code",
    });

    if (status.status_code === "FINISHED") return;
    if (status.status_code === "ERROR") {
      throw new Error("Instagram media container failed.");
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error("Instagram media container timed out after 36 seconds.");
}

// ---------------------------------------------------------------------------
// Platform publishers
// ---------------------------------------------------------------------------
async function publishFacebook(
  post: ScheduledRow,
  account: SocialAccountRow,
): Promise<void> {
  const accountMeta = decodeAccountMeta(account.refresh_token);
  const pageId = account.meta_page_id || accountMeta.pageId;
  if (!pageId) throw new Error("Facebook page ID missing.");

  const images = parseStoredImages(post.posts.image_url);
  const message = post.posts.caption || "";

  if (images.length === 0) {
    await metaPost(`/${pageId}/feed`, {
      access_token: account.access_token,
      message,
    });
    return;
  }

  if (images.length === 1) {
    await metaPost(`/${pageId}/photos`, {
      access_token: account.access_token,
      url: images[0],
      caption: message,
    });
    return;
  }

  // Multi-image: upload each as unpublished, then attach to feed post
  const mediaFbids: string[] = [];
  for (const imageUrl of images) {
    const uploaded = await metaPost<{ id: string }>(`/${pageId}/photos`, {
      access_token: account.access_token,
      url: imageUrl,
      published: "false",
    });
    mediaFbids.push(uploaded.id);
  }

  const params: Record<string, string> = {
    access_token: account.access_token,
    message,
  };
  mediaFbids.forEach((fbid, idx) => {
    params[`attached_media[${idx}]`] = JSON.stringify({ media_fbid: fbid });
  });

  await metaPost(`/${pageId}/feed`, params);
}

async function publishInstagram(
  post: ScheduledRow,
  account: SocialAccountRow,
): Promise<void> {
  const accountMeta = decodeAccountMeta(account.refresh_token);
  const igUserId = account.instagram_account_id || accountMeta.igUserId;
  if (!igUserId) throw new Error("Instagram user ID missing.");

  const images = parseStoredImages(post.posts.image_url);
  if (images.length === 0) {
    throw new Error("Instagram requires at least one image.");
  }

  const caption = post.posts.caption || "";

  if (images.length === 1) {
    const media = await metaPost<{ id: string }>(`/${igUserId}/media`, {
      access_token: account.access_token,
      image_url: images[0],
      caption,
    });
    await waitForInstagramContainer(media.id, account.access_token);
    await metaPost(`/${igUserId}/media_publish`, {
      access_token: account.access_token,
      creation_id: media.id,
    });
    return;
  }

  // Carousel
  const childIds: string[] = [];
  for (const imageUrl of images) {
    const child = await metaPost<{ id: string }>(`/${igUserId}/media`, {
      access_token: account.access_token,
      image_url: imageUrl,
      is_carousel_item: "true",
    });
    await waitForInstagramContainer(child.id, account.access_token);
    childIds.push(child.id);
  }

  const parent = await metaPost<{ id: string }>(`/${igUserId}/media`, {
    access_token: account.access_token,
    media_type: "CAROUSEL",
    children: childIds.join(","),
    caption,
  });
  await waitForInstagramContainer(parent.id, account.access_token);
  await metaPost(`/${igUserId}/media_publish`, {
    access_token: account.access_token,
    creation_id: parent.id,
  });
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
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const nowIso = new Date().toISOString();

  const { data: scheduledPosts, error: scheduleError } = await admin
    .from("scheduled_posts")
    .select(
      "id, platform, post_id, scheduled_for, retry_count, posts!inner(id,user_id,caption,image_url)",
    )
    .eq("status", "scheduled")
    .lte("scheduled_for", nowIso)
    .order("scheduled_for", { ascending: true })
    .limit(BATCH_LIMIT);

  if (scheduleError) {
    console.error("publish-scheduled: query error", scheduleError.message);
    return new Response(JSON.stringify({ error: "Internal error." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const items = (scheduledPosts ?? []) as unknown as ScheduledRow[];
  const results: { id: string; success: boolean; message: string }[] = [];

  for (const item of items) {
    try {
      const { data: account, error: accountError } = await admin
        .from("social_accounts")
        .select(
          "provider, access_token, meta_page_id, instagram_account_id, refresh_token, account_name",
        )
        .eq("user_id", item.posts.user_id)
        .eq("provider", item.platform)
        .single();

      if (accountError || !account) {
        throw new Error(`No connected ${item.platform} account.`);
      }

      let decryptedToken: string;
      try {
        decryptedToken = await decryptAccessToken(
          (account as SocialAccountRow).access_token,
        );
      } catch {
        throw new Error(
          `Failed to decrypt access token for ${item.platform}. Re-connect the account.`,
        );
      }

      const accountWithToken: SocialAccountRow = {
        ...(account as SocialAccountRow),
        access_token: decryptedToken,
      };

      if (item.platform === "facebook") {
        await publishFacebook(item, accountWithToken);
      } else {
        await publishInstagram(item, accountWithToken);
      }

      // --- Post-publish: delete images from Supabase Storage ---
      try {
        const images = parseStoredImages(item.posts.image_url);
        if (images.length > 0) {
          const storagePaths = images
            .map((url) => {
              try {
                const urlObj = new URL(url);
                const parts = urlObj.pathname.split("/post-media/");
                return parts.length === 2 ? parts[1] : null;
              } catch {
                return null;
              }
            })
            .filter((p): p is string => p !== null);

          if (storagePaths.length > 0) {
            const { error: delErr } = await admin.storage
              .from("post-media")
              .remove(storagePaths);
            if (delErr) {
              console.error(
                `Image cleanup failed for post ${item.id}:`,
                delErr,
              );
            }
          }
        }
      } catch (cleanupErr) {
        console.error(`Cleanup error for post ${item.id}:`, cleanupErr);
      }
      // ---------------------------------------------------------

      await admin
        .from("scheduled_posts")
        .update({
          status: "published",
          published_at: new Date().toISOString(),
          error_message: null,
        })
        .eq("id", item.id);

      await admin
        .from("posts")
        .update({ status: "published" })
        .eq("id", item.post_id);

      results.push({ id: item.id, success: true, message: "Published" });
    } catch (error: unknown) {
      const errorMsg =
        error instanceof Error ? error.message : "Publish failed";
      const newRetryCount = (item.retry_count ?? 0) + 1;

      if (newRetryCount >= MAX_RETRIES) {
        await admin
          .from("scheduled_posts")
          .update({
            status: "failed",
            retry_count: newRetryCount,
            error_message: errorMsg.slice(0, 1000),
          })
          .eq("id", item.id);

        // Permanently failed — clean up images from storage so they don't
        // accumulate in the bucket indefinitely.
        try {
          const images = parseStoredImages(item.posts.image_url);
          if (images.length > 0) {
            const storagePaths = images
              .map((url) => {
                try {
                  const urlObj = new URL(url);
                  const parts = urlObj.pathname.split("/post-media/");
                  return parts.length === 2 ? parts[1] : null;
                } catch {
                  return null;
                }
              })
              .filter((p): p is string => p !== null);
            if (storagePaths.length > 0) {
              await admin.storage.from("post-media").remove(storagePaths);
            }
          }
        } catch (cleanupErr) {
          console.error(
            `Failed-post image cleanup error for ${item.id}:`,
            cleanupErr,
          );
        }
      } else {
        await admin
          .from("scheduled_posts")
          .update({
            retry_count: newRetryCount,
            error_message: errorMsg.slice(0, 1000),
          })
          .eq("id", item.id);
      }

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
