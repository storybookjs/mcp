Create a `ProductCard` component with interactive rating and add-to-cart functionality.

<technical_requirements>

1. Create file: `src/components/ProductCard.tsx` (new component)
2. Component props:
   - `name: string` - Product name
   - `price: number` - Product price
   - `image: string` - Product image URL
   - `initialRating?: number` - Initial rating (0-5, default: 0)
   - `onRate?: (rating: number) => void` - Callback when user rates
   - `onAddToCart?: () => void` - Callback when add to cart is clicked
3. Features:
   - Display product image, name, and price
   - Interactive 5-star rating system (clickable stars)
   - "Add to Cart" button
   - Button should be disabled if `onAddToCart` is not provided
   - Stars should update visually when clicked
4. Create story file: `stories/ProductCard.stories.tsx`
5. Include at least 3 story variants demonstrating different states
6. All interactive elements must have proper test IDs and accessibility attributes
