import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/** Simple UUID v4 format validator */
function isValidUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Validate UUID format before hitting the DB — prevents malformed-UUID errors
  // from leaking as 500s and stops trivial enumeration attempts.
  if (!isValidUUID(id)) {
    return NextResponse.json(
      { error: "Scheduled post not found." },
      { status: 404 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: scheduledPost, error: lookupError } = await supabase
    .from("scheduled_posts")
    .select("id, post_id, posts!inner(user_id, image_url)")
    .eq("id", id)
    .eq("posts.user_id", user.id)
    .single();

  if (lookupError || !scheduledPost) {
    return NextResponse.json(
      { error: "Scheduled post not found." },
      { status: 404 },
    );
  }

  const { error: deleteError } = await supabase
    .from("posts")
    .delete()
    .eq("id", scheduledPost.post_id)
    .eq("user_id", user.id);

  if (deleteError) {
    return NextResponse.json(
      { error: "Failed to delete scheduled post." },
      { status: 500 },
    );
  }

  // Clean up uploaded images from storage (non-fatal — post is already deleted).
  // Use parseStoredImages for consistency: handles JSON array, comma-separated,
  // and plain single-URL formats that may exist in legacy records.
  const imageUrl = (scheduledPost.posts as any)?.image_url;
  if (imageUrl) {
    try {
      const { parseStoredImages } = await import("@/lib/social-account");
      const urls = parseStoredImages(imageUrl);
      const paths = urls
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

      if (paths.length > 0) {
        await supabase.storage.from("post-media").remove(paths);
      }
    } catch {
      // Non-fatal: post is already deleted, image cleanup is best-effort
    }
  }

  return NextResponse.json({ success: true });
}
