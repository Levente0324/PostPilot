"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  Facebook,
  Instagram,
  Loader2,
  Unplug,
} from "lucide-react";

function getTokenStatus(
  expiresAt: string | null,
): "ok" | "expiring" | "expired" {
  if (!expiresAt) return "ok";
  const expiry = new Date(expiresAt).getTime();
  const now = Date.now();
  if (expiry <= now) return "expired";
  // Warn 7 days before expiry
  if (expiry - now <= 7 * 24 * 60 * 60 * 1000) return "expiring";
  return "ok";
}

function getDaysUntilExpiry(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  const diff = new Date(expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)));
}

type SocialAccount = {
  provider: string;
  account_name: string | null;
  expires_at: string | null;
};

type Props = {
  facebook: SocialAccount | null;
  instagram: SocialAccount | null;
};

export function SocialConnections({ facebook, instagram }: Props) {
  const router = useRouter();
  const [loadingProvider, setLoadingProvider] = useState<
    "facebook" | "instagram" | null
  >(null);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  const disconnect = async (provider: "facebook" | "instagram") => {
    setLoadingProvider(provider);
    setDisconnectError(null);

    try {
      const response = await fetch("/api/meta/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });

      if (!response.ok) {
        const payload = await response.json();
        setDisconnectError(payload.error || "A kapcsolat bontása sikertelen.");
        return;
      }

      router.refresh();
    } catch {
      setDisconnectError("Hálózati hiba történt a kapcsolat bontásakor.");
    } finally {
      setLoadingProvider(null);
    }
  };

  return (
    <div className="space-y-4">
      {disconnectError && (
        <p className="rounded-xl border border-red-200 bg-red-50/80 px-4 py-2.5 text-sm text-red-700">
          {disconnectError}
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Facebook */}
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-5 hover:border-gray-300 transition-colors flex flex-col">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1877F2]/10 border border-[#1877F2]/20">
                <Facebook className="h-4 w-4 text-[#1877F2]" />
              </div>
              <h3 className="font-bold text-gray-900">Facebook</h3>
            </div>
            <span
              className={`text-[10px] font-mono font-bold uppercase tracking-widest px-2 py-0.5 rounded border ${facebook ? "bg-green-50 text-green-700 border-green-200" : "bg-gray-100 text-gray-400 border-gray-200"}`}
            >
              {facebook ? "Kapcsolva" : "Nincs kapcsolva"}
            </span>
          </div>

          <p className="text-sm text-gray-500 mb-4 h-5 truncate">
            {facebook?.account_name || "Nincs Facebook oldal kapcsolva."}
          </p>

          {facebook && getTokenStatus(facebook.expires_at) !== "ok" && (
            <div
              className={`flex items-start gap-2 rounded-lg px-3 py-2 mb-3 text-xs font-medium ${
                getTokenStatus(facebook.expires_at) === "expired"
                  ? "bg-red-50 border border-red-200 text-red-700"
                  : "bg-amber-50 border border-amber-200 text-amber-700"
              }`}
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                {getTokenStatus(facebook.expires_at) === "expired"
                  ? "A token lejárt! Csatlakoztasd újra a fiókod az ütemezés folytatásához."
                  : `A token ${getDaysUntilExpiry(facebook.expires_at)} nap múlva lejár. Csatlakoztasd újra a fiókod.`}
              </span>
            </div>
          )}

          <div className="mt-auto pt-2">
            {facebook ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void disconnect("facebook")}
                disabled={loadingProvider === "facebook"}
                className="w-full bg-white border-gray-200 text-gray-600 hover:bg-red-50 hover:border-red-200 hover:text-red-700 transition-colors"
              >
                {loadingProvider === "facebook" ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Unplug className="h-4 w-4 mr-2" />
                )}
                Kapcsolat bontása
              </Button>
            ) : (
              <Button
                size="sm"
                className="w-full bg-[#1877F2]/90 text-white hover:bg-[#1877F2] rounded-lg shadow-[0_4px_14px_rgba(24,119,242,0.3)] transition-all"
                onClick={() => {
                  window.location.href = "/api/meta/connect?provider=facebook";
                }}
              >
                Facebook kapcsolása
              </Button>
            )}
          </div>
        </div>

        {/* Instagram */}
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-5 hover:border-gray-300 transition-colors flex flex-col">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-tr from-[#FF6B35]/10 to-[#FF1493]/10 border border-[#E4405F]/20">
                <Instagram className="h-4 w-4 text-[#E4405F]" />
              </div>
              <h3 className="font-bold text-gray-900">Instagram</h3>
            </div>
            <span
              className={`text-[10px] font-mono font-bold uppercase tracking-widest px-2 py-0.5 rounded border ${instagram ? "bg-green-50 text-green-700 border-green-200" : "bg-gray-100 text-gray-400 border-gray-200"}`}
            >
              {instagram ? "Kapcsolva" : "Nincs kapcsolva"}
            </span>
          </div>

          <p className="text-sm text-gray-500 mb-4 h-5 truncate">
            {instagram?.account_name ||
              "Nincs Instagram üzleti fiók kapcsolva."}
          </p>

          {instagram && getTokenStatus(instagram.expires_at) !== "ok" && (
            <div
              className={`flex items-start gap-2 rounded-lg px-3 py-2 mb-3 text-xs font-medium ${
                getTokenStatus(instagram.expires_at) === "expired"
                  ? "bg-red-50 border border-red-200 text-red-700"
                  : "bg-amber-50 border border-amber-200 text-amber-700"
              }`}
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                {getTokenStatus(instagram.expires_at) === "expired"
                  ? "A token lejárt! Csatlakoztasd újra a fiókod az ütemezés folytatásához."
                  : `A token ${getDaysUntilExpiry(instagram.expires_at)} nap múlva lejár. Csatlakoztasd újra a fiókod.`}
              </span>
            </div>
          )}

          <div className="mt-auto pt-2">
            {instagram ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void disconnect("instagram")}
                disabled={loadingProvider === "instagram"}
                className="w-full bg-white border-gray-200 text-gray-600 hover:bg-red-50 hover:border-red-200 hover:text-red-700 transition-colors"
              >
                {loadingProvider === "instagram" ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Unplug className="h-4 w-4 mr-2" />
                )}
                Kapcsolat bontása
              </Button>
            ) : (
              <Button
                size="sm"
                className="w-full bg-gradient-to-r from-[#E4405F] to-[#C13584] text-white hover:opacity-90 rounded-lg shadow-[0_4px_14px_rgba(228,64,95,0.3)] transition-all"
                onClick={() => {
                  window.location.href = "/api/meta/connect?provider=instagram";
                }}
              >
                Instagram kapcsolása
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
