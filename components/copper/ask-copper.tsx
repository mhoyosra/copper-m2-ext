"use client";

// Module 2: the Ask Copper chat panel. It calls the askCopper Server Action
// and draws each answer as stations on a rail (the tools on offer, Copper
// thinking, each tool call, the reply), so you can watch the agent loop.
// The layout is described in specs/module-2/spec.md, section 5.
import {
  ArrowUpIcon,
  BrainIcon,
  MessageCircleIcon,
  SparklesIcon,
  WrenchIcon,
} from "lucide-react";
import Image from "next/image";
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { SetupRequired } from "@/components/setup-required";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { readLive } from "@/lib/ai/live";
import { askCopper, type ChatMessage } from "@/lib/copper/assistant/ask";
import {
  TOOL_LABELS,
  type Progress,
  type ToolStep,
} from "@/lib/copper/assistant/progress";
import { formatUsd, getPlans, getProducts } from "@/lib/copper/catalog";
import { cn } from "@/lib/utils";

const STARTERS = [
  "How much is Copper Home with Copper Plus, paid yearly, for 2 years?",
  "Is Copper Notes in Night Sky in stock?",
  "Is Copper Plus cheaper monthly or yearly?",
];

type Turn = { id: number; question: string; progress: Progress };
type Chats = { on: Turn[]; off: Turn[] };

