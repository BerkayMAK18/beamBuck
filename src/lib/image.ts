// Decodes an arbitrary image into a bitmap, applying EXIF rotation. Phone
// cameras (especially Android) commonly save photos as HEIC, which only
// Safari's native decoder understands — every other browser fails
// createImageBitmap outright, so this falls back to a WASM HEIC decoder
// (heic-to). It's dynamically imported (it's a ~3MB library) so pages that
// never hit a HEIC file don't pay for it. The /csp build is used
// specifically because it avoids 'unsafe-eval', which this app's CSP
// (src/server.ts) does not grant.
export async function decodeImageBlob(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    try {
      const { heicTo } = await import("heic-to/csp");
      return await heicTo({ blob, type: "bitmap", options: { imageOrientation: "from-image" } });
    } catch {
      throw new Error("This photo's format isn't supported. Try a different photo.");
    }
  }
}

// Saves a photo to the device as a direct download, not a share action.
// Mobile browsers ignore the `download` attribute on cross-origin URLs
// (these are signed Supabase Storage links), so a plain <a download>
// silently opens the image instead of saving it -- fetching the bytes first
// and handing them to an object-URL anchor is what actually triggers a save.
//
// Deliberately NOT using the Web Share API here: `navigator.share({files})`
// opens the full share sheet (AirDrop/Messages/contacts) with "Save Image"
// buried among the send-to targets, which reads as "share this" rather than
// "download this" -- confusing for a save-a-photo action. This path saves
// straight to the Downloads folder on Android/desktop with no picker at
// all. iOS Safari is the one gap: it saves into the Files app, not directly
// into Photos/Camera Roll -- there's no code-only way around that on iOS,
// short of the share sheet this function avoids. The one-tap alternative
// that *does* land straight in Photos on iOS, for free, is long-pressing
// the full-size <img> in the lightbox and choosing "Save to Photos" --
// that's a native Safari gesture, not something this function can trigger.
export async function downloadImage(url: string, filename: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Could not download this photo");
  const blob = await res.blob();

  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

export function bitmapToJpegBlob(bitmap: ImageBitmap, maxDimension: number, quality = 0.85): Promise<Blob> {
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not encode image"))), "image/jpeg", quality);
  });
}
