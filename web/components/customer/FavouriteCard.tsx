"use client";

import { Button, Price, VegMark } from "@/components/ui";
import { FoodImage } from "@/components/customer/FoodImage";

export function FavouriteCard({
  favourite,
  onRemove,
}: {
  favourite: {
    item_id: string;
    name: string;
    photo_url: string | null;
    price_inr: number;
    is_veg: boolean;
  };
  onRemove: (itemId: string) => void;
}) {
  return (
    <article className="profile-favourite-card">
      <div className="profile-favourite-photo-wrap">
        {favourite.photo_url ? (
          <FoodImage
            src={favourite.photo_url}
            name={favourite.name}
            isVeg={favourite.is_veg}
            className="profile-favourite-photo"
            sizes="(max-width: 640px) 150px, 150px"
          />
        ) : (
          <div className="profile-favourite-photo profile-favourite-photo-placeholder" aria-hidden="true" />
        )}
        <VegMark isVeg={favourite.is_veg} />
        <Button
          type="button"
          variant="danger"
          className="profile-favourite-remove"
          aria-label={`Remove ${favourite.name} from favourites`}
          onClick={() => onRemove(favourite.item_id)}
        >
          ×
        </Button>
      </div>
      <div className="profile-favourite-copy">
        <strong>{favourite.name}</strong>
        <Price amount={favourite.price_inr} showGst={false} />
      </div>
    </article>
  );
}
