// Module 2: the four tools Ask Copper can use, plus compare_products (extension). Products and prices come from
// lib/copper/catalog.ts and stock from lib/copper/inventory.ts, so the
// chatbot never has to make them up.
// The contract for each tool is in specs/module-2/spec.md.
import { tool } from "ai";
import { z } from "zod";
import { getPlans, getProducts } from "@/lib/copper/catalog";
import type { Plan, ProductId } from "@/lib/copper/catalog";
import { readInventory } from "@/lib/copper/inventory";

export type ProductList = {
  products: {
    id: ProductId;
    name: string;
    type: string;
    priceUsd: number;
    colors: string[];
  }[];
};

export type Prices = {
  products: { id: ProductId; name: string; priceUsd: number }[];
  plans: {
    id: Plan["id"];
    name: string;
    monthlyUsd: number;
    annualUsd: number;
  }[];
};

export type CalculateCostInput = {
  products: ProductId[];
  plan: Plan["id"];
  billing: "monthly" | "annual";
  years: number;
};

export type CostBreakdown = {
  lines: { item: string; usd: number }[];
  totalUsd: number;
};

export type CheckAvailabilityInput = { product: ProductId; color?: string };

export type Stock = "in_stock" | "low_stock" | "backordered";

export type Availability =
  | {
      status: "ok";
      product: string;
      colors: { color: string; stock: Stock; restockDate: string | null }[];
    }
  | { status: "not_a_color"; product: string; color: string; colors: string[] }
  | { status: "unavailable"; message: string };

export type CompareProductsInput = { products: ProductId[] };

export type ProductComparison = {
  products: {
    id: ProductId;
    name: string;
    type: string;
    priceUsd: number;
    features: string[];
    stock:
      | {
          status: "ok";
          colors: { color: string; stock: Stock; restockDate: string | null }[];
          // True when at least one color is in stock or low stock today.
          availableNow: boolean;
          // When nothing is available now: the soonest restock date, else null.
          earliestRestock: string | null;
        }
      | { status: "unavailable"; message: string };
  }[];
  // Which product costs less and by how much, or null when they cost the same.
  cheaper: { id: ProductId; name: string; savesUsd: number } | null;
};

const productIds = ["copper-home", "copper-notes"] as const;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** get_products: what Copper sells and which colors each one comes in. */
export function listProducts(): ProductList {
  return {
    products: getProducts().map(({ id, name, type, priceUsd, colors }) => ({
      id,
      name,
      type,
      priceUsd,
      colors,
    })),
  };
}

/** get_prices: every product and plan price, read from the catalog. */
export function getPrices(): Prices {
  return {
    products: getProducts().map(({ id, name, priceUsd }) => ({
      id,
      name,
      priceUsd,
    })),
    plans: getPlans().map(({ id, name, monthlyUsd, annualUsd }) => ({
      id,
      name,
      monthlyUsd,
      annualUsd,
    })),
  };
}

export const calculateCostInput: z.ZodType<CalculateCostInput> = z.strictObject(
  {
    products: z.array(z.enum(productIds)).max(5),
    plan: z.enum(["free", "copper-plus"]),
    billing: z.enum(["monthly", "annual"]),
    years: z.number().int().min(1).max(5),
  },
);

/** calculate_cost: the total cost of devices plus a plan over some years. */
export function calculateCost(input: CalculateCostInput): CostBreakdown {
  const catalog = getProducts();
  const lines = input.products.map((id) => {
    const product = catalog.find((p) => p.id === id)!;
    return { item: product.name, usd: round2(product.priceUsd) };
  });

  const plan = getPlans().find((p) => p.id === input.plan)!;
  const planUsd =
    input.billing === "monthly"
      ? plan.monthlyUsd * 12 * input.years
      : plan.annualUsd * input.years;
  // The free plan costs nothing, so it gets no line.
  if (plan.id !== "free") {
    const how =
      input.billing === "monthly" ? "billed monthly" : "billed yearly";
    lines.push({
      item: `${plan.name} (${how}, ${input.years} ${input.years === 1 ? "year" : "years"})`,
      usd: round2(planUsd),
    });
  }

  return { lines, totalUsd: round2(lines.reduce((sum, l) => sum + l.usd, 0)) };
}

export const checkAvailabilityInput: z.ZodType<CheckAvailabilityInput> =
  z.strictObject({
    product: z.enum(productIds),
    color: z.string().min(1).optional(),
  });

