"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

type Props = {
  planLabel: string;
  isPro: boolean;
  isElite?: boolean;
  userEmail: string;
};

export function Sidebar({ planLabel, isPro, isElite, userEmail }: Props) {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  };

  const isPaid = isPro || isElite;

  const getNavClass = (href: string) => {
    const active = pathname === href || pathname.startsWith(href + "/");
    return `group flex items-center gap-3 px-3 py-2.5 rounded transition-all ${
      active
        ? "bg-light-moss-highlight text-white font-medium"
        : "text-gray-400 hover:text-white hover:bg-white/5"
    }`;
  };

  const getIconClass = (href: string) => {
    return `material-symbols-outlined text-[22px] transition-colors`;
  };

  return (
    <aside className="bg-light-surface-dark flex w-full flex-col justify-between text-gray-400 h-full relative z-10 md:w-64 border-r border-white/5">
      <div>
        {/* Logo */}
        <div className="h-20 flex items-center px-6 border-b border-white/5 mb-4">
          <Link
            href="/"
            className="flex items-center gap-3 transition-transform hover:scale-105"
          >
            <div className="w-8 h-8 rounded bg-light-primary flex items-center justify-center text-white">
              <span className="material-symbols-outlined text-white text-[20px]">
                rocket_launch
              </span>
            </div>
            <span className="font-display text-2xl font-bold tracking-tight text-white/90">
              PostRocket
            </span>
          </Link>
        </div>

        {/* Navigáció */}
        <div className="px-3">
          <nav className="flex flex-col gap-1">
            <Link
              href="/dashboard/posts"
              className={getNavClass("/dashboard/posts")}
            >
              <span className={getIconClass("/dashboard/posts")}>
                calendar_month
              </span>
              <span className="font-medium text-sm">Ütemező Naptár</span>
            </Link>
            <Link
              href="/dashboard/ai-options"
              className={getNavClass("/dashboard/ai-options")}
            >
              <span className={getIconClass("/dashboard/ai-options")}>
                auto_awesome
              </span>
              <span className="font-medium text-sm">AI Opciók</span>
            </Link>
            <Link
              href="/dashboard/insights"
              className={getNavClass("/dashboard/insights")}
            >
              <span className={getIconClass("/dashboard/insights")}>
                insights
              </span>
              <span className="font-medium text-sm">Insights</span>
            </Link>

            <div className="my-4 border-t border-white/5 mx-2"></div>

            <Link
              href="/dashboard/account-billing"
              className={getNavClass("/dashboard/account-billing")}
            >
              <span className={getIconClass("/dashboard/account-billing")}>
                settings
              </span>
              <span className="font-medium text-sm">Beállítások</span>
            </Link>
          </nav>
        </div>
      </div>

      <div className="mt-auto">
        {/* User Block */}
        <div className="p-4 border-t border-white/5 bg-black/20 flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded bg-[#0F1612] border border-white/10 flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-white/60 text-[20px]">
                person
              </span>
            </div>
            <div className="overflow-hidden flex-1">
              <p className="text-sm font-bold text-white tracking-widest uppercase truncate pb-0.5">
                {userEmail.split("@")[0]}
              </p>
              <p className="text-[10px] text-light-moss-highlight font-bold uppercase">
                {planLabel}
              </p>
            </div>
            <button
              onClick={handleLogout}
              className="text-white/40 hover:text-red-500 transition-colors"
              title="Kijelentkezés"
            >
              <span className="material-symbols-outlined text-[20px]">
                logout
              </span>
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
