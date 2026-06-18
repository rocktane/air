/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as crons from "../crons.js";
import type * as digest from "../digest.js";
import type * as digests from "../digests.js";
import type * as editions from "../editions.js";
import type * as email from "../email.js";
import type * as fetchers from "../fetchers.js";
import type * as filtering from "../filtering.js";
import type * as items from "../items.js";
import type * as reader from "../reader.js";
import type * as reads from "../reads.js";
import type * as settings from "../settings.js";
import type * as sources from "../sources.js";
import type * as summary from "../summary.js";
import type * as urls from "../urls.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  crons: typeof crons;
  digest: typeof digest;
  digests: typeof digests;
  editions: typeof editions;
  email: typeof email;
  fetchers: typeof fetchers;
  filtering: typeof filtering;
  items: typeof items;
  reader: typeof reader;
  reads: typeof reads;
  settings: typeof settings;
  sources: typeof sources;
  summary: typeof summary;
  urls: typeof urls;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
