import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { decodeImageBlob } from "@/lib/image";
import { ZoomIn } from "lucide-react";
import { toast } from "sonner";

const BOX = 288; // preview box size, css px
const OUTPUT = 512; // exported image size, px

type Props = {
  file: File | null;
  onOpenChange: (open: boolean) => void;
  onCropped: (blob: Blob) => void;
};

export function AvatarCropDialog({ file, onOpenChange, onCropped }: Props) {
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);

  // Decoding via createImageBitmap (rather than <img>+CSS transforms) applies
  // EXIF orientation and sidesteps touch/pointer quirks that only showed up
  // on Android — the live preview is drawn straight to canvas every frame.
  useEffect(() => {
    if (!file) { setBitmap(null); return; }
    let cancelled = false;
    decodeImageBlob(file)
      .then((bmp) => {
        if (cancelled) { bmp.close(); return; }
        setBitmap(bmp);
        setZoom(1);
        setOffset({ x: 0, y: 0 });
      })
      .catch((err: Error) => {
        toast.error(err.message);
        onOpenChange(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  useEffect(() => () => bitmap?.close(), [bitmap]);

  const baseScale = useMemo(() => {
    if (!bitmap) return 1;
    return Math.max(BOX / bitmap.width, BOX / bitmap.height);
  }, [bitmap]);

  const totalScale = baseScale * zoom;

  const maxOffset = useMemo(() => {
    if (!bitmap) return { x: 0, y: 0 };
    return {
      x: Math.max(0, (bitmap.width * totalScale - BOX) / 2),
      y: Math.max(0, (bitmap.height * totalScale - BOX) / 2),
    };
  }, [bitmap, totalScale]);

  const clamp = (val: { x: number; y: number }, max: { x: number; y: number }) => ({
    x: Math.min(max.x, Math.max(-max.x, val.x)),
    y: Math.min(max.y, Math.max(-max.y, val.y)),
  });

  // Redraw the live preview whenever the image, zoom, or pan changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bitmap) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = BOX * dpr;
    canvas.height = BOX * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, BOX, BOX);
    ctx.save();
    ctx.beginPath();
    ctx.arc(BOX / 2, BOX / 2, BOX / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(BOX / 2 + offset.x, BOX / 2 + offset.y);
    ctx.scale(totalScale, totalScale);
    ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
    ctx.restore();
  }, [bitmap, totalScale, offset]);

  const handlePointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, offsetX: offset.x, offsetY: offset.y };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    e.preventDefault();
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    setOffset(clamp({ x: dragRef.current.offsetX + dx, y: dragRef.current.offsetY + dy }, maxOffset));
  };

  const handlePointerUp = () => { dragRef.current = null; };

  const handleZoomChange = ([z]: number[]) => {
    setZoom(z);
    if (!bitmap) return;
    const nextScale = baseScale * z;
    const nextMax = {
      x: Math.max(0, (bitmap.width * nextScale - BOX) / 2),
      y: Math.max(0, (bitmap.height * nextScale - BOX) / 2),
    };
    setOffset((cur) => clamp(cur, nextMax));
  };

  const handleSave = () => {
    if (!bitmap) return;
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const outputScale = totalScale * (OUTPUT / BOX);
    ctx.translate(OUTPUT / 2 + offset.x * (OUTPUT / BOX), OUTPUT / 2 + offset.y * (OUTPUT / BOX));
    ctx.scale(outputScale, outputScale);
    ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
    canvas.toBlob((blob) => { if (blob) onCropped(blob); }, "image/jpeg", 0.9);
  };

  return (
    <Dialog open={!!file && !!bitmap} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-serif">Adjust your photo</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4">
          <canvas
            ref={canvasRef}
            style={{ width: BOX, height: BOX, touchAction: "none" }}
            className="rounded-full border-2 border-primary/40 bg-muted cursor-grab active:cursor-grabbing select-none"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onContextMenu={(e) => e.preventDefault()}
          />

          <div className="flex items-center gap-3 w-full">
            <ZoomIn className="w-4 h-4 text-muted-foreground shrink-0" />
            <Slider value={[zoom]} onValueChange={handleZoomChange} min={1} max={3} step={0.01} />
          </div>
          <p className="text-xs text-muted-foreground -mt-2">Drag to reposition, use the slider to zoom.</p>
        </div>

        <DialogFooter>
          <Button variant="outline" className="rounded-full" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="rounded-full" onClick={handleSave}>Save photo</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
