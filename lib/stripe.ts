import Stripe from "stripe";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-05-28.basil",
});

/**
 * Resolve the CURRENT active subscription price to charge — without redeploying
 * when the price changes in Stripe.
 *
 * Resolution order:
 *   1. STRIPE_PRODUCT_ID → the product's `default_price` (if active & recurring).
 *      ← preferred: in Stripe, create a new price, "set as default", archive the
 *        old one, and the app picks it up automatically.
 *   2. STRIPE_PRODUCT_ID → newest active recurring price on that product
 *      (fallback if no default is set).
 *   3. STRIPE_PRICE_ID → legacy fixed price id (backwards compatible).
 *
 * Throws a clear error if nothing usable is found.
 */
export async function resolveActivePriceId(): Promise<string> {
  const productId = process.env.STRIPE_PRODUCT_ID?.trim();

  if (productId) {
    // 1. Product's default price
    const product = await stripe.products.retrieve(productId);
    const dp = product.default_price;
    const dpId = typeof dp === "string" ? dp : dp?.id;
    if (dpId) {
      const price = await stripe.prices.retrieve(dpId);
      if (price.active && price.recurring) return price.id;
    }

    // 2. Newest active recurring price on the product
    const prices = await stripe.prices.list({
      product: productId,
      active: true,
      type: "recurring",
      limit: 100,
    });
    const recurring = prices.data
      .filter((p) => p.active && p.recurring)
      .sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
    if (recurring[0]) return recurring[0].id;
  }

  // 3. Legacy fixed price id
  const legacy = process.env.STRIPE_PRICE_ID?.trim();
  if (legacy) return legacy;

  throw new Error(
    "No active Stripe price found. Set STRIPE_PRODUCT_ID (preferred) or STRIPE_PRICE_ID."
  );
}
