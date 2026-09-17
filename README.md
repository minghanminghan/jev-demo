# jev demo

A customer-service chatbot routed by jev.

## Run it

```bash
npm install
npm run dev
```

## The idea

**One API call per turn.** The bot does not walk the tree one call at a time.
jev answers every question in a call in parallel, so the bot asks *every* level
up front and throws away the answers it did not need — the docs' speculative
fan-out. A three-level answer is one round trip. Riding along in the same call:
a `Noul` for "does this person want a human?" and a `Score` for frustration.
Either can hand off before the walk starts, and so does low confidence at any
level.