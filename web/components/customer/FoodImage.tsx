"use client";

import Image from "next/image";
import { useState } from "react";
import { VegMark } from "@/components/ui";

export function FoodImage({
  src,
  name,
  isVeg,
  className = "",
  sizes = "(max-width: 640px) 42vw, 320px",
  priority = false,
}: {
  src: string;
  name: string;
  isVeg: boolean;
  className?: string;
  sizes?: string;
  priority?: boolean;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc === src;

  return (
    <div className={`food-image ${className}`.trim()}>
      {failed ? (
        <div className="food-image-fallback" role="img" aria-label={`${name} photo unavailable`}>
          <VegMark isVeg={isVeg} />
          <span>{name}</span>
        </div>
      ) : (
        <Image
          src={src}
          alt={name}
          fill
          sizes={sizes}
          priority={priority}
          onError={() => setFailedSrc(src)}
          className="food-image-photo"
        />
      )}
    </div>
  );
}
