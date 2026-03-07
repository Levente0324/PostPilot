"use client";

import { PostScheduler } from "./PostScheduler";
import { usePostDashboard } from "./PostDashboardContext";

export function PostsDashboardClient({
  scheduledPosts,
}: {
  scheduledPosts: any[];
}) {
  const { schedulerRef } = usePostDashboard();

  return (
    <div className="p-4 md:px-8 md:py-4 relative z-0 bg-light-background">
      <div className="max-w-[1400px] mx-auto bg-light-background">
        <PostScheduler ref={schedulerRef} scheduledPosts={scheduledPosts} />
      </div>
    </div>
  );
}
