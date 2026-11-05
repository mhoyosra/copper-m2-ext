// The chat panel has to know about compare_products too: it lists the tools
// Copper can use and shows what Copper sent each tool. These tests use a fake
// answer, so they need no AI key and cost nothing.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createLive } from "@/lib/ai/live";
import type { Progress, Step } from "@/lib/copper/assistant/progress";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
  vi.unstubAllEnvs();
  vi.doUnmock("@/lib/copper/assistant/ask");
  vi.resetModules();
});

async function renderPage() {
  vi.resetModules();
  const { default: Home } = await import("@/app/page");
  const page = Home as unknown as () =>
    React.ReactNode | Promise<React.ReactNode>;
  const ui =
    Home.constructor.name === "AsyncFunction" ? await page() : <Home />;
  return render(<>{ui}</>);
}

function answered(reply: string, steps: Step[] = []) {
  const done = createLive<Progress>();
  done.done({ steps, reply, status: "done" });
  return { progress: done.live };
}

const home = {
  id: "copper-home",
  name: "Copper Home",
  type: "AI smart speaker",
  priceUsd: 149,
  features: ["Household Memory", "Smart-home control"],
  stock: {
    status: "ok",
    colors: [
      { color: "Polished Copper", stock: "in_stock", restockDate: null },
      { color: "Patina Teal", stock: "low_stock", restockDate: null },
    ],
  },
};
const notes = {
  id: "copper-notes",
  name: "Copper Notes",
  type: "AI clip-on recorder",
  priceUsd: 129,
  features: ["Meeting Mode", "Lecture Mode"],
  stock: {
    status: "ok",
    colors: [
      { color: "Night Sky", stock: "backordered", restockDate: "2026-11-14" },
    ],
  },
};

const compareStep = (output: unknown): Step => ({
  type: "tool",
  id: "call-1",
  name: "compare_products",
  state: "done",
  input: { products: ["copper-home", "copper-notes"] },
  output,
});

async function openChatWith(askCopper: ReturnType<typeof vi.fn>) {
  vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "AIza-test-key");
  vi.doMock("@/lib/copper/assistant/ask", () => ({ askCopper }));
  await renderPage();
  fireEvent.click(screen.getByTestId("ask-copper-launcher"));
  return screen.findByTestId("ask-copper");
}

describe("the chat panel and compare_products", () => {
  it("lists compare_products with the other tools Copper can use", async () => {
    const askCopper = vi.fn().mockResolvedValue(answered("Sure."));
    const section = await openChatWith(askCopper);
    // The list shows up with the first question, above Copper's steps.
    fireEvent.change(within(section).getByRole("textbox"), {
      target: { value: "What can you do?" },
    });
    fireEvent.click(within(section).getByRole("button", { name: /send/i }));
    await waitFor(() =>
      expect(within(section).getByText("Sure.")).toBeInTheDocument(),
    );
    for (const name of [
      "get_products",
      "get_prices",
      "calculate_cost",
      "check_availability",
      "compare_products",
    ]) {
      expect(
        within(section).getByText(name),
        `${name} is listed`,
      ).toBeInTheDocument();
    }
  });

  it("shows the two products Copper sent, not a blank product and color", async () => {
    const askCopper = vi.fn().mockResolvedValue(
      answered("Copper Notes is $20 cheaper.", [
        compareStep({
          products: [home, notes],
          cheaper: { id: "copper-notes", name: "Copper Notes", savesUsd: 20 },
        }),
      ]),
    );
    const section = await openChatWith(askCopper);
    const chat = within(section);

    fireEvent.change(chat.getByRole("textbox"), {
      target: { value: "Copper Home vs Copper Notes?" },
    });
    fireEvent.click(chat.getByRole("button", { name: /send/i }));
    await waitFor(() =>
      expect(
        chat.getByText("Copper Notes is $20 cheaper."),
      ).toBeInTheDocument(),
    );

    const card = section.querySelector<HTMLElement>(
      '[data-testid="tool-call"]',
    )!;
    expect(card.dataset.tool).toBe("compare_products");
    expect(card.textContent).toContain("Copper Home vs Copper Notes");
    expect(card.textContent).not.toMatch(/undefined/);
    expect(card.textContent).not.toMatch(/All colors/);
  });
});

async function showCard(output: unknown) {
  const askCopper = vi
    .fn()
    .mockResolvedValue(answered("Here you go.", [compareStep(output)]));
  const section = await openChatWith(askCopper);
  const chat = within(section);
  fireEvent.change(chat.getByRole("textbox"), {
    target: { value: "Compare?" },
  });
  fireEvent.click(chat.getByRole("button", { name: /send/i }));
  await waitFor(() =>
    expect(chat.getByText("Here you go.")).toBeInTheDocument(),
  );
  return section.querySelector<HTMLElement>('[data-testid="tool-call"]')!;
}

describe("what came back from compare_products", () => {
  it("reads as a comparison, not raw data", async () => {
    const card = await showCard({
      products: [home, notes],
      cheaper: { id: "copper-notes", name: "Copper Notes", savesUsd: 20 },
    });
    const text = card.textContent ?? "";
    // Each product with its price, type and features.
    expect(text).toContain("Copper Home");
    expect(text).toContain("$149");
    expect(text).toContain("$129");
    expect(text).toContain("AI smart speaker");
    expect(text).toContain("Household Memory");
    // Each color with its stock, including the restock date.
    expect(text).toContain("Polished Copper");
    expect(text).toContain("In stock");
    expect(text).toContain("Low stock");
    expect(text).toMatch(/Back-ordered until Nov 14, 2026/);
    // The bottom line.
    expect(text).toContain("Copper Notes is $20 cheaper");
    // Not the raw JSON the other tools never show.
    expect(text).not.toContain('{"products"');
    expect(text).not.toContain("restockDate");
  });

  it("says so when the two products cost the same", async () => {
    const card = await showCard({
      products: [home, { ...notes, priceUsd: 149 }],
      cheaper: null,
    });
    expect(card.textContent).toContain("Both cost the same");
  });

  it("shows the message when stock can't be checked", async () => {
    const down = {
      status: "unavailable",
      message: "Stock can't be checked right now. Please try again shortly.",
    };
    const card = await showCard({
      products: [
        { ...home, stock: down },
        { ...notes, stock: down },
      ],
      cheaper: { id: "copper-notes", name: "Copper Notes", savesUsd: 20 },
    });
    expect(card.textContent).toContain("Stock can't be checked right now");
    // The prices still show, because they don't need stock.
    expect(card.textContent).toContain("$149");
  });
});