const WORKING: Progress = { steps: [], reply: "", status: "working" };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export function AskCopper({ aiConfigured }: { aiConfigured: boolean }) {
  const [open, setOpen] = useState(false);
  const [useTools, setUseTools] = useState(true);
  const [chats, setChats] = useState<Chats>({ on: [], off: [] });
  const [draft, setDraft] = useState("");
  const nextId = useRef(1);
  const body = useRef<HTMLDivElement>(null);

  // The launcher, the header's "Ask Copper" link and /#ask all open the panel.
  // Clicking the link when the address already ends in #ask fires no
  // hashchange, so listen for the click as well.
  useEffect(() => {
    const openIfAsk = () => {
      if (window.location.hash === "#ask") setOpen(true);
    };
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.("a");
      if (link?.getAttribute("href")?.endsWith("#ask")) setOpen(true);
    };
    queueMicrotask(openIfAsk);
    window.addEventListener("hashchange", openIfAsk);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("hashchange", openIfAsk);
      document.removeEventListener("click", onClick);
    };
  }, []);

  const key = useTools ? "on" : "off";
  const turns = chats[key];
  const streaming = turns.some((turn) => turn.progress.status === "working");

  // Keep the newest step in view as the answer streams in.
  useEffect(() => {
    const el = body.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, open]);

  async function send(question: string) {
    const text = question.trim();
    if (!text || streaming) return;
    const chat = key;
    const tools = useTools;
    const id = nextId.current++;

    // Each chat sends only its own finished turns.
    const messages: ChatMessage[] = chats[chat]
      .filter((turn) => turn.progress.status === "done")
      .flatMap((turn): ChatMessage[] => [
        { role: "user", content: turn.question },
        { role: "assistant", content: turn.progress.reply },
      ]);
    messages.push({ role: "user", content: text });

    const setProgress = (progress: Progress) =>
      setChats((all) => ({
        ...all,
        [chat]: all[chat].map((turn) =>
          turn.id === id ? { ...turn, progress } : turn,
        ),
      }));

    setDraft("");
    setChats((all) => ({
      ...all,
      [chat]: [...all[chat], { id, question: text, progress: WORKING }],
    }));

    try {
      const { progress } = await askCopper({ messages, useTools: tools });
      for await (const update of readLive(progress)) setProgress(update);
    } catch {
      setProgress({
        steps: [],
        reply: "Sorry, I couldn't answer that. Please try again.",
        status: "error",
      });
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send(draft);
  }

  return (
    <>
      <Button
        data-testid="ask-copper-launcher"
        onClick={() => setOpen(true)}
        className="fixed right-4 bottom-4 z-40 h-12 gap-2 rounded-full px-5 shadow-lg"
      >
        <MessageCircleIcon className="size-5" />
        Ask Copper
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          data-testid="ask-copper"
          showCloseButton
          className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md"
        >
          <header className="bg-chart-5 text-background space-y-3 px-4 pt-4 pb-3">
            <div className="flex items-center gap-3 pr-10">
              <span className="bg-primary flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full">
                <Image
                  src="/assets/brand/copper-mascot.png"
                  alt="Copper, the Copper State Labs mascot"
                  width={40}
                  height={40}
                  className="size-10 object-cover"
                />
              </span>
              <div>
                <SheetTitle className="text-background text-base">
                  Ask Copper
                </SheetTitle>
                <SheetDescription className="text-background/80 text-xs">
                  Prices, totals and stock, checked with tools.
                </SheetDescription>
              </div>
            </div>
            <div className="bg-background/10 flex items-center justify-between rounded-lg px-3 py-2">
              <div>
                <p className="text-sm font-medium">Use tools</p>
                <p className="text-background/80 text-xs">
                  {useTools ? "Checks every answer" : "Model guesses alone"}
                </p>
              </div>
              <Switch
                aria-label="Use tools"
                checked={useTools}
                onCheckedChange={setUseTools}
              />
            </div>
          </header>

          {aiConfigured ? (
            <>
              <div
                ref={body}
                className="bg-secondary flex-1 space-y-6 overflow-y-auto px-4 py-4"
              >
                {turns.map((turn) => (
                  <Exchange key={turn.id} turn={turn} useTools={useTools} />
                ))}
                {!streaming && (
                  <div className="flex flex-col items-start gap-2">
                    {STARTERS.map((starter) => (
                      <button
                        key={starter}
                        type="button"
                        onClick={() => void send(starter)}
                        className="bg-background text-foreground hover:border-primary rounded-2xl border px-3 py-2 text-left text-sm transition-colors"
                      >
                        {starter}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <form
                onSubmit={onSubmit}
                className="bg-background flex items-center gap-2 border-t p-3"
              >
                <Input
                  aria-label="Your question"
                  placeholder="Ask about prices, colors or stock"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  className="rounded-full"
                />
                <Button
                  type="submit"
                  size="icon"
                  aria-label="Send"
                  disabled={streaming}
                  className="shrink-0 rounded-full"
                >
                  <ArrowUpIcon className="size-4" />
                </Button>
              </form>
            </>
          ) : (
            <div className="bg-secondary flex-1 overflow-y-auto px-4">
              <SetupRequired service="ai" />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

/** One question and its answer: the shopper's bubble, then the stations. */
function Exchange({ turn, useTools }: { turn: Turn; useTools: boolean }) {
  const { progress } = turn;
  const working = progress.status === "working";
  const toolSteps = progress.steps.filter(
    (step): step is ToolStep => step.type === "tool",
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <p className="bg-primary text-primary-foreground max-w-[85%] rounded-2xl rounded-br-sm px-3 py-2 text-sm">
          {turn.question}
        </p>
      </div>

      <div className="relative space-y-4">
        <div
          aria-hidden
          className={cn(
            "absolute top-3 bottom-3 left-[11px] w-0.5 rounded-full bg-linear-to-b",
            useTools
              ? "from-primary via-accent to-accent"
              : "from-chart-3 to-chart-3",
          )}
        />

        <Station
          icon={<SparklesIcon className="size-3.5" />}
          nodeClass={useTools ? "bg-primary" : "bg-chart-3"}
          label={
            useTools ? "Tools Copper can use" : "Tools given to Copper: none"
          }
        >
          <div className="flex flex-wrap gap-1.5">
            {Object.keys(TOOL_LABELS).map((name) => {
              const used = useTools && toolSteps.some((s) => s.name === name);
              return (
                <span
                  key={name}
                  className={cn(
                    "rounded-full px-2 py-0.5 font-mono text-xs",
                    used
                      ? "bg-accent text-accent-foreground font-bold"
                      : "bg-muted text-muted-foreground",
                    !useTools && "line-through",
                  )}
                >
                  {name}
                </span>
              );
            })}
          </div>
          {!useTools && (
            <p className="text-muted-foreground mt-1.5 text-xs">
              Copper has to answer from memory alone.
            </p>
          )}
        </Station>

        {progress.steps.map((step, index) => {
          if (step.type === "thinking") {
            return (
              <Station
                key={index}
                icon={<BrainIcon className="size-3.5" />}
                nodeClass={useTools ? "bg-primary" : "bg-chart-3"}
                label="Copper is thinking"
              >
                <p
                  data-testid="thinking"
                  className="text-muted-foreground border-l-2 pl-3 text-sm italic"
                >
                  {renderInline(step.text)}
                </p>
              </Station>
            );
          }
          return (
            <Station
              key={step.id}
              icon={<WrenchIcon className="size-3.5" />}
              nodeClass="bg-accent"
              label={
                step.state === "calling"
                  ? "Copper is calling a tool"
                  : "Copper called a tool"
              }
            >
              <ToolCard step={step} number={toolSteps.indexOf(step) + 1} />
            </Station>
          );
        })}

        {working && (
          <div className="relative pl-9">
            <span className="bg-primary ring-secondary absolute top-0 left-0 flex size-6 items-center justify-center gap-0.5 rounded-full ring-4">
              {[0, 1, 2].map((dot) => (
                <span
                  key={dot}
                  className="bg-primary-foreground size-1 animate-bounce rounded-full"
                  style={{ animationDelay: `${dot * 120}ms` }}
                />
              ))}
            </span>
            <p className="text-muted-foreground pt-0.5 text-sm">
              {workingText(progress, useTools)}
            </p>
          </div>
        )}
      </div>

      {(progress.reply !== "" || !working) && (
        <div className="bg-card text-card-foreground max-w-[92%] rounded-2xl rounded-tl-sm border p-3 text-sm">
          <p className="text-primary mb-1 text-xs font-semibold">Copper</p>
          {!useTools && (
            <div className="border-chart-3 mb-2 rounded-lg border p-2 text-xs">
              <p className="font-semibold">
                ⚠ Answered without tools: may be made up
              </p>
              <p className="text-muted-foreground mt-1">
                With tools off, Copper can&apos;t see today&apos;s prices or
                stock. The AI only has what it learned in training, so it fills
                the gaps with guesses that sound right. That&apos;s a
                hallucination.
              </p>
            </div>
          )}
          <p className="whitespace-pre-wrap">
            {progress.reply}
            {working && <span className="animate-pulse">▍</span>}
          </p>
        </div>
      )}
    </div>
  );
}

function workingText(progress: Progress, useTools: boolean) {
  if (progress.reply !== "") return "Writing the answer…";
  if (!useTools) return "Answering from memory…";
  if (progress.steps.length > 0) return "Deciding what to do next…";
  return "Reading your question…";
}

/** A node on the rail, with a small label and the station's contents. */
function Station({
  icon,
  nodeClass,
  label,
  children,
}: {
  icon: ReactNode;
  nodeClass: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="relative pl-9">
      <span
        className={cn(
          "text-primary-foreground ring-secondary absolute top-0 left-0 flex size-6 items-center justify-center rounded-full ring-4",
          nodeClass,
        )}
      >
        {icon}
      </span>
      <p className="text-muted-foreground mb-1.5 text-xs font-semibold tracking-widest uppercase">
        {label}
      </p>
      {children}
    </div>
  );
}

/** Renders the **bold** and `code` marks in a thought summary. */
function renderInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={i} className="font-mono not-italic">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

/** The tool call card: always open, what Copper sent, then what came back. */
function ToolCard({ step, number }: { step: ToolStep; number: number }) {
  const label = TOOL_LABELS[step.name] ?? step.name;
  return (
    <div
      data-testid="tool-call"
      data-tool={step.name}
      className="bg-card overflow-hidden rounded-lg border text-sm"
    >
      <div className="bg-accent text-accent-foreground flex items-center gap-2 px-3 py-1.5">
        <span className="font-mono font-bold">{step.name}()</span>
        <span className="bg-background/30 rounded-full px-1.5 text-xs">
          tool {number}
        </span>
        <span className="ml-auto text-xs">{label}</span>
      </div>
      <div className="space-y-1 px-3 py-2">
        <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          → What Copper sent
        </p>
        <SentInput step={step} />
      </div>
      <div className="bg-accent/10 space-y-1 border-t px-3 py-2">
        <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          ← What came back
        </p>
        <CameBack step={step} />
      </div>
    </div>
  );
}

function Fields({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
      {rows.map(([name, value]) => (
        <div key={name} className="contents">
          <dt className="text-muted-foreground">{name}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

const PRODUCT_NAMES = () =>
  Object.fromEntries(getProducts().map((p) => [p.id, p.name]));
const PLAN_NAMES = () =>
  Object.fromEntries(getPlans().map((p) => [p.id, p.name]));

function SentInput({ step }: { step: ToolStep }) {
  if (step.name === "get_prices") {
    return <p>Nothing, it just asked for the price list</p>;
  }
  if (step.name === "get_products") {
    return <p>Nothing, it just asked what Copper sells</p>;
  }
  const input = step.input;
  if (!isRecord(input)) {
    return (
      <p className="text-muted-foreground italic">
        {step.state === "calling" ? "filling in the details…" : "No details"}
      </p>
    );
  }
  const products = PRODUCT_NAMES();
  if (step.name === "compare_products") {
    const ids = Array.isArray(input.products) ? input.products : [];
    return (
      <Fields
        rows={[
          [
            "Products",
            ids.length
              ? ids.map((id) => products[String(id)] ?? String(id)).join(" vs ")
              : "None",
          ],
        ]}
      />
    );
  }
  if (step.name === "calculate_cost") {
    const ids = Array.isArray(input.products) ? input.products : [];
    return (
      <Fields
        rows={[
          [
            "Products",
            ids.length
              ? ids.map((id) => products[String(id)] ?? String(id)).join(", ")
              : "None",
          ],
          ["Plan", PLAN_NAMES()[String(input.plan)] ?? String(input.plan)],
          ["Billing", String(input.billing)],
          ["Years", String(input.years)],
        ]}
      />
    );
  }
  return (
    <Fields
      rows={[
        ["Product", products[String(input.product)] ?? String(input.product)],
        ["Color", input.color ? String(input.color) : "All colors"],
      ]}
    />
  );
}

function Pill({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn("rounded-full px-2 py-0.5 text-xs font-medium", className)}
    >
      {children}
    </span>
  );
}

const restockLabel = (date: string | null) =>
  date
    ? new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : "";

type ColorStock = {
  color: string;
  stock: string;
  restockDate: string | null;
};

/** One color's stock as a colored pill, like check_availability shows it. */
function StockPill({ c }: { c: ColorStock }) {
  if (c.stock === "in_stock") {
    return <Pill className="bg-accent text-accent-foreground">In stock</Pill>;
  }
  if (c.stock === "low_stock") {
    return <Pill className="bg-chart-4 text-chart-5">Low stock</Pill>;
  }
  return (
    <Pill className="bg-chart-3 text-chart-5">
      Back-ordered until {restockLabel(c.restockDate)}
    </Pill>
  );
}

type ComparedProduct = {
  id: string;
  name: string;
  type: string;
  priceUsd: number;
  features: string[];
  stock:
    | { status: "ok"; colors: ColorStock[] }
    | { status: "unavailable"; message: string };
};

function CameBack({ step }: { step: ToolStep }) {
  if (step.state === "calling") {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-xs">
        <Spinner className="size-3" />
        the app is running the code…
      </p>
    );
  }
  const out = step.output;
  if (step.state === "error" || !isRecord(out)) {
    return <p>{typeof out === "string" ? out : "That didn't work."}</p>;
  }

  if (step.name === "calculate_cost" && Array.isArray(out.lines)) {
    return (
      <div>
        {out.lines.map((line: { item: string; usd: number }) => (
          <p key={line.item} className="flex justify-between gap-3">
            <span>{line.item}</span>
            <span>{formatUsd(line.usd)}</span>
          </p>
        ))}
        <p className="text-primary mt-1 flex items-baseline justify-between border-t pt-1 text-lg font-bold">
          <span>Total</span>
          <span>{formatUsd(Number(out.totalUsd))}</span>
        </p>
      </div>
    );
  }

  if (step.name === "get_products" && Array.isArray(out.products)) {
    return (
      <div className="space-y-2">
        {out.products.map(
          (p: {
            id: string;
            name: string;
            type: string;
            priceUsd: number;
            colors: string[];
          }) => (
            <div key={p.id}>
              <p className="flex justify-between font-medium">
                <span>{p.name}</span>
                <span>{formatUsd(p.priceUsd)}</span>
              </p>
              <p className="text-muted-foreground text-xs">{p.type}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {p.colors.map((color) => (
                  <Pill
                    key={color}
                    className="bg-accent text-accent-foreground"
                  >
                    {color}
                  </Pill>
                ))}
              </div>
            </div>
          ),
        )}
      </div>
    );
  }

  if (step.name === "get_prices" && Array.isArray(out.products)) {
    const plans = Array.isArray(out.plans) ? out.plans : [];
    return (
      <div>
        {out.products.map(
          (p: { id: string; name: string; priceUsd: number }) => (
            <p key={p.id} className="flex justify-between">
              <span>{p.name}</span>
              <span>{formatUsd(p.priceUsd)}</span>
            </p>
          ),
        )}
        {plans
          .filter((p: { monthlyUsd: number }) => p.monthlyUsd > 0)
          .map(
            (p: {
              id: string;
              name: string;
              monthlyUsd: number;
              annualUsd: number;
            }) => (
              <p key={p.id} className="flex justify-between">
                <span>{p.name}</span>
                <span>
                  {formatUsd(p.monthlyUsd)}/mo · {formatUsd(p.annualUsd)}/yr
                </span>
              </p>
            ),
          )}
      </div>
    );
  }

  if (step.name === "compare_products" && Array.isArray(out.products)) {
    const cheaper = isRecord(out.cheaper) ? out.cheaper : null;
    return (
      <div className="space-y-3">
        {out.products.map((p: ComparedProduct) => (
          <div key={p.id} className="space-y-1">
            <p className="flex justify-between font-medium">
              <span>{p.name}</span>
              <span>{formatUsd(p.priceUsd)}</span>
            </p>
            <p className="text-muted-foreground text-xs">
              {p.type} · {p.features.join(", ")}
            </p>
            {p.stock.status === "ok" ? (
              p.stock.colors.map((c) => (
                <p
                  key={c.color}
                  className="flex items-center justify-between gap-2"
                >
                  <span>{c.color}</span>
                  <StockPill c={c} />
                </p>
              ))
            ) : (
              <p>{p.stock.message}</p>
            )}
          </div>
        ))}
        <p className="text-primary border-t pt-1 font-bold">
          {cheaper
            ? `${String(cheaper.name)} is ${formatUsd(Number(cheaper.savesUsd))} cheaper`
            : "Both cost the same"}
        </p>
      </div>
    );
  }

  if (step.name === "check_availability") {
    if (out.status === "not_a_color") {
      const colors = Array.isArray(out.colors) ? out.colors.join(", ") : "";
      return (
        <p>
          {String(out.product)} doesn&apos;t come in {String(out.color)}. Its
          colors are {colors}.
        </p>
      );
    }
    if (out.status === "unavailable") return <p>{String(out.message)}</p>;
    if (out.status === "ok" && Array.isArray(out.colors)) {
      return (
        <div className="space-y-1">
          {out.colors.map(
            (c: {
              color: string;
              stock: string;
              restockDate: string | null;
            }) => (
              <p
                key={c.color}
                className="flex items-center justify-between gap-2"
              >
                <span>{c.color}</span>
                {c.stock === "in_stock" && (
                  <Pill className="bg-accent text-accent-foreground">
                    In stock
                  </Pill>
                )}
                {c.stock === "low_stock" && (
                  <Pill className="bg-chart-4 text-chart-5">Low stock</Pill>
                )}
                {c.stock === "backordered" && (
                  <Pill className="bg-chart-3 text-chart-5">
                    Back-ordered until {restockLabel(c.restockDate)}
                  </Pill>
                )}
              </p>
            ),
          )}
        </div>
      );
    }
  }

  return <p>{JSON.stringify(out)}</p>;
}
