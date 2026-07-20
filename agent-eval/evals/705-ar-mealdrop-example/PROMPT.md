<!-- Mealdrop-tailored example eval (SB-1724). Workflow prompts proper are authored under SB-1689. -->

Restaurant cards should show a small "Popular" indicator for highly-rated restaurants. In `src/components/RestaurantCard/RestaurantCard.tsx`, add a visible "Popular" label to the card whenever the restaurant's `rating` is 4.5 or higher. Restaurants with no rating, or a rating below 4.5, should not show it.
