"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import { createPortal } from "react-dom";
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfDay,
  endOfMonth,
  format,
  isSameDay,
  parse,
  parseISO,
  startOfDay,
  startOfMonth,
  subMonths,
} from "date-fns";
import { hu } from "date-fns/locale";
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Facebook,
  ImagePlus,
  Instagram,
  Loader2,
  Lock,
  Sparkles,
  Trash2,
  X,
  Plus,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { gsap } from "gsap";
import dynamic from "next/dynamic";
import { createClient as createSupabaseBrowserClient } from "@/lib/supabase/browser";

const EmojiPicker = dynamic(
  () => {
    return import("emoji-picker-react");
  },
  { ssr: false },
);

// Allowed MIME types for direct-to-Supabase uploads
const ALLOWED_UPLOAD_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
};
const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024; // 10MB per file — plenty for social media
const MAX_UPLOAD_TOTAL_BYTES = 30 * 1024 * 1024; // 30MB total per upload session

type ScheduledPost = {
  id: string;
  platform: "facebook" | "instagram";
  scheduled_for: string;
  caption: string | null;
  image_url: string | null;
};

type ProfileSummary = {
  plan: string | null;
  subscription_status: string | null;
};

type SelectedImage = {
  id: string;
  name: string;
  url: string;
};

type Props = {
  scheduledPosts: ScheduledPost[];
  profile: ProfileSummary;
  connectedPlatforms: Array<"facebook" | "instagram">;
};

const WEEK_DAYS = [
  { short: "H", full: "Hétfő" },
  { short: "K", full: "Kedd" },
  { short: "Sze", full: "Szerda" },
  { short: "Cs", full: "Csütörtök" },
  { short: "P", full: "Péntek" },
  { short: "Szo", full: "Szombat" },
  { short: "V", full: "Vasárnap" },
];

