import { createAdminClient } from "@/lib/supabase/admin";
import { metaGet, metaPost } from "@/lib/meta";
import {
  decodeAccountMeta,
  decryptAccessToken,
  parseStoredImages,
} from "@/lib/social-account";
import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

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

// cron-job.org sends the secret via the x-job-key request header.
function authorized(request: Request) {
  const expected = process.env.PUBLISH_JOB_SECRET;
  if (!expected) return false;

  const jobKey = request.headers.get("x-job-key");
  if (!jobKey) return false;

  const keyBuffer = Buffer.from(jobKey, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (keyBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(keyBuffer, expectedBuffer);
}

async function publishFacebook(post: ScheduledRow, account: SocialAccountRow) {
  const accountMeta = decodeAccountMeta(account.refresh_token);
  const pageId = account.meta_page_id || accountMeta.pageId;

  if (!pageId) {
    throw new Error("Facebook page ID missing.");
  }

  const images = parseStoredImages(post.posts.image_url);
  const message = post.posts.caption || "";

  if (!images.length) {
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

  const mediaFbids: string[] = [];

  for (const imageUrl of images) {
    const uploaded = await metaPost<{ id: string }>(`/${pageId}/photos`, {
      access_token: account.access_token,
      url: imageUrl,
      published: "false",
    });

    mediaFbids.push(uploaded.id);
  }

  const attachedMedia: Record<string, string> = {};
  mediaFbids.forEach((fbid, index) => {
    attachedMedia[`attached_media[${index}]`] = JSON.stringify({
      media_fbid: fbid,
    });
  });

  await metaPost(`/${pageId}/feed`, {
    access_token: account.access_token,
    message,
    ...attachedMedia,
  });
}

async function waitForInstagramContainer(
  creationId: string,
  accessToken: string,
) {
  for (let i = 0; i < 10; i += 1) {
    const status = await metaGet<{ status_code: string }>(`/${creationId}`, {
      access_token: accessToken,
      fields: "status_code",
    });

    if (status.status_code === "FINISHED") {
      return;
    }

    if (status.status_code === "ERROR") {
      throw new Error("Instagram media container failed.");
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error("Instagram media container timed out.");
}

async function publishInstagram(post: ScheduledRow, account: SocialAccountRow) {
  const accountMeta = decodeAccountMeta(account.refresh_token);
  const igUserId = account.instagram_account_id || accountMeta.igUserId;

  if (!igUserId) {
    throw new Error("Instagram user ID missing.");
  }

  const images = parseStoredImages(post.posts.image_url);
  if (!images.length) {
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

export async function POST(request: Request) {
  return handlePublish(request);
}

async function handlePublish(request: Request) {
  // This route has been retired in favour of the Supabase Edge Function
  // (supabase/functions/publish-scheduled/index.ts).
  // Returning 410 Gone so cron-job.org stops retrying this URL and so
  // concurrent calls cannot double-publish alongside the Edge Function.
  return NextResponse.json(
    {
      error:
        "This endpoint has been retired. Use the Supabase Edge Function instead.",
    },
    { status: 410 },
  );

  // ---- DEAD CODE BELOW — kept for reference if route is ever re-enabled ----
  // eslint-disable-next-line no-unreachable
  if (!process.env.PUBLISH_JOB_SECRET) {
    return NextResponse.json(
      { error: "PUBLISH_JOB_SECRET is not configured." },
      { status: 500 },
    );
  }

  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  const { data: scheduledPosts, error: scheduleError } = await admin
    .from("scheduled_posts")
    .select(
      "id, platform, post_id, scheduled_for, retry_count, posts!inner(id,user_id,caption,image_url)",
    )
    .eq("status", "scheduled")
    .lte("scheduled_for", nowIso)
    .order("scheduled_for", { ascending: true })
    .limit(5);

  if (scheduleError) {
    console.error(
      "Publish job: failed to query scheduled_posts",
      scheduleError?.message,
    );
    return NextResponse.json({ error: "Internal error." }, { status: 500 });
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
        decryptedToken = decryptAccessToken(
          (account as SocialAccountRow).access_token,
        );
      } catch {
        throw new Error(
          `Failed to decrypt access token for ${item.platform} account. Re-connect the account.`,
        );
      }

      const accountWithToken = {
        ...(account as SocialAccountRow),
        access_token: decryptedToken,
      };

      if (item.platform === "facebook") {
        await publishFacebook(item, accountWithToken);
      } else {
        await publishInstagram(item, accountWithToken);
      }

      // -- POST PUBLISH CLEANUP: Delete Images from Supabase Bucket --
      try {
        const images = parseStoredImages(item.posts.image_url);
        if (images.length > 0) {
          const storagePaths = images
            .map((url) => {
              try {
                const urlObj = new URL(url);
                const pathParts = urlObj.pathname.split("/post-media/");
                return pathParts.length === 2 ? pathParts[1] : null;
              } catch {
                return null;
              }
            })
            .filter((p): p is string => p !== null);

          if (storagePaths.length > 0) {
            const { error: deletionError } = await admin.storage
              .from("post-media")
              .remove(storagePaths);

            if (deletionError) {
              console.error(
                `Failed to clean up images for post ${item.id}:`,
                deletionError,
              );
            }
          }
        }
      } catch (cleanupError) {
        console.error(`Cleanup logic error for post ${item.id}:`, cleanupError);
      }
      // --------------------------------------------------------------

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
    } catch (error: any) {
      const newRetryCount = (item.retry_count ?? 0) + 1;
      const MAX_RETRIES = 3;

      if (newRetryCount >= MAX_RETRIES) {
        // Permanent failure after exhausting retries
        await admin
          .from("scheduled_posts")
          .update({
            status: "failed",
            retry_count: newRetryCount,
            error_message: (error?.message || "Publish failed").slice(0, 1000),
          })
          .eq("id", item.id);

        // Clean up images from storage so permanently-failed posts
        // don't accumulate files in the bucket indefinitely.
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
        // Keep as scheduled so next cron run retries
        await admin
          .from("scheduled_posts")
          .update({
            retry_count: newRetryCount,
            error_message: (error?.message || "Publish failed").slice(0, 1000),
          })
          .eq("id", item.id);
      }

      results.push({
        id: item.id,
        success: false,
        message: error?.message || "Publish failed",
      });
    }
  }

  // Housekeeping: delete usage_logs older than 90 days to prevent unbounded growth.
  // Cheap query (indexed on created_at), runs every cron tick but only deletes stale rows.
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

  return NextResponse.json({ data: results });
}
