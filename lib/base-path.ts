/**
 * The path this app is mounted under.
 *
 * It is not served at the root of its own host any more: the personal site
 * rewrites `/jev-demo/*` through to this project, so every URL the app hands
 * out — pages, `/_next/*` assets, the two pass-throughs in `app/api/` — has to
 * carry this prefix or it lands on the site instead.
 *
 * `next.config.ts` feeds it to `basePath`, which covers `next/link`,
 * `next/font` and the asset URLs. It does **not** cover a `fetch` written by
 * hand, so `lib/types.ts` prefixes the two proxy paths with it as well.
 *
 * Empty string here puts the app back at the root, and nothing else needs to
 * change to follow.
 */
export const BASE_PATH = "/jev-demo";
