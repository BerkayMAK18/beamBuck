import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Full class strings (not built dynamically) so Tailwind's scanner picks them up.
// Colors live in src/styles.css as --cat-* tokens.
const CATEGORY_CLASSES: Record<string, string> = {
  Travel: "bg-cat-travel text-cat-travel-foreground hover:bg-cat-travel/80",
  Food: "bg-cat-food text-cat-food-foreground hover:bg-cat-food/80",
  Adventure: "bg-cat-adventure text-cat-adventure-foreground hover:bg-cat-adventure/80",
  Learn: "bg-cat-learn text-cat-learn-foreground hover:bg-cat-learn/80",
  Together: "bg-cat-together text-cat-together-foreground hover:bg-cat-together/80",
  Create: "bg-cat-create text-cat-create-foreground hover:bg-cat-create/80",
};

// Categories not in the map (e.g. renamed/removed ones on old rows) keep the plain secondary look.
export function CategoryBadge({ category, className }: { category: string; className?: string }) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        Object.hasOwn(CATEGORY_CLASSES, category) && CATEGORY_CLASSES[category],
        className,
      )}
    >
      {category}
    </Badge>
  );
}
