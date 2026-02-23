import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "http://localhost:3000",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "none",
    {
      cookieOptions: {
        sameSite: "none",
        secure: true,
      },
    },
  );
}
