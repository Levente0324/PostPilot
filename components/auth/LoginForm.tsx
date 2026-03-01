"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { Loader2 } from "lucide-react";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signUpMode, setSignUpMode] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const router = useRouter();

  // NOTE: Removed auto-signOut on mount — it was a dev-only hack that
  // would destroy active sessions if a logged-in user ever hit /login
  // before the middleware redirect took effect.

  const handleAuth = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    const toHungarianError = (message: string): string => {
      const m = message.toLowerCase();
      if (
        m.includes("invalid login credentials") ||
        (m.includes("email not confirmed") && signUpMode === false)
      )
        return "Hibás e-mail cím vagy jelszó. Ellenőrizd az adatokat és próbáld újra.";
      if (m.includes("email not confirmed"))
        return "Az e-mail cím még nincs megerősítve. Ellenőrizd a postaládád.";
      if (m.includes("too many requests") || m.includes("rate limit"))
        return "Túl sok próbálkozás. Kérlek, várj egy percet és próbáld újra.";
      if (
        m.includes("user already registered") ||
        m.includes("already been registered")
      )
        return "Ez az e-mail cím már regisztrált. Próbálj bejelentkezni.";
      if (
        m.includes("password should be at least") ||
        m.includes("password is too short")
      )
        return "A jelszónak legalább 6 karakterből kell állnia.";
      if (m.includes("invalid email"))
        return "Érvénytelen e-mail cím formátum.";
      if (m.includes("signup is disabled"))
        return "A regisztráció átmenetileg le van tiltva.";
      return "Sikertelen hitelesítés. Ellenőrizd az e-mail és jelszó párost.";
    };

    try {
      const supabase = createClient();
      if (signUpMode) {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });

        if (signUpError) throw signUpError;

        if (data.session) {
          window.location.href = "/dashboard/posts";
        } else {
          setSuccess(
            "Ellenőrizd az e-mail fiókodat, és erősítsd meg a regisztrációt.",
          );
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (signInError) throw signInError;

        window.location.href = "/dashboard/posts";
      }
    } catch (authError: any) {
      setError(toHungarianError(authError.message ?? ""));
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleAuth} className="space-y-5">
      <div className="mb-6">
        <h2 className="text-2xl font-extrabold tracking-tight text-[#1A1A1A]">
          {signUpMode ? "Fiók létrehozása" : "Bejelentkezés"}
        </h2>
        <p className="mt-1 text-sm text-[#4a4a4a]">
          {signUpMode
            ? "Hozz létre ingyenes fiókot — 3 poszt mindig elérhető."
            : "Üdvözlünk vissza! Add meg az adataid."}
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50/80 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-xl border border-[#2E4036]/20 bg-[#2E4036]/08 px-4 py-3 text-sm text-[#2E4036]">
          {success}
        </div>
      )}

      <div className="space-y-1.5">
        <label
          htmlFor="auth-email"
          className="block text-sm font-semibold text-[#1A1A1A]"
        >
          E-mail cím
        </label>
        <input
          id="auth-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          placeholder="te@vallalkozas.hu"
          className="input-organic"
        />
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="auth-password"
          className="block text-sm font-semibold text-[#1A1A1A]"
        >
          Jelszó
        </label>
        <input
          id="auth-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          placeholder="Legalább 8 karakter"
          className="input-organic"
        />
        {signUpMode && (
          <p className="text-xs text-[#4a4a4a]">
            Minimum 8 karakter szükséges.
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={loading}
        className="btn-clay w-full py-3.5 text-base disabled:opacity-60"
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Kérlek várj...
          </span>
        ) : signUpMode ? (
          "Fiók létrehozása"
        ) : (
          "Bejelentkezés"
        )}
      </button>

      <button
        type="button"
        onClick={() => {
          setSignUpMode((prev) => !prev);
          setError(null);
          setSuccess(null);
        }}
        className="w-full text-center text-sm text-[#4a4a4a] transition hover:text-[#2E4036]"
      >
        {signUpMode
          ? "Van már fiókod? Jelentkezz be"
          : "Nincs még fiókod? Regisztrálj ingyen"}
      </button>
    </form>
  );
}
