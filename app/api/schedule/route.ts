import { createClient } from "@/lib/supabase/server";
import { getPostLimit, hasPaidAccess } from "@/lib/subscription";
import { addDays, endOfDay, isValid, parse, startOfDay } from "date-fns";
import { NextResponse } from "next/server";
import { z } from "zod";

const MAX_CAPTION_LENGTH = 64_000; // slightly above Meta's 63,206 char Facebook limit

const scheduleSchema = z.object({
  date: z.string().min(1),
  time: z.string().min(1),
  platform: z.enum(["instagram", "facebook"]),
  description: z.string().max(MAX_CAPTION_LENGTH).optional(),
  text: z.string().max(MAX_CAPTION_LENGTH).optional(),
  imageUrls: z.array(z.string().url()).max(10).default([]),
  type: z.enum(["regular", "ai"]),
  editId: z.string().uuid().optional(),
  scheduledFor: z.string().datetime().optional(),
});

function getDateRange(date: Date) {
  return {
    start: startOfDay(date),
    end: endOfDay(date),
  };
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Jogosulatlan hozzáférés." },
      { status: 401 },
    );
  }

  const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
  const { count: recentScheduleAttempts } = await supabase
    .from("usage_logs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("action", "schedule_post_attempt")
    .gte("created_at", oneMinuteAgo);

  if ((recentScheduleAttempts ?? 0) > 30) {
    return NextResponse.json(
      {
        error: "Túl sok próbálkozás. Kérlek, várj egy percet és próbáld újra.",
      },
      { status: 429 },
    );
  }

  await supabase.from("usage_logs").insert({
    user_id: user.id,
    action: "schedule_post_attempt",
  });

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Érvénytelen JSON formátum." },
      { status: 400 },
    );
  }

  const parsed = scheduleSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Érvénytelen kérés." }, { status: 400 });
  }

  const input = parsed.data;

  // Use the client-provided ISO timestamp (browser timezone) when available.
  // Falls back to server-side parse for backward compatibility.
  let selectedDate: Date;
  if (input.scheduledFor) {
    selectedDate = new Date(input.scheduledFor);
  } else {
    selectedDate = parse(
      `${input.date} ${input.time}`,
      "yyyy-MM-dd HH:mm",
      new Date(),
    );
  }
  if (!isValid(selectedDate)) {
    return NextResponse.json(
      { error: "Érvénytelen dátum vagy idő." },
      { status: 400 },
    );
  }

  const now = new Date();
  const minDate = startOfDay(now);
  const maxDate = endOfDay(addDays(minDate, 30));
  if (selectedDate < minDate || selectedDate > maxDate) {
    return NextResponse.json(
      {
        error:
          "Posztokat csak a mai naptól számított 30 napon belülre ütemezhetsz.",
      },
      { status: 400 },
    );
  }

  // Prevent scheduling in the past on _today_ (minDate only blocks past days)
  if (selectedDate < now) {
    return NextResponse.json(
      { error: "Múltbeli időpontra nem ütemezhetsz posztot." },
      { status: 400 },
    );
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, plan, subscription_status")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    return NextResponse.json(
      { error: "A profil nem található." },
      { status: 404 },
    );
  }

  const paidAccess = hasPaidAccess(profile);

  const { data: connectedAccount } = await supabase
    .from("social_accounts")
    .select("id")
    .eq("user_id", user.id)
    .eq("provider", input.platform)
    .maybeSingle();

  if (!connectedAccount) {
    return NextResponse.json(
      {
        error: `Csatlakoztasd a(z) ${input.platform} fiókodat mielőtt ${input.platform} posztot ütemeznél.`,
      },
      { status: 403 },
    );
  }

  if (input.type === "ai") {
    if (!paidAccess) {
      return NextResponse.json(
        {
          error:
            "Az AI poszt ütemezés csak Pro és Elite csomagokban érhető el.",
        },
        { status: 403 },
      );
    }

    return NextResponse.json(
      { error: "Az AI poszt ütemezés még nem elérhető." },
      { status: 501 },
    );
  }

  const imageCount = input.imageUrls.length;
  const text = (input.text ?? "").trim();
  const description = (input.description ?? "").trim();

  // Validate that all image URLs belong to THIS project's storage and the
  // current user's folder. Comparing against the exact project origin prevents
  // an attacker from referencing images hosted on a different Supabase project
  // that happens to use routing paths containing the victim's user ID.
  const supabaseOrigin = (() => {
    try {
      return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin;
    } catch {
      return "";
    }
  })();
  for (const imgUrl of input.imageUrls) {
    try {
      const parsed = new URL(imgUrl);
      const expectedPrefix = `/storage/v1/object/public/post-media/${user.id}/`;
      if (
        !supabaseOrigin ||
        parsed.origin !== supabaseOrigin ||
        !parsed.pathname.startsWith(expectedPrefix)
      ) {
        return NextResponse.json(
          { error: "Érvénytelen képfájl hivatkozás." },
          { status: 400 },
        );
      }
    } catch {
      return NextResponse.json(
        { error: "Érvénytelen képfájl URL." },
        { status: 400 },
      );
    }
  }

  if (input.platform === "instagram") {
    if (imageCount === 0) {
      return NextResponse.json(
        { error: "Az Instagram posztokhoz legalább egy kép szükséges." },
        { status: 400 },
      );
    }
  }

  if (input.platform === "facebook") {
    if (!text && imageCount === 0) {
      return NextResponse.json(
        {
          error:
            "A Facebook posztokhoz szöveg vagy legalább egy kép szükséges.",
        },
        { status: 400 },
      );
    }
  }

  const { count: scheduledCount, error: countError } = await supabase
    .from("scheduled_posts")
    .select("id, posts!inner(user_id)", { count: "exact", head: true })
    .eq("posts.user_id", user.id)
    .eq("status", "scheduled");

  if (countError) {
    return NextResponse.json(
      { error: "Nem sikerült ellenőrizni a kvótádat." },
      { status: 500 },
    );
  }

  const limit = getPostLimit(profile);
  if (!input.editId && (scheduledCount ?? 0) >= limit) {
    return NextResponse.json(
      {
        error: `Elérted a(z) ${limit} aktív ütemezett poszt limitedet. Válts Pro csomagra vagy törölj egy ütemezett posztot.`,
      },
      { status: 403 },
    );
  }

  const day = getDateRange(selectedDate);

  let query = supabase
    .from("scheduled_posts")
    .select("id, posts!inner(user_id)", { count: "exact", head: true })
    .eq("posts.user_id", user.id)
    .eq("platform", input.platform)
    .eq("status", "scheduled")
    .gte("scheduled_for", day.start.toISOString())
    .lte("scheduled_for", day.end.toISOString());

  if (input.editId) {
    query = query.neq("id", input.editId);
  }

  const { count: dayPlatformCount, error: duplicateError } = await query;

  if (duplicateError) {
    return NextResponse.json(
      { error: "Nem sikerült ellenőrizni ezt a napot." },
      { status: 500 },
    );
  }

  if ((dayPlatformCount ?? 0) > 0) {
    return NextResponse.json(
      {
        error: `Erre a napra már van ütemezve egy ${input.platform} posztod.`,
      },
      { status: 409 },
    );
  }

  const caption = input.platform === "instagram" ? description : text;

  if (input.editId) {
    const { data: existing, error: err } = await supabase
      .from("scheduled_posts")
      .select("id, post_id, posts!inner(user_id)")
      .eq("id", input.editId)
      .eq("posts.user_id", user.id)
      .single();

    if (err || !existing) {
      return NextResponse.json(
        { error: "A módosítandó poszt nem található." },
        { status: 404 },
      );
    }

    const { error: postUpdateErr } = await supabase
      .from("posts")
      .update({
        caption: caption || null,
        image_url: imageCount > 0 ? JSON.stringify(input.imageUrls) : null,
      })
      .eq("id", existing.post_id);

    if (postUpdateErr) {
      return NextResponse.json(
        { error: "A poszt tartalmának módosítása sikertelen." },
        { status: 500 },
      );
    }

    const { data: updatedSchedule, error: updateErr } = await supabase
      .from("scheduled_posts")
      .update({
        platform: input.platform,
        scheduled_for: selectedDate.toISOString(),
      })
      .eq("id", input.editId)
      .select("id, platform, scheduled_for")
      .single();

    if (updateErr) {
      return NextResponse.json(
        { error: "A poszt módosítása sikertelen." },
        { status: 500 },
      );
    }

    return NextResponse.json({ data: updatedSchedule });
  }

  const { data: post, error: postError } = await supabase
    .from("posts")
    .insert({
      user_id: user.id,
      caption: caption || null,
      image_url: imageCount > 0 ? JSON.stringify(input.imageUrls) : null,
      status: "scheduled",
    })
    .select("id")
    .single();

  if (postError || !post) {
    return NextResponse.json(
      { error: "A poszt létrehozása sikertelen." },
      { status: 500 },
    );
  }

  const { data: schedule, error: scheduleError } = await supabase
    .from("scheduled_posts")
    .insert({
      post_id: post.id,
      platform: input.platform,
      scheduled_for: selectedDate.toISOString(),
      status: "scheduled",
    })
    .select("id, platform, scheduled_for")
    .single();

  if (scheduleError || !schedule) {
    await supabase
      .from("posts")
      .delete()
      .eq("id", post.id)
      .eq("user_id", user.id);
    return NextResponse.json(
      { error: "A poszt ütemezése sikertelen." },
      { status: 500 },
    );
  }

  await supabase.from("usage_logs").insert({
    user_id: user.id,
    action: "schedule_post_success",
  });

  return NextResponse.json({ data: schedule });
}
