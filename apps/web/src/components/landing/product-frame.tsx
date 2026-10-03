import Image, { type StaticImageData } from "next/image";
import { cn } from "@/lib/utils";

/**
 * A real product screenshot in a quiet frame: hairline border, 14px radius, a soft wide shadow in light mode and a
 * slightly lighter border in dark mode. Light and dark captures swap with the theme.
 */
export function ProductFrame({
  light,
  dark,
  alt,
  priority = false,
  sizes = "(min-width: 1248px) 1200px, 100vw",
  className,
  mobileCrop = false,
}: {
  light: StaticImageData;
  dark: StaticImageData;
  alt: string;
  priority?: boolean;
  sizes?: string;
  className?: string;
  /** Below md, show the top-left of the capture at a readable size instead of shrinking all of it. */
  mobileCrop?: boolean;
}) {
  const img = mobileCrop ? "max-w-none w-[820px] md:w-full" : "w-full";
  return (
    <figure
      className={cn(
        mobileCrop && "max-h-[420px] md:max-h-none",
        "bg-card overflow-hidden rounded-[14px] border shadow-[0_1px_2px_rgb(28_25_23/0.04),0_24px_64px_-24px_rgb(28_25_23/0.18)] dark:border-white/12 dark:shadow-none",
        className,
      )}
    >
      <Image
        src={light}
        alt={alt}
        sizes={sizes}
        priority={priority}
        quality={priority ? 70 : undefined}
        placeholder="blur"
        className={cn("block h-auto dark:hidden", img)}
      />
      <Image
        src={dark}
        alt={alt}
        sizes={sizes}
        placeholder="blur"
        className={cn("hidden h-auto dark:block", img)}
      />
    </figure>
  );
}
