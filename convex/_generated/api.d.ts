/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as digest from "../digest.js";
import type * as fetchers from "../fetchers.js";
import type * as items from "../items.js";
import type * as reader from "../reader.js";
import type * as settings from "../settings.js";
import type * as sources from "../sources.js";
import type * as urls from "../urls.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  digest: typeof digest;
  fetchers: typeof fetchers;
  items: typeof items;
  reader: typeof reader;
  settings: typeof settings;
  sources: typeof sources;
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
