// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// compare_products reads stock through readInventory(). These tests swap it
// for a fake so each one can decide what is on the shelf (or that the stock
// table can't be read), and check the tool's logic, not the database.
const { readInventory } = vi.hoisted(() => ({ readInventory: vi.fn() }));
vi.mock("@/lib/copper/inventory", () => ({ readInventory }));

const { compareProducts, compareProductsInput, copperTools } = await import(
  "@/lib/copper/assistant/tools"
);

// The same six rows the seed file inserts.
const seed = [
  { sku: "CH-POL", product: "Copper Home", color: "Polished Copper", units_in_stock: 240, next_shipment: "2026-11-20" },
  { sku: "CH-TEA", product: "Copper Home", color: "Patina Teal", units_in_stock: 6, next_shipment: "2026-11-06" },
  { sku: "CH-NSK", product: "Copper Home", color: "Night Sky", units_in_stock: 185, next_shipment: "2026-11-20" },
  { sku: "CN-BRC", product: "Copper Notes", color: "Brushed Copper", units_in_stock: 310, next_shipment: "2026-11-13" },
  { sku: "CN-DSA", product: "Copper Notes", color: "Desert Sand", units_in_stock: 92, next_shipment: "2026-11-13" },
  { sku: "CN-NSK", product: "Copper Notes", color: "Night Sky", units_in_stock: 0, next_shipment: "2026-11-14" },
];

describe("compare_products", () => {
  beforeEach(() => readInventory.mockResolvedValue(seed));

  it("puts the catalog price, type and features side by side", async () => {
    const r = await compareProducts({ products: ["copper-home", "copper-notes"] });
    expect(r.products.map((p) => p.name)).toEqual(["Copper Home", "Copper Notes"]);
    expect(r.products[0].priceUsd).toBe(149);
    expect(r.products[0].type).toBe("AI smart speaker");
    expect(r.products[0].features.length).toBeGreaterThan(0);
    expect(r.products[0].features).toContain("Household Memory");
  });

  it("says which product is cheaper and by how much", async () => {
    const r = await compareProducts({ products: ["copper-home", "copper-notes"] });
    const [home, notes] = r.products;
    expect(r.cheaper).toEqual({
      id: home.priceUsd <= notes.priceUsd ? home.id : notes.id,
      name: home.priceUsd <= notes.priceUsd ? home.name : notes.name,
      savesUsd: Math.round(Math.abs(home.priceUsd - notes.priceUsd) * 100) / 100,
    });
    // The order the shopper asked in doesn't change the answer.
    const flipped = await compareProducts({ products: ["copper-notes", "copper-home"] });
    expect(flipped.cheaper).toEqual(r.cheaper);
  });

  it("shows each color's stock and that something is available now", async () => {
    const r = await compareProducts({ products: ["copper-home", "copper-notes"] });
    const [home, notes] = r.products;
    expect(home.stock).toMatchObject({ status: "ok", availableNow: true, earliestRestock: null });
    expect(home.stock.status === "ok" && home.stock.colors.map((c) => c.stock)).toEqual([
      "in_stock",
      "low_stock",
      "in_stock",
    ]);
    // One Copper Notes color is back-ordered, but others are in stock.
    expect(notes.stock).toMatchObject({ status: "ok", availableNow: true });
    expect(
      notes.stock.status === "ok" &&
        notes.stock.colors.find((c) => c.color === "Night Sky"),
    ).toEqual({ color: "Night Sky", stock: "backordered", restockDate: "2026-11-14" });
  });

  it("gives the soonest restock date when a product is sold out everywhere", async () => {
    readInventory.mockResolvedValue(
      seed.map((row) =>
        row.product === "Copper Notes"
          ? {
              ...row,
              units_in_stock: 0,
              next_shipment: row.color === "Desert Sand" ? "2026-11-09" : "2026-11-14",
            }
          : row,
      ),
    );
    const r = await compareProducts({ products: ["copper-home", "copper-notes"] });
    expect(r.products[1].stock).toMatchObject({
      status: "ok",
      availableNow: false,
      earliestRestock: "2026-11-09",
    });
    // The other product is unaffected.
    expect(r.products[0].stock).toMatchObject({ availableNow: true });
  });

  it("says stock can't be checked instead of guessing", async () => {
    readInventory.mockResolvedValue(null);
    const r = await compareProducts({ products: ["copper-home", "copper-notes"] });
    for (const p of r.products) {
      expect(p.stock.status).toBe("unavailable");
    }
    // Price and features still come back, because they don't need stock.
    expect(r.products[0].priceUsd).toBe(149);
  });

  it("rejects input outside its contract", () => {
    const ok = { products: ["copper-home", "copper-notes"] };
    expect(compareProductsInput.safeParse(ok).success).toBe(true);
    for (const bad of [
      { products: ["copper-home"] },
      { products: ["copper-home", "copper-home"] },
      { products: ["copper-home", "copper-notes", "copper-home"] },
      { products: ["copper-home", "copper-toaster"] },
      { products: [] },
      { ...ok, extra: 1 },
      {},
    ]) {
      expect(compareProductsInput.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("is registered for the model, with a description", () => {
    expect(Object.keys(copperTools)).toContain("compare_products");
    expect(copperTools.compare_products.description).toMatch(/compare/i);
    expect(typeof copperTools.compare_products.execute).toBe("function");
  });
});
