Users can place an order (`/checkout` → `SuccessPage`), but the order is only ever held as the single most-recent order in `state.order.items` and is lost on refresh (no persistence). Build an **Order History** feature so people can look back at everything they've ordered.

- Add a new **Order History page** listing every order the user has placed, most recent first.
- Provide a **global entry point** in the header so the page is reachable from anywhere in the app.
- Each order in the list shows **what was in it** (line items + quantities) and **what it cost** (total), reusing the existing order-summary UI.
- Each order shows a **status badge** so people can tell at a glance whether it's still **on the way** or already **delivered**.
- Placed orders **survive a page refresh** via browser storage.
