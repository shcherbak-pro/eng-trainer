/**
 * Compile-time product constants (ENG-V3-01).
 *
 * Vite replaces each name with a literal while it builds one product; the values come
 * from site.config.json through scripts/site-config.mjs. They are not variables: a
 * condition on a constant that is false disappears from that product's build together
 * with everything only it reaches. Two rules keep that true:
 *
 * - use the bare name in the condition, never a copy in a variable or an object;
 * - never put such a condition inside a `try` block. The bundler keeps everything
 *   inside a `try` block, also a branch that can never run.
 *
 * The released-site lock (scripts/check-products.mjs) fails when either rule is broken.
 *
 * Product identity never depends on the address the application is published at.
 */

/** The base path of the whole site, for example "/eng-trainer/". Links to other versions start here. */
declare const __SITE_BASE__: string;

/** The product this build is. */
declare const __ENG_PRODUCT__: 'stable-v2' | 'experimental-v3';

/** The IndexedDB database of this product. */
declare const __ENG_DATABASE__: 'eng-trainer-v2' | 'eng-trainer-v3';

/**
 * Whether this product is built with the pronunciation capability. It is a build
 * capability only: ENG-V3-01 contains no recording, recognition or model code.
 */
declare const __ENG_PRONUNCIATION__: boolean;

/** Addresses of the other published products, taken from the route list. */
declare const __ENG_VERSION_LINKS__: readonly { product: 'stable-v2' | 'experimental-v3' | 'legacy-v1'; href: string }[];
