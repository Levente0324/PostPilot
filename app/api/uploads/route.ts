import { createClient } from "@/lib/supabase/server";
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";

const BUCKET = "post-media";
const MAX_FILES_PER_REQUEST = 10;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB — uploads now go browser→Supabase directly
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

const MIME_EXTENSION_MAP: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
};

/**
 * Magic-byte signatures for allowed image formats.
 * Validates the actual file content rather than trusting the client-supplied MIME type.
 */
const MAGIC_BYTES: { mime: string; bytes: number[] }[] = [
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF header
  { mime: "image/gif", bytes: [0x47, 0x49, 0x46] },
  // HEIC/HEIF share the ftyp box signature at offset 4
];

function matchesMagicBytes(buffer: Buffer): boolean {
  // Check standard magic byte signatures
  for (const sig of MAGIC_BYTES) {
    if (
      buffer.length >= sig.bytes.length &&
      sig.bytes.every((b, i) => buffer[i] === b)
    ) {
      return true;
    }
  }
  // HEIC/HEIF: check for 'ftyp' at offset 4
  if (
    buffer.length >= 12 &&
    buffer[4] === 0x66 &&
    buffer[5] === 0x74 &&
    buffer[6] === 0x79 &&
    buffer[7] === 0x70
  ) {
    return true;
  }
  return false;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Jogosulatlan hozzáférés" },
      { status: 401 },
    );
  }

  const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
  const { count: recentUploadAttempts } = await supabase
    .from("usage_logs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("action", "upload_images_attempt")
    .gte("created_at", oneMinuteAgo);

  if ((recentUploadAttempts ?? 0) > 20) {
    return NextResponse.json(
      {
        error:
          "Túl sok feltöltési próbálkozás. Kérlek, várj egy percet és próbáld újra.",
      },
      { status: 429 },
    );
  }

  await supabase.from("usage_logs").insert({
    user_id: user.id,
    action: "upload_images_attempt",
  });

  const formData = await request.formData();
  const files = formData
    .getAll("files")
    .filter((item): item is File => item instanceof File);

  if (!files.length) {
    return NextResponse.json(
      { error: "Nem lett fájl feltöltve." },
      { status: 400 },
    );
  }

  if (files.length > MAX_FILES_PER_REQUEST) {
    return NextResponse.json(
      {
        error: `Egyszerre legfeljebb ${MAX_FILES_PER_REQUEST} képet tölthetsz fel.`,
      },
      { status: 400 },
    );
  }

  const uploadedUrls: string[] = [];

  for (const file of files) {
    if (!ALLOWED_IMAGE_MIME_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: `A(z) ${file.name} fájl formátuma nem támogatott.` },
        { status: 400 },
      );
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: `A(z) ${file.name} fájl túl nagy. A maximális méret 10MB.` },
        { status: 400 },
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());

    // Validate actual file content via magic bytes — don't trust the client MIME type alone
    if (!matchesMagicBytes(bytes)) {
      return NextResponse.json(
        {
          error: `A(z) ${file.name} fájl tartalma nem egyezik egy támogatott képformátummal.`,
        },
        { status: 400 },
      );
    }

    const extension = MIME_EXTENSION_MAP[file.type] || "jpg";
    const path = `${user.id}/${Date.now()}-${randomUUID()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, bytes, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error("Upload error:", uploadError.message);
      return NextResponse.json(
        { error: "A feltöltés sikertelen. Kérlek, próbáld újra." },
        { status: 500 },
      );
    }

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    if (data.publicUrl) {
      uploadedUrls.push(data.publicUrl);
    }
  }

  return NextResponse.json({ data: { urls: uploadedUrls } });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Jogosulatlan hozzáférés" },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  if (!url) {
    return NextResponse.json({ error: "Hiányzó URL" }, { status: 400 });
  }

  // Tördelés a bucket névnél "post-media/"
  const urlObj = new URL(url);
  const pathParts = urlObj.pathname.split(`/${BUCKET}/`);
  if (pathParts.length !== 2) {
    return NextResponse.json(
      { error: "Érvénytelen formátum" },
      { status: 400 },
    );
  }

  const storagePath = pathParts[1];

  // Biztonság: csak a saját mappájából törölhet
  if (!storagePath.startsWith(user.id + "/")) {
    return NextResponse.json(
      { error: "Nincs jogosultságod a fájl törléséhez" },
      { status: 403 },
    );
  }

  const { error } = await supabase.storage.from(BUCKET).remove([storagePath]);

  if (error) {
    console.error("Storage delete error:", error.message);
    return NextResponse.json(
      { error: "Nem sikerült törölni a fájlt." },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
