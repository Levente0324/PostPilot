"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/browser";
import { Bot, CheckCircle2, Loader2, Pencil, Sparkles, X } from "lucide-react";

export default function AIOptionsPage() {
  const [aiOptions, setAiOptions] = useState("");
  const [draftValue, setDraftValue] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadOptions() {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          setLoading(false);
          return;
        }

        const { data, error } = await supabase
          .from("profiles")
          .select("ai_options")
          .eq("id", user.id)
          .single();

        if (error) throw error;
        if (data && data.ai_options) {
          setAiOptions(data.ai_options);
        }
      } catch (err: any) {
        console.error("Hiba az AI opciók betöltésekor:", err);
      } finally {
        setLoading(false);
      }
    }
    loadOptions();
  }, []);

  const handleEdit = () => {
    setDraftValue(aiOptions);
    setError(null);
    setSuccess(false);
    setIsEditing(true);
  };

  const handleCancel = () => {
    setDraftValue("");
    setError(null);
    setIsEditing(false);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSuccess(false);
    setError(null);

    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) throw new Error("Nem vagy bejelentkezve.");

      const { error } = await supabase
        .from("profiles")
        .update({ ai_options: draftValue })
        .eq("id", user.id);

      if (error) throw error;

      setAiOptions(draftValue);
      setIsEditing(false);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message || "Hiba történt a mentés során.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-full pb-10">
      <header className="sticky top-0 z-40 h-20 px-4 md:px-8 flex flex-col md:flex-row md:items-center justify-start items-center border-b shadow-sm border-light-clinical-gray bg-light-background">
        <div className="hidden md:block">
          <h1 className="font-sans text-4xl font-medium text-gray-900 tracking-wide leading-none flex items-center gap-3">
            AI Opciók
          </h1>
        </div>
        <div className="h-7 w-11 ml-3 mt-1 flex justify-center items-center rounded-2xl bg-[#CC5833] border border-[#CC5833]">
          <p className="text-sm text-white font-bold uppercase">Új</p>
        </div>

        {/* Mobile Title */}
        <div className="md:hidden pt-2 pb-1">
          <h1 className="font-sans text-xl font-medium text-gray-900 tracking-wide leading-none flex items-center gap-2">
            AI Opciók
          </h1>
        </div>
      </header>

      <div className="p-4 md:p-8 relative z-0">
        <div className="max-w-[800px] mx-auto space-y-6 pb-10">
          <div className="bg-white border border-light-clinical-gray rounded-xl shadow-sm p-6 md:p-8 relative overflow-hidden">
            {/* Ambient glows */}
            <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-light-primary/5 rounded-full blur-[100px] pointer-events-none"></div>

            <div className="relative z-10 space-y-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-sans font-semibold tracking-tight text-gray-900 flex items-center gap-2 mb-2">
                    <Sparkles className="h-5 w-5 text-light-primary" />
                    Mondj el többet magadról!
                  </h2>
                  <p className="text-sm text-gray-500 leading-relaxed">
                    Ez a kontextus segít az AI Assistant-nak, hogy sokkal
                    pontosabb, személyre szabottabb és eladhatóbb szövegeket
                    írjon neked. Írd le mivel foglalkozol, kik a célcsoportod,
                    és milyen a kommunikációs stílusod.
                  </p>
                </div>

                {!loading && !isEditing && (
                  <button
                    type="button"
                    onClick={handleEdit}
                    className="shrink-0 flex items-center gap-1.5 rounded-lg border border-gray-600/50 bg-white px-3 py-2 text-sm font-semibold text-gray-600 hover:border-[#CC5833]/80 hover:bg-light-primary/5 hover:text-[#CC5833] transition-colors shadow-sm hover:cursor-pointer"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Szerkesztés
                  </button>
                )}
              </div>

              {loading ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="h-6 w-6 animate-spin text-[#CC5833]" />
                </div>
              ) : isEditing ? (
                /* Edit mode */
                <form onSubmit={handleSave} className="space-y-4">
                  <textarea
                    value={draftValue}
                    onChange={(e) =>
                      setDraftValue(e.target.value.slice(0, 2000))
                    }
                    maxLength={2000}
                    placeholder="Például: Egy prémium kutyakozmetikát vezetek Budapesten. A célcsoportom a tehetős, kutyájukat családtagnak tekintő gazdik. A kommunikáció aranyos, barátságos, de professzionális."
                    className="w-full h-64 bg-gray-50 border border-gray-200 rounded-xl p-4 text-gray-900 text-sm focus:outline-none focus:border-light-primary focus:ring-1 focus:ring-light-primary/50 transition-all placeholder:text-gray-400 resize-y"
                    autoFocus
                  />

                  <p className="text-xs text-gray-400 text-right">
                    {draftValue.length}/2000 karakter
                  </p>

                  {error && (
                    <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
                      {error}
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={handleCancel}
                      disabled={saving}
                      className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" />
                      Mégsem
                    </button>
                    <button
                      type="submit"
                      disabled={saving}
                      className="flex items-center gap-2 bg-light-primary text-white px-6 py-2.5 rounded-lg font-bold text-sm hover:bg-light-primary-hover transition-colors disabled:opacity-50 shadow-sm"
                    >
                      {saving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Mentés"
                      )}
                    </button>
                  </div>
                </form>
              ) : (
                /* View mode */
                <div className="space-y-4">
                  <textarea
                    value={aiOptions}
                    readOnly
                    rows={10}
                    placeholder="Még nincs megadva kontextus. Kattints a Szerkesztés gombra a megadáshoz."
                    className="w-full h-64 bg-gray-50 border border-gray-200 rounded-xl p-4 text-gray-700 text-sm resize-none cursor-default select-text placeholder:text-gray-400"
                  />

                  {success && (
                    <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      Sikeresen elmentve!
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