const DeleteConfirmModal = ({
  onConfirm,
  onCancel,
  loading,
}: {
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) => {
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4 backdrop-blur-md transition-all">
      <div className="bg-white rounded-2xl border border-light-clinical-gray shadow-2xl w-full max-w-sm p-6 text-gray-900 animate-in zoom-in-95 duration-200">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
          <Trash2 className="h-6 w-6 text-red-600" />
        </div>
        <h3 className="mb-2 text-lg font-bold">Poszt törlése</h3>
        <p className="mb-6 text-sm text-gray-500">
          Biztosan törölni szeretnéd ezt az időzített posztot? Ezt a műveletet
          később nem vonhatod vissza.
        </p>
        <div className="flex items-center gap-3">
          <button
            disabled={loading}
            onClick={onCancel}
            className="flex-1 rounded-xl border border-light-clinical-gray bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-200 disabled:opacity-50"
          >
            Mégsem
          </button>
          <button
            disabled={loading}
            onClick={onConfirm}
            className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50 flex justify-center items-center"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Törlés"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export interface PostSchedulerRef {
  openWizardToday: () => void;
}

export const PostScheduler = forwardRef<PostSchedulerRef, Props>(
  function PostScheduler(
    { scheduledPosts, profile, connectedPlatforms },
    ref: React.Ref<PostSchedulerRef>,
  ) {
    const router = useRouter();
    const rootRef = useRef<HTMLDivElement>(null);
    const timeRef = useRef<HTMLInputElement>(null);

    const [viewMonth, setViewMonth] = useState(new Date());
    const [selectedDate, setSelectedDate] = useState<Date | null>(null);
    const [showWizard, setShowWizard] = useState(false);
    const [platform, setPlatform] = useState<"facebook" | "instagram">(
      "instagram",
    );
    const [description, setDescription] = useState("");
    const [text, setText] = useState("");
    const [time, setTime] = useState("09:00");
    const [images, setImages] = useState<SelectedImage[]>([]);

    useImperativeHandle(ref, () => ({
      openWizardToday: () => {
        openDateChoice(new Date());
      },
    }));
    const [uploading, setUploading] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    // AI State
    const [showAIAssistant, setShowAIAssistant] = useState(false);
    const [aiPrompt, setAiPrompt] = useState("");
    const [aiTone, setAiTone] = useState("Szakmai");
    const [isGenerating, setIsGenerating] = useState(false);
    const [aiError, setAiError] = useState<string | null>(null);

    const [editingPostId, setEditingPostId] = useState<string | null>(null);
    const [postToDelete, setPostToDelete] = useState<string | null>(null);
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    // Tracks image URLs that existed when the modal opened (for edit).
    // Used to determine which images are newly uploaded and need cleanup on cancel.
    const [originalImageUrls, setOriginalImageUrls] = useState<Set<string>>(
      new Set(),
    );
    const emojiButtonRef = useRef<HTMLButtonElement>(null);
    const emojiPickerRef = useRef<HTMLDivElement>(null);
    const [emojiPickerPos, setEmojiPickerPos] = useState<{
      top: number;
      left: number;
    } | null>(null);

    const now = new Date();
    const minDate = startOfDay(now);
    const maxDate = endOfDay(addDays(minDate, 30));
    const proAccess =
      (profile.plan === "pro" || profile.plan === "elite") &&
      (profile.subscription_status === "active" ||
        profile.subscription_status === "trialing");

    useEffect(() => {
      if (!rootRef.current) return;
      const ctx = gsap.context(() => {
        gsap.fromTo(
          "[data-dash-reveal]",
          { opacity: 0, y: 20 },
          {
            opacity: 1,
            y: 0,
            duration: 0.7,
            stagger: 0.08,
            ease: "power3.out",
          },
        );
      }, rootRef);
      return () => ctx.revert();
    }, []);

    // Close emoji picker when clicking outside both the button AND the picker
    useEffect(() => {
      if (!showEmojiPicker) return;
      const handler = (e: MouseEvent) => {
        const target = e.target as Node;
        const insideButton = emojiButtonRef.current?.contains(target) ?? false;
        const insidePicker = emojiPickerRef.current?.contains(target) ?? false;
        if (!insideButton && !insidePicker) {
          setShowEmojiPicker(false);
        }
      };
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }, [showEmojiPicker]);

    const daysInMonth = useMemo(
      () =>
        eachDayOfInterval({
          start: startOfMonth(viewMonth),
          end: endOfMonth(viewMonth),
        }),
      [viewMonth],
    );

    const connectedSet = useMemo(
      () => new Set(connectedPlatforms),
      [connectedPlatforms],
    );
    const hasAnyConnectedPlatform = connectedPlatforms.length > 0;

    const postsByDay = useMemo(() => {
      const map = new Map<string, ScheduledPost[]>();
      for (const post of scheduledPosts) {
        const key = format(parseISO(post.scheduled_for), "yyyy-MM-dd");
        const bucket = map.get(key) ?? [];
        bucket.push(post);
        map.set(key, bucket);
      }
      return map;
    }, [scheduledPosts]);

    const selectedDateKey = selectedDate
      ? format(selectedDate, "yyyy-MM-dd")
      : "";
    const selectedDayPosts = selectedDate
      ? (postsByDay.get(selectedDateKey) ?? [])
      : [];
    const selectedDayPlatforms = new Set(
      selectedDayPosts.map((p) => p.platform),
    );
    const availablePlatformCount =
      Number(
        connectedSet.has("facebook") && !selectedDayPlatforms.has("facebook"),
      ) +
      Number(
        connectedSet.has("instagram") && !selectedDayPlatforms.has("instagram"),
      );
    const dayAtLimit =
      selectedDayPlatforms.has("facebook") &&
      selectedDayPlatforms.has("instagram");

    const resetWizard = () => {
      // Determine default platform based on connections if nothing selected
      if (
        connectedSet.has("instagram") &&
        !selectedDayPlatforms.has("instagram")
      ) {
        setPlatform("instagram");
      } else if (
        connectedSet.has("facebook") &&
        !selectedDayPlatforms.has("facebook")
      ) {
        setPlatform("facebook");
      } else if (connectedSet.has("instagram")) {
        setPlatform("instagram");
      } else {
        setPlatform("facebook");
      }
      setDescription("");
      setText("");
      setTime("09:00");
      setImages([]);
      setError(null);
      setShowAIAssistant(false);
      setAiPrompt("");
      setIsGenerating(false);
      setAiError(null);
      setEditingPostId(null);
      setShowEmojiPicker(false);
      setOriginalImageUrls(new Set());
    };

    const openEditChoice = (post: ScheduledPost) => {
      setEditingPostId(post.id);
      setSelectedDate(parseISO(post.scheduled_for));
      setPlatform(post.platform);

      if (post.platform === "instagram") {
        setDescription(post.caption || "");
        setText("");
      } else {
        setText(post.caption || "");
        setDescription("");
      }

      try {
        if (post.image_url) {
          const parsedUrls = JSON.parse(post.image_url) as string[];
          const loadedImages: SelectedImage[] = parsedUrls.map((url, i) => ({
            id: `edit-${i}-${Date.now()}`,
            name: "Korábbi kép",
            url,
          }));
          setImages(loadedImages);
          setOriginalImageUrls(new Set(parsedUrls));
        } else {
          setImages([]);
          setOriginalImageUrls(new Set());
        }
      } catch {
        setImages([]);
        setOriginalImageUrls(new Set());
      }

      setTime(format(parseISO(post.scheduled_for), "HH:mm"));
      setShowWizard(true);
      setShowEmojiPicker(false);
      setError(null);
      setSuccessMessage(null);
    };

    const openDateChoice = (date: Date) => {
      if (!hasAnyConnectedPlatform) {
        setError(
          "Ütemezés előtt csatlakoztass Facebook vagy Instagram fiókot a Fiók és számlázás oldalon.",
        );
        return;
      }
      setSelectedDate(date);
      setShowWizard(true);
      setError(null);
      setSuccessMessage(null);
      resetWizard();
    };

    const closeAllModals = () => {
      setShowWizard(false);
      setSelectedDate(null);
      setError(null);
      setShowEmojiPicker(false);
    };

    /** Called when user explicitly cancels / closes without saving.
     *  Deletes any newly uploaded images that aren't part of the saved post. */
    const cancelAndCloseModal = () => {
      const newlyUploadedUrls = images
        .map((img) => img.url)
        .filter((url) => !originalImageUrls.has(url));
      for (const url of newlyUploadedUrls) {
        fetch(`/api/uploads?url=${encodeURIComponent(url)}`, {
          method: "DELETE",
        }).catch(() => {});
      }
      closeAllModals();
    };

    const uploadFiles = async (files: FileList | null) => {
      if (!files?.length) return;
      if (images.length >= 10) {
        setError("Posztonként legfeljebb 10 kép csatolható.");
        return;
      }
      const remainingSlots = 10 - images.length;
      const selectedFiles = Array.from(files).slice(0, remainingSlots);
      if (!selectedFiles.length) {
        setError("Posztonként legfeljebb 10 kép csatolható.");
        return;
      }
      if (Array.from(files).length > remainingSlots) {
        setError(
          `Már csak ${remainingSlots} kép adható hozzá (maximum 10/poszt).`,
        );
      } else {
        setError(null);
      }

      // Client-side validation before upload
      const totalNewBytes = selectedFiles.reduce((sum, f) => sum + f.size, 0);
      if (totalNewBytes > MAX_UPLOAD_TOTAL_BYTES) {
        setError(
          `A kijelölt képek összmérete meghaladja a 30MB-os korlátot. Kérlek, válassz kevesebb vagy kisebb képet.`,
        );
        return;
      }
      for (const file of selectedFiles) {
        if (!ALLOWED_UPLOAD_TYPES[file.type]) {
          setError(
            `A(z) "${file.name}" formátuma nem támogatott. Csak képfájlok tölthetők fel.`,
          );
          return;
        }
        if (file.size > MAX_UPLOAD_SIZE_BYTES) {
          setError(
            `A(z) "${file.name}" fájl túl nagy. A maximális méret képenként 10MB.`,
          );
          return;
        }
      }

      setUploading(true);
      try {
        // Upload directly to Supabase Storage — bypasses Vercel entirely.
        // No 4.5 MB body limit, max file size is Supabase's 50 MB cap.
        const supabase = createSupabaseBrowserClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          setError("Nincs bejelentkezve.");
          return;
        }

        const toAppend: SelectedImage[] = [];

        for (let i = 0; i < selectedFiles.length; i++) {
          const file = selectedFiles[i];
          const extension = ALLOWED_UPLOAD_TYPES[file.type] || "jpg";
          const storagePath = `${user.id}/${Date.now()}-${crypto.randomUUID()}.${extension}`;

          const { error: uploadError } = await supabase.storage
            .from("post-media")
            .upload(storagePath, file, {
              contentType: file.type,
              upsert: false,
            });

          if (uploadError) {
            setError(`A kép feltöltése sikertelen: ${file.name}.`);
            // Clean up already-uploaded files from this batch
            const pathsToClean = toAppend
              .map((img) => {
                try {
                  const urlObj = new URL(img.url);
                  const parts = urlObj.pathname.split("/post-media/");
                  return parts.length === 2 ? parts[1] : null;
                } catch {
                  return null;
                }
              })
              .filter((p): p is string => p !== null);
            if (pathsToClean.length > 0) {
              await supabase.storage.from("post-media").remove(pathsToClean);
            }
            return;
          }

          const { data: urlData } = supabase.storage
            .from("post-media")
            .getPublicUrl(storagePath);

          toAppend.push({
            id: `${Date.now()}-${i}-${Math.random().toString(16).slice(2)}`,
            name: file.name || "kép",
            url: urlData.publicUrl,
          });
        }

        setImages((prev) => [...prev, ...toAppend]);
      } catch {
        setError("Hálózati hiba történt képfeltöltés közben.");
      } finally {
        setUploading(false);
      }
    };

    /**
     * Remove an image from the list.
     * - Newly-uploaded images (not in originalImageUrls) are deleted from
     *   Supabase Storage immediately so they never become orphans.
     * - Original images (already saved to the post) are only removed from
     *   local state here; the actual storage deletion happens only after a
     *   successful save, so cancelling the modal never loses existing files.
     */
    const removeImage = (image: SelectedImage) => {
      if (!originalImageUrls.has(image.url)) {
        // Newly uploaded in this session — safe to delete immediately
        fetch(`/api/uploads?url=${encodeURIComponent(image.url)}`, {
          method: "DELETE",
        }).catch(() => {});
      }
      setImages((prev) => prev.filter((i) => i.id !== image.id));
    };

    const scheduleRegularPost = async () => {
      if (!selectedDate) return;

      if (platform === "instagram" && images.length === 0) {
        setError("Instagram poszthoz legalább 1 kép kötelező.");
        return;
      }
      if (platform === "facebook" && !text.trim() && images.length === 0) {
        setError("Facebook poszthoz szöveg vagy legalább 1 kép kötelező.");
        return;
      }

      const scheduledDateTime = parse(
        `${format(selectedDate, "yyyy-MM-dd")} ${time}`,
        "yyyy-MM-dd HH:mm",
        new Date(),
      );
      if (scheduledDateTime < new Date()) {
        setError("Múltbeli időpont nem választható ki.");
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const bodyPayload: any = {
          type: "regular",
          date: format(selectedDate, "yyyy-MM-dd"),
          time,
          platform,
          description,
          text,
          imageUrls: images.map((image) => image.url),
          scheduledFor: scheduledDateTime.toISOString(),
        };
        if (editingPostId) bodyPayload.editId = editingPostId;

        const res = await fetch("/api/schedule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bodyPayload),
        });
        const payload = await res.json();
        if (!res.ok) {
          setError(payload.error || "A poszt ütemezése nem sikerült.");
          return;
        }
        setSuccessMessage("A poszt sikeresen időzítve! 🎉");
        // Clean up original images that the user removed during editing.
        // We only do this after a confirmed successful save so that cancelling
        // the modal never permanently deletes files that are still referenced.
        const currentUrls = new Set(images.map((img) => img.url));
        for (const url of originalImageUrls) {
          if (!currentUrls.has(url)) {
            fetch(`/api/uploads?url=${encodeURIComponent(url)}`, {
              method: "DELETE",
            }).catch(() => {});
          }
        }
        closeAllModals();
        router.refresh();
      } catch {
        setError("Hálózati hiba történt az ütemezés közben.");
      } finally {
        setLoading(false);
      }
    };

    const confirmDelete = async () => {
      if (!postToDelete) return;

      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/schedule/${postToDelete}`, {
          method: "DELETE",
        });
        const payload = await res.json();
        if (!res.ok) {
          setError(payload.error || "Az időzített poszt törlése sikertelen.");
          return;
        }
        setPostToDelete(null);
        router.refresh();
      } catch {
        setError("Hálózati hiba történt törlés közben.");
      } finally {
        setLoading(false);
      }
    };

    const handleGenerateAI = async () => {
      if (!aiPrompt.trim()) return;
      setIsGenerating(true);
      setAiError(null);
      try {
        const res = await fetch("/api/ai/generate-post", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: aiPrompt, platform, tone: aiTone }),
        });
        const data = await res.json();
        if (!res.ok)
          throw new Error(data?.error || "Hiba az AI generálás során.");

        // Auto-fill the correct text area
        if (platform === "instagram") {
          setDescription(data.text);
        } else {
          setText(data.text);
        }
      } catch (err: any) {
        setAiError(err.message);
      } finally {
        setIsGenerating(false);
      }
    };

    const monthPaddingStart = (startOfMonth(viewMonth).getDay() + 6) % 7;

    return (
      <div ref={rootRef} className="space-y-5">
        {postToDelete && (
          <DeleteConfirmModal
            loading={loading}
            onCancel={() => setPostToDelete(null)}
            onConfirm={() => void confirmDelete()}
          />
        )}
        {!hasAnyConnectedPlatform && (
          <div
            data-dash-reveal
            className="dashboard-card border border-amber-200 bg-amber-50/80 px-5 py-4 text-sm text-amber-800"
          >
            Ütemezés előtt legalább egy platformot csatlakoztass a{" "}
            <a
              href="/dashboard/account-billing"
              className="font-semibold underline hover:text-amber-900"
            >
              Fiók és számlázás
            </a>{" "}
            oldalon.
          </div>
        )}

        {/* Calendar card */}
        <div
          data-dash-reveal
          className="p-1 md:p-2 bg-light-background rounded-2xl"
        >
          {/* Month navigation */}
          <div className="mb-6 flex items-center justify-between px-2">
            <div>
              <h3 className="text-2xl font-sans font-medium text-gray-900 md:text-3xl">
                {format(viewMonth, "yyyy. MMMM", { locale: hu })}
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setViewMonth(subMonths(viewMonth, 1))}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-black/10 bg-white text-[#1A1A1A] transition-colors duration-150 hover:bg-white hover:text-[#1A1A1A] hover:border-[#1A1A1A]"
                aria-label="Előző hónap"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                onClick={() => setViewMonth(addMonths(viewMonth, 1))}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-black/10 bg-white text-[#1A1A1A] transition-colors duration-150 hover:bg-white hover:text-[#1A1A1A] hover:border-[#1A1A1A]"
                aria-label="Következő hónap"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Day grid Container */}
          <div className="mt-4 mb-2 bg-light-background">
            {/* Weekday headers */}
            <div className="grid grid-cols-7 mb-2">
              {WEEK_DAYS.map((day) => (
                <div
                  key={day.short}
                  className="py-2 text-center text-[10px] md:text-[11px] font-bold uppercase tracking-widest text-black-900"
                >
                  <span className="md:hidden">{day.short}</span>
                  <span className="hidden md:inline">{day.full}</span>
                </div>
              ))}
            </div>

            {/* Cells grid */}
            <div className="grid grid-cols-7 gap-[1px] bg-light-clinical-gray border border-light-clinical-gray rounded-xl overflow-hidden shadow-sm">
              {/* Empty padding cells */}
              {Array.from({ length: monthPaddingStart }).map((_, index) => (
                <div
                  key={`pad-${index}`}
                  className="min-h-[90px] md:min-h-[120px] bg-gray-50/50"
                />
              ))}

              {/* Day cells */}
              {daysInMonth.map((day) => {
                const dayKey = format(day, "yyyy-MM-dd");
                const dayPosts = postsByDay.get(dayKey) ?? [];
                const isPast = day < minDate;
                const isTooFar = day > maxDate;
                const isSelectable =
                  !isPast && !isTooFar && hasAnyConnectedPlatform;
                const today = isSameDay(day, now);
                const unavailable = isPast || isTooFar;

                return (
                  <div
                    key={dayKey}
                    role="button"
                    tabIndex={isSelectable ? 0 : -1}
                    onClick={() => isSelectable && openDateChoice(day)}
                    onKeyDown={(e) => {
                      if (
                        isSelectable &&
                        (e.key === "Enter" || e.key === " ")
                      ) {
                        e.preventDefault();
                        openDateChoice(day);
                      }
                    }}
                    className={`w-full text-left min-h-[90px] md:min-h-[120px] p-2 md:p-3 flex flex-col items-start transition-colors duration-200 ease-out relative group ${
                      unavailable
                        ? "bg-gray-50/40 cursor-not-allowed"
                        : today
                          ? "bg-light-primary/5 hover:bg-light-primary/10 cursor-pointer ring-inset ring-2 ring-light-primary/20"
                          : "bg-white hover:bg-[#FBFBFA] cursor-pointer"
                    }`}
                  >
                    <div className="flex justify-between items-start w-full mb-2">
                      <span
                        className={`inline-flex items-center justify-center font-mono text-[11px] md:text-xs font-bold ${
                          today
                            ? "bg-light-primary text-white px-1.5 py-0.5 rounded"
                            : unavailable
                              ? "text-gray-400"
                              : "text-gray-900"
                        }`}
                      >
                        {format(day, "dd")}
                      </span>
                      {!isSelectable && !unavailable && (
                        <Lock className="h-3 w-3 text-gray-300" />
                      )}
                    </div>

                    {!unavailable && isSelectable && dayPosts.length === 0 && (
                      <div className="absolute inset-0 m-auto flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                        <div className="w-8 h-8 rounded-full bg-light-primary/10 flex items-center justify-center">
                          <Plus className="h-5 w-5 text-light-primary" />
                        </div>
                      </div>
                    )}

                    <div className="w-full space-y-1 flex-1 z-10 relative mt-1">
                      {dayPosts.map((post) => (
                        <div
                          key={post.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditChoice(post);
                          }}
                          className={`group/post flex flex-col px-2 py-1.5 md:p-2 rounded bg-white/90 backdrop-blur-md shadow-sm border border-gray-100 cursor-pointer hover:bg-gray-50 hover:shadow-md hover:-translate-y-0.5 transition-all border-l-[3px] ${
                            post.platform === "facebook"
                              ? "border-l-blue-500"
                              : "border-l-light-primary"
                          }`}
                        >
                          <div className="flex items-center justify-between mb-0.5">
                            <div className="flex items-center gap-1.5 uppercase">
                              {post.platform === "facebook" ? (
                                <Facebook className="h-3 w-3 text-blue-500 shrink-0" />
                              ) : (
                                <Instagram className="h-3 w-3 text-light-primary shrink-0" />
                              )}
                              <span className="font-sans text-[10px] text-gray-500 font-semibold tracking-wider">
                                {format(parseISO(post.scheduled_for), "HH:mm")}
                              </span>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setPostToDelete(post.id);
                              }}
                              className="opacity-0 group-hover/post:opacity-100 cursor-pointer text-gray-400 hover:text-red-600 shrink-0 transition-all flex items-center justify-center -mr-1 -mt-1 p-1.5 bg-red-50 hover:bg-red-100 rounded shadow-sm"
                              aria-label="Törlés"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <p className="text-[10px] md:text-[11px] font-bold text-gray-800 truncate leading-tight mt-1">
                            Ütemezett Bejegyzés
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Messages */}
        {successMessage && (
          <div
            data-dash-reveal
            className="dashboard-card border border-[#2E4036]/20 bg-[#2E4036]/08 px-5 py-4 text-sm text-[#2E4036]"
          >
            {successMessage}
          </div>
        )}
        {error && !showWizard && (
          <div
            data-dash-reveal
            className="bg-white border-l-4 border-l-amber-500 border border-t-gray-200 border-r-gray-200 border-b-gray-200 rounded-lg shadow-sm px-5 py-4 text-sm text-gray-800"
          >
            {error}
          </div>
        )}

        {/* V5 SCHEDULER MODAL */}
        {showWizard &&
          selectedDate &&
          typeof document !== "undefined" &&
          createPortal(
            <div className="fixed inset-0 z-[9999] flex items-end md:items-center justify-center bg-black/80 p-0 md:p-8 backdrop-blur-[2px] transition-all overflow-y-auto overflow-x-hidden">
              <div
                className={`flex flex-col-reverse md:flex-row items-stretch justify-center gap-0 md:gap-4 transition-all duration-300 ease-in-out w-full max-w-6xl`}
              >
                {/* Left AI Column (Expandable Panel) */}
                <div
                  className={`shrink-0 overflow-hidden transition-all duration-300 ease-in-out ${
                    showAIAssistant
                      ? "w-full md:w-[300px] lg:w-[340px] opacity-100"
                      : "w-0 opacity-0"
                  }`}
                >
                  <div className="w-full md:w-[300px] lg:w-[340px] max-h-[40vh] md:max-h-none md:h-[70vh] md:min-h-[400px] bg-white text-[#1A1A1A] p-4 md:p-5 lg:p-6 flex flex-col justify-between rounded-b-2xl md:rounded-2xl shadow-2xl border-t md:border border-gray-200 md:border-white/10 relative overflow-y-auto overflow-x-hidden">
                    <div>
                      <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3 text-[#CC5833]">
                          <Sparkles className="h-6 w-6" />
                          <h2 className="text-2xl font-bold tracking-tight text-[#1A1A1A] font-sans">
                            AI Asszisztens
                          </h2>
                        </div>
                        <button
                          onClick={() => setShowAIAssistant(false)}
                          className="text-[#1A1A1A] hover:text-red-600 hover:cursor-pointer transition-colors"
                        >
                          <X className="h-5 w-5" />
                        </button>
                      </div>

                      <div className="space-y-5">
                        <div>
                          <label className="block text-[12px] font-bold uppercase tracking-widest text-[#CC5833] mb-2 font-sans">
                            Mit szeretnél írni?
                          </label>
                          <textarea
                            value={aiPrompt}
                            onChange={(e) => setAiPrompt(e.target.value)}
                            placeholder="Pl.: Készíts egy Instagram posztot..."
                            className="w-full h-24 md:h-40 bg-white/10 border border-gray-300 rounded-lg p-3 text-sm text-[#1A1A1A] placeholder-gray-400 focus:ring-1 focus:ring-[#CC5833] focus:border-[#CC5833] resize-none transition-all font-sans"
                          />
                        </div>

                        <div>
                          <label className="block text-[12px] font-bold uppercase tracking-widest text-[#CC5833] mb-2 font-sans">
                            Hangnem
                          </label>
                          <div className="relative">
                            <select
                              value={aiTone}
                              onChange={(e) => setAiTone(e.target.value)}
                              className="w-full bg-white/5 border border-gray-300 rounded-lg p-3 text-sm text-[#1A1A1A] placeholder-[#1A1A1A] focus:ring-1 focus:ring-[#CC5833] focus:border-[#CC5833] appearance-none transition-all cursor-pointer font-sans"
                            >
                              <option className="bg-[#1A1A1A]">Szakmai</option>
                              <option className="bg-[#1A1A1A]">Laza</option>
                              <option className="bg-[#1A1A1A]">Vicces</option>
                              <option className="bg-[#1A1A1A]">Lelkes</option>
                            </select>
                            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-gray-400">
                              <svg
                                className="h-4 w-4"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth="2"
                                  d="M19 9l-7 7-7-7"
                                ></path>
                              </svg>
                            </div>
                          </div>
                        </div>
                        {aiError && (
                          <div className="p-3 mb-4 rounded-lg bg-red-50 text-red-600 text-sm border border-red-200">
                            {aiError}
                          </div>
                        )}
                      </div>
                    </div>

                    <div>
                      <button
                        onClick={() => void handleGenerateAI()}
                        disabled={isGenerating || !aiPrompt.trim()}
                        className="w-full bg-[#CC5833] hover:bg-[#D96B47] text-white py-3 rounded-lg text-sm font-bold tracking-widest uppercase shadow-[0_0_15px_rgba(204,88,51,0.3)] transition-all flex items-center justify-center gap-2 group font-sans disabled:opacity-50"
                      >
                        {isGenerating ? (
                          <Loader2 className="h-5 w-5 animate-spin" />
                        ) : (
                          <Sparkles className="h-4 w-4 group-hover:rotate-12 transition-transform" />
                        )}
                        {isGenerating ? "Generálás..." : "Generálás"}
                      </button>
                    </div>

                    <div className="absolute -bottom-20 -right-20 w-64 h-64 bg-[#CC5833]/10 rounded-full blur-3xl pointer-events-none"></div>
                  </div>
                </div>

                {/* Right Composition Column (Light Theme - Independent Block) */}
                <div
                  className={`w-full ${showAIAssistant ? "max-w-full md:max-w-[600px] h-[55vh]" : "max-w-full md:max-w-2xl h-[85vh]"} md:h-[70vh] min-h-[250px] md:min-h-[500px] shrink-0 bg-white rounded-t-2xl md:rounded-xl shadow-2xl flex flex-col relative overflow-hidden transition-all duration-300 ease-in-out border border-gray-100`}
                >
                  <div className="border-b border-gray-100 px-4 md:px-6 lg:px-8 py-3 md:py-0 md:h-16 lg:h-20 flex flex-col md:flex-row md:items-center md:justify-between bg-white/50 backdrop-blur-sm z-10 shrink-0 gap-2 md:gap-0">
                    {/* Title row — close button visible only on mobile */}
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-lg md:text-xl lg:text-2xl font-bold text-gray-900 tracking-tight font-sans">
                          {editingPostId ? "Poszt szerkesztése" : "Új poszt"}
                        </h3>
                        <p className="text-[11px] md:text-xs text-gray-500 font-sans mt-0.5">
                          {format(selectedDate, "yyyy. MMMM d., EEEE", {
                            locale: hu,
                          })}
                        </p>
                      </div>
                      <button
                        onClick={cancelAndCloseModal}
                        className="flex md:hidden h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:text-[#1A1A1A] hover:bg-gray-100 transition-colors"
                      >
                        <X className="h-5 w-5" />
                      </button>
                    </div>

                    {/* Controls row */}
                    <div className="flex items-center gap-2 md:gap-3">
                      {!showAIAssistant && (
                        <button
                          onClick={() => setShowAIAssistant(true)}
                          className="flex items-center gap-1.5 px-2.5 md:px-3 py-1.5 rounded-lg bg-orange-100 text-[#CC5833] text-xs md:text-sm font-bold hover:bg-orange-200 transition"
                        >
                          <Sparkles className="w-3.5 h-3.5 md:w-4 md:h-4" />{" "}
                          <span className="hidden md:inline">
                            AI Asszisztens
                          </span>
                          <span className="md:hidden">AI</span>
                        </button>
                      )}
                      <div className="flex items-center bg-white border border-gray-200 rounded p-1">
                        <button
                          onClick={() => setPlatform("instagram")}
                          disabled={
                            (selectedDayPlatforms.has("instagram") &&
                              postToDelete !== editingPostId) ||
                            !connectedSet.has("instagram")
                          }
                          className={`px-2.5 md:px-3 py-1 text-xs md:text-sm font-bold rounded flex items-center gap-1 md:gap-1.5 transition-colors ${
                            platform === "instagram"
                              ? "bg-gray-100 text-[#1A1A1A]"
                              : "text-gray-500 hover:bg-gray-50"
                          } ${(selectedDayPlatforms.has("instagram") && !editingPostId) || !connectedSet.has("instagram") ? "opacity-40 cursor-not-allowed" : ""}`}
                        >
                          <Instagram className="h-3.5 w-3.5" /> IG
                        </button>
                        <button
                          onClick={() => setPlatform("facebook")}
                          disabled={
                            (selectedDayPlatforms.has("facebook") &&
                              postToDelete !== editingPostId) ||
                            !connectedSet.has("facebook")
                          }
                          className={`px-2.5 md:px-3 py-1 text-xs md:text-sm font-bold rounded flex items-center gap-1 md:gap-1.5 transition-colors ${
                            platform === "facebook"
                              ? "bg-gray-100 text-[#1A1A1A]"
                              : "text-gray-500 hover:bg-gray-50"
                          } ${(selectedDayPlatforms.has("facebook") && !editingPostId) || !connectedSet.has("facebook") ? "opacity-40 cursor-not-allowed" : ""}`}
                        >
                          <Facebook className="h-3.5 w-3.5" /> FB
                        </button>
                      </div>

                      <button
                        onClick={cancelAndCloseModal}
                        className="hidden md:flex h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:text-[#1A1A1A] hover:bg-gray-100 transition-colors"
                      >
                        <X className="h-5 w-5" />
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 p-4 md:p-6 lg:p-8 overflow-y-auto flex flex-col">
                    <textarea
                      value={platform === "instagram" ? description : text}
                      onChange={(e) =>
                        platform === "instagram"
                          ? setDescription(e.target.value)
                          : setText(e.target.value)
                      }
                      placeholder="Kezdj el írni..."
                      className="w-full text-base lg:text-lg font-normal bg-transparent border-none placeholder-gray-300 text-gray-900 focus:ring-0 p-0 mb-6 flex-1 resize-none h-full outline-none leading-relaxed"
                    />

                    <div>
                      {images.length > 0 && (
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5 mb-4">
                          {images.map((image) => (
                            <div
                              key={image.id}
                              className="group relative overflow-hidden rounded-xl border border-gray-200 bg-gray-50 aspect-square"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={image.url}
                                alt={image.name}
                                className="h-full w-full object-cover"
                              />
                              <button
                                type="button"
                                onClick={() => removeImage(image)}
                                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white opacity-0 shadow-md transition group-hover:opacity-100 hover:bg-red-600 scale-90 group-hover:scale-100"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {images.length < 10 && (
                        <label className="border-2 border-dashed border-gray-300 rounded-xl p-4 md:p-8 flex flex-col items-center justify-center text-center hover:border-[#CC5833]/50 hover:bg-[#CC5833]/5 transition-all cursor-pointer group mt-auto">
                          <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-sm mb-3 group-hover:scale-110 transition-transform">
                            <ImagePlus className="h-6 w-6 text-gray-400 group-hover:text-[#CC5833]" />
                          </div>
                          <p className="text-sm font-medium text-gray-600 font-sans">
                            Média feltöltése
                          </p>
                          <p className="text-xs text-gray-400 mt-1 font-sans">
                            Húzd ide a képeket vagy kattints (
                            {10 - images.length} hely)
                          </p>
                          <input
                            type="file"
                            multiple
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              void uploadFiles(e.target.files);
                              e.currentTarget.value = "";
                            }}
                          />
                        </label>
                      )}
                      {uploading && (
                        <div className="flex items-center justify-center gap-2 mt-4 text-sm text-gray-500 font-sans">
                          <Loader2 className="h-4 w-4 animate-spin" /> Képek
                          töltődnek...
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Bottom Footer Actions */}
                  <div className="border-t border-gray-100 px-4 md:px-6 lg:px-8 py-3 md:py-0 md:h-16 flex flex-col md:flex-row md:items-center md:justify-between bg-white/50 backdrop-blur-sm shrink-0 gap-2 md:gap-0">
                    <div className="flex items-center gap-3 md:gap-4">
                      <div>
                        <button
                          ref={emojiButtonRef}
                          onClick={() => {
                            if (!showEmojiPicker && emojiButtonRef.current) {
                              const rect =
                                emojiButtonRef.current.getBoundingClientRect();
                              const pickerH = 400;
                              const pickerW = 320;
                              let top = rect.top - pickerH - 8;
                              let left = rect.left;
                              // Clamp within viewport so it doesn't go off-screen on mobile
                              if (top < 8) top = rect.bottom + 8;
                              if (left + pickerW > window.innerWidth - 8)
                                left = window.innerWidth - pickerW - 8;
                              if (left < 8) left = 8;
                              setEmojiPickerPos({ top, left });
                            }
                            setShowEmojiPicker((prev) => !prev);
                          }}
                          className="text-gray-400 hover:text-gray-600 transition-colors p-2 -ml-2 rounded-full hover:bg-gray-100"
                        >
                          <svg
                            width="20"
                            height="20"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <circle cx="12" cy="12" r="10"></circle>
                            <path d="M8 14s1.5 2 4 2 4-2 4-2"></path>
                            <line x1="9" y1="9" x2="9.01" y2="9"></line>
                            <line x1="15" y1="9" x2="15.01" y2="9"></line>
                          </svg>
                        </button>
                        {showEmojiPicker &&
                          emojiPickerPos &&
                          typeof document !== "undefined" &&
                          createPortal(
                            <div
                              ref={emojiPickerRef}
                              style={{
                                position: "fixed",
                                top: emojiPickerPos.top,
                                left: emojiPickerPos.left,
                                zIndex: 99999,
                              }}
                              className="shadow-2xl rounded-2xl overflow-hidden border border-gray-100 animate-in slide-in-from-bottom-2 duration-200"
                            >
                              <EmojiPicker
                                onEmojiClick={(emojiData) => {
                                  if (platform === "instagram") {
                                    setDescription(
                                      (prev) => prev + emojiData.emoji,
                                    );
                                  } else {
                                    setText((prev) => prev + emojiData.emoji);
                                  }
                                  setShowEmojiPicker(false);
                                }}
                                width={Math.min(320, window.innerWidth - 16)}
                                height={350}
                              />
                            </div>,
                            document.body,
                          )}
                      </div>
                      <div className="h-4 w-px bg-gray-300"></div>
                      <div
                        className="flex items-center gap-2 cursor-pointer group px-2 py-1 rounded hover:bg-gray-100 transition-colors"
                        onClick={() => {
                          if (
                            timeRef.current &&
                            "showPicker" in timeRef.current
                          ) {
                            // @ts-ignore - showPicker is valid in modern browsers but TS may complain
                            timeRef.current.showPicker();
                          } else {
                            // @ts-expect-error - Fallback for browsers without showPicker
                            timeRef.current?.focus();
                          }
                        }}
                      >
                        <CalendarClock className="h-5 w-5 text-gray-400 group-hover:text-[#CC5833] transition-colors" />
                        <input
                          ref={timeRef}
                          type="time"
                          value={time}
                          onChange={(e) => setTime(e.target.value)}
                          className="text-sm font-bold text-gray-700 bg-transparent border-none focus:ring-0 p-0 cursor-pointer group-hover:text-[#CC5833] transition-colors font-sans"
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-3 w-full md:w-auto">
                      {error && (
                        <p className="text-xs text-red-600 flex-1 md:flex-none md:max-w-[200px] text-right leading-tight">
                          {error}
                        </p>
                      )}
                      <button
                        onClick={() => void scheduleRegularPost()}
                        disabled={loading || uploading}
                        className="flex-1 md:flex-initial px-4 md:px-6 py-2.5 rounded bg-[#CC5833] text-white text-sm font-bold tracking-wide shadow-glow hover:bg-[#D96B47] transition-colors font-sans disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {loading ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : null}
                        <span className="md:hidden">
                          {editingPostId ? "Mentés" : "Létrehozás"}
                        </span>
                        <span className="hidden md:inline">
                          {editingPostId
                            ? "Módosítások Mentése"
                            : "Poszt Létrehozása"}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )}
      </div>
    );
  },
);
