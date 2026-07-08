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
