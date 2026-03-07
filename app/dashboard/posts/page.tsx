import { PostScheduler } from "@/components/dashboard/PostScheduler";
import { createClient } from "@/lib/supabase/server";
import { getPostLimit } from "@/lib/subscription";
import { redirect } from "next/navigation";
import { HeaderNewPostButton } from "@/components/dashboard/HeaderNewPostButton";
import { PostDashboardProvider } from "@/components/dashboard/PostDashboardContext";
import { PostsDashboardClient } from "@/components/dashboard/PostsDashboardClient";

export default async function PostsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("plan, subscription_status")
    .eq("id", user.id)
    .single();

  const { data: scheduledRows } = await supabase
    .from("scheduled_posts")
    .select(
      "id, scheduled_for, status, posts!inner(user_id, caption, image_url)",
    )
    .eq("posts.user_id", user.id)
    .eq("status", "scheduled")
    .order("scheduled_for", { ascending: true });

  const scheduledPosts = (scheduledRows ?? []).map((row) => ({
    id: row.id,
    scheduled_for: row.scheduled_for,
    caption: (row.posts as any).caption,
    image_url: (row.posts as any).image_url,
  })) as {
    id: string;
    scheduled_for: string;
    caption: string | null;
    image_url: string | null;
  }[];
  const activeLimit = getPostLimit(profile);
  const usagePercent =
    activeLimit > 0
      ? Math.round((scheduledPosts.length / activeLimit) * 100)
      : 0;

  return (
    <PostDashboardProvider>
      <div className="flex-1 flex flex-col h-full bg-light-background">
        {/* Sticky Header */}
        <header className="sticky top-0 z-20 bg-light-background border-b border-light-clinical-gray shadow-sm px-4 md:px-8 py-4 md:py-[17.5px] flex flex-col md:flex-row md:items-center justify-between">
          <div className="flex items-center justify-between md:justify-start w-full md:w-auto">
            <h1 className="hidden md:block font-sans font-medium text-2xl md:text-4xl tracking-tight text-gray-900 leading-none">
              Ütemező Naptár
            </h1>
          </div>

          {/* Mobile Title (visible only below md) */}
          <div className="md:hidden pt-2 pb-1 cursor-default">
            <h1 className="font-sans text-xl font-medium text-gray-900 tracking-wide leading-none">
              Ütemező Naptár
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-3 md:gap-6 mt-2 md:mt-0">
            <div className="flex items-center gap-4">
              <div className="hidden md:flex items-center gap-2 px-4 py-2 bg-white border border-light-clinical-gray rounded text-xs font-medium">
                <span className="w-2 h-2 rounded-full bg-green-500"></span>
                <span className="text-gray-900">
                  {scheduledPosts.length} / {activeLimit} aktív poszt
                </span>
              </div>
              <HeaderNewPostButton />
            </div>
          </div>
        </header>

        <PostsDashboardClient scheduledPosts={scheduledPosts} />
      </div>
    </PostDashboardProvider>
  );
}