/** check_availability: stock for one product (or one of its colors), read fresh each time. */
export async function checkAvailability(
  input: CheckAvailabilityInput,
): Promise<Availability> {
  const product = getProducts().find((p) => p.id === input.product)!;

  // A color the product doesn't come in is "not_a_color", even if stock is down.
  if (
    input.color !== undefined &&
    !product.colors.some((c) => c.toLowerCase() === input.color!.toLowerCase())
  ) {
    return {
      status: "not_a_color",
      product: product.name,
      color: input.color,
      colors: product.colors,
    };
  }

  const rows = await readInventory();
  if (rows === null) {
    return {
      status: "unavailable",
      message: "Stock can't be checked right now. Please try again shortly.",
    };
  }

  const wanted =
    input.color === undefined
      ? product.colors
      : product.colors.filter(
          (c) => c.toLowerCase() === input.color!.toLowerCase(),
        );

  const colors = wanted.flatMap((color) => {
    const row = rows.find(
      (r) => r.product === product.name && r.color === color,
    );
    if (!row) return [];
    const stock: Stock =
      row.units_in_stock === 0
        ? "backordered"
        : row.units_in_stock < 10
          ? "low_stock"
          : "in_stock";
    return [
      {
        color,
        stock,
        restockDate: stock === "backordered" ? row.next_shipment : null,
      },
    ];
  });

  return { status: "ok", product: product.name, colors };
}

export const compareProductsInput: z.ZodType<CompareProductsInput> = z
  .strictObject({ products: z.array(z.enum(productIds)).length(2) })
  .refine((v) => v.products[0] !== v.products[1], {
    message: "Pick two different products to compare.",
  });

/**
 * compare_products: two products side by side. Price and features come from
 * the catalog; stock comes from check_availability, so it is read fresh and
 * says "unavailable" instead of guessing when stock can't be read.
 */
export async function compareProducts(
  input: CompareProductsInput,
): Promise<ProductComparison> {
  const catalog = getProducts();
  const compared = await Promise.all(
    input.products.map(async (id) => {
      const product = catalog.find((p) => p.id === id)!;
      const availability = await checkAvailability({ product: id });

      let stock: ProductComparison["products"][number]["stock"];
      if (availability.status === "ok") {
        const availableNow = availability.colors.some(
          (c) => c.stock !== "backordered",
        );
        // Dates are YYYY-MM-DD, so sorting them as text sorts them by day.
        const dates = availability.colors
          .flatMap((c) => (c.restockDate ? [c.restockDate] : []))
          .sort();
        stock = {
          status: "ok",
          colors: availability.colors,
          availableNow,
          earliestRestock: availableNow ? null : (dates[0] ?? null),
        };
      } else if (availability.status === "unavailable") {
        stock = { status: "unavailable", message: availability.message };
      } else {
        stock = {
          status: "unavailable",
          message: "Stock can't be checked right now.",
        };
      }

      return {
        id,
        name: product.name,
        type: product.type,
        priceUsd: product.priceUsd,
        features: product.features.map((f) => f.name),
        stock,
      };
    }),
  );

  const [a, b] = compared;
  const gap = round2(Math.abs(a.priceUsd - b.priceUsd));
  const cheap = a.priceUsd <= b.priceUsd ? a : b;
  return {
    products: compared,
    cheaper:
      gap === 0 ? null : { id: cheap.id, name: cheap.name, savesUsd: gap },
  };
}

export const copperTools = {
  get_products: tool({
    description:
      "List every Copper product with its type, price and the colors it comes in (not stock).",
    inputSchema: z.object({}),
    execute: async () => listProducts(),
  }),
  get_prices: tool({
    description: "Get the current price of every product and plan.",
    inputSchema: z.object({}),
    execute: async () => getPrices(),
  }),
  calculate_cost: tool({
    description:
      "Calculate the total cost of devices plus a plan (counted once per household) over 1 to 5 years.",
    inputSchema: calculateCostInput,
    execute: async (input) => calculateCost(input),
  }),
  check_availability: tool({
    description:
      "Check today's stock for a product, or for one color of it, including restock dates.",
    inputSchema: checkAvailabilityInput,
    execute: async (input) => checkAvailability(input),
  }),
  compare_products: tool({
    description:
      "Compare two different Copper products side by side: price, features, which is cheaper, and which colors are in stock today (with restock dates when sold out).",
    inputSchema: compareProductsInput,
    execute: async (input) => compareProducts(input),
  }),
};
