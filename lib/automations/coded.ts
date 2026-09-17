import { money } from "./format";
import type { MutatingAutomation } from "./types";

/**
 * The automations that are still code, and why.
 *
 * Everything else is a JSON recipe in `data/automations.default.json`. These
 * two are not, because each one needs a calculation that no field path can
 * stand in for:
 *
 *   - `retry_invoice` has to *find* the failed invoice in a list, then add one
 *     to its attempt count.
 *   - `file_bug` has to cut the last four characters off a request id and
 *     append a new item to a list.
 *
 * A schema that could express those would be a programming language, so the
 * honest answer is a function. This file is the escape hatch the recipe
 * builder points at with "Copy as TypeScript", and the shape is identical, so
 * nothing downstream knows the difference.
 *
 * `run` is pure. `Reset user` puts the record back, so both are safe to fire
 * in a demo.
 *
 * Fact keys follow the rule in `./types.ts`: a record path formats that field,
 * anything else is camelCase and derived. `{{reason}}` in a `blockedReply` is
 * derived — it is the guard's own sentence.
 */

/** Queue another attempt on a failed invoice — unless the card would fail again. */
const retryInvoice: MutatingAutomation = {
  id: "retry_invoice",
  kind: "mutating",
  title: "Retry a failed invoice",
  blockedReply:
    "I did not retry it: {{reason}} Update the card under Billing > Payment method, then ask me to retry.",
  read: (user) => {
    const sub = user.subscription;
    const failed = sub.invoices.find((invoice) => invoice.status === "failed");
    const card = sub.paymentMethod;
    return {
      failedInvoice: failed
        ? `${failed.id} for ${money(failed.amount, sub.currency)}`
        : "the open invoice",
      cardLabel: `${card.brand} ending ${card.last4}`,
    };
  },
  guard: (user) => {
    const sub = user.subscription;
    const card = sub.paymentMethod;
    if (card.expired) {
      return `the ${card.brand} ending ${card.last4} expired ${card.expires}, so another attempt fails the same way.`;
    }
    if (!sub.invoices.some((invoice) => invoice.status === "failed" && invoice.retryable)) {
      return "there is no failed invoice on the account to retry.";
    }
    return null;
  },
  run: (user) => {
    const at = new Date().toISOString();
    return {
      user: {
        ...user,
        subscription: {
          ...user.subscription,
          invoices: user.subscription.invoices.map((invoice) =>
            invoice.status === "failed" && invoice.retryable
              ? {
                  ...invoice,
                  status: "retry_queued",
                  attempts: (invoice.attempts ?? 0) + 1,
                  nextRetryAt: at,
                }
              : invoice,
          ),
        },
      },
    };
  },
};

/** File a bug, with the last error and the environment attached. */
const fileBug: MutatingAutomation = {
  id: "file_bug",
  kind: "mutating",
  title: "File a bug from the last error",
  blockedReply:
    "I could not file it: {{reason}} Send me the exact error text and the time it happened, and a person will pick it up.",
  read: (user) => {
    const tech = user.technical;
    return {
      "technical.browser": tech.browser,
      "technical.sdk": tech.sdk,
      "technical.lastError.message": tech.lastError
        ? tech.lastError.message
        : "the problem you described",
      "technical.lastError.requestId": tech.lastError ? tech.lastError.requestId : "none recorded",
    };
  },
  guard: (user) =>
    user.technical.lastError
      ? null
      : "nothing has failed on your workspace recently, so there is no error for me to attach.",
  run: (user) => {
    const error = user.technical.lastError;
    // Derived from the request id, so the same error always files the same
    // ticket number. Demo data, but it behaves like a real reference.
    const ticket = `BUG-${(error?.requestId ?? "0000").slice(-4)}`;
    return {
      user: {
        ...user,
        technical: {
          ...user.technical,
          openTickets: [
            ...user.technical.openTickets.filter((open) => open.id !== ticket),
            {
              id: ticket,
              title: error?.message ?? "Reported from support chat",
              status: "new",
              openedAt: new Date().toISOString().slice(0, 10),
            },
          ],
        },
      },
      facts: { ticket },
    };
  },
};

export const CODED: MutatingAutomation[] = [retryInvoice, fileBug];
