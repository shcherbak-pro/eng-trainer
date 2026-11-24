// The one validated reader of site.config.json (ENG-V3-01).
//
// A *product* is what an application is: its database, its features and its content.
// A *route* is where a product is published inside the GitHub Pages site.
// The build, the assembly and every check read both from here, so an invalid or
// surprising configuration stops the run before anything is built or copied.
//
// `publish` is read from the committed file only. Nothing in this module reads an
// environment variable or a command-line argument.
//
// The file cannot choose folders (ENG-V3-01-RC1). Scripts empty and delete the folders
// they generate, so every product folder is fixed in code (scripts/generated-dirs.mjs)
// and the file must name exactly that folder. Any other value is an error, also another
// spelling of the same folder.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPERIMENTAL_BUILD_DIR, EXPERIMENTAL_PUBLIC_DIR, STABLE_BUILD_DIR, assertGeneratedDir } from './generated-dirs.mjs';

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SITE_CONFIG_FILE = 'site.config.json';

export const STABLE_PRODUCT = 'stable-v2';
export const EXPERIMENTAL_PRODUCT = 'experimental-v3';
export const LEGACY_PRODUCT = 'legacy-v1';

/**
 * What this code base knows about each product. The configuration file can only choose
 * among these products, and it must agree with the identities that are fixed here.
 *
 * - `app`: built from this repository's `src/` by vite.config.ts.
 * - `fixed`: values the file must state exactly. The stable product keeps its released
 *   database, folders and (absent) pronunciation capability; the frozen v1 project has
 *   its own build with a compiled-in base path, so its folder and route cannot move.
 *   Every folder of every product is fixed: `validateSiteConfig` refuses a rule without one.
 * - `stagedPublic`: the product's public folder is generated, and rebuilt from nothing on
 *   every run. The stable product's `public/` holds sources and is never removed.
 */
const PRODUCT_RULES = {
  [STABLE_PRODUCT]: {
    app: true,
    required: true,
    fixed: { database: 'eng-trainer-v2', pronunciation: false, publicDir: 'public', outDir: STABLE_BUILD_DIR }
  },
  [EXPERIMENTAL_PRODUCT]: {
    app: true,
    required: false,
    stagedPublic: true,
    fixed: { database: 'eng-trainer-v3', publicDir: EXPERIMENTAL_PUBLIC_DIR, outDir: EXPERIMENTAL_BUILD_DIR }
  },
  [LEGACY_PRODUCT]: { app: false, required: true, fixed: { outDir: 'v1/dist' }, fixedRoute: 'v1/' }
};

const APP_KEYS = ['database', 'outDir', 'pronunciation', 'publicDir'];
const FROZEN_KEYS = ['outDir'];
const FOLDER_KEYS = ['outDir', 'publicDir'];
const ROUTE_KEYS = ['path', 'product', 'publish'];

/** Top-level names every application build writes. A route with such a name would collide with them. */
export const RESERVED_ROUTE_SEGMENTS = ['assets', 'data', 'fonts'];

const fail = (message) => {
  throw new Error(`${SITE_CONFIG_FILE}: ${message}`);
};

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

function requireKeys(value, expected, where) {
  if (!isPlainObject(value)) fail(`${where} must be an object`);
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) {
    fail(`${where} must have exactly the keys ${wanted.join(', ')} (found ${keys.join(', ') || 'none'})`);
  }
}

/**
 * Validates a parsed configuration and returns it frozen. Anything unknown, missing,
 * duplicated or inconsistent is an error: the reader fails closed. A folder is compared
 * with its fixed value as exact text, so nothing is normalized into an accepted value.
 * This function reads no file; `loadSiteConfig` also checks the folders on disk.
 */
export function validateSiteConfig(raw) {
  requireKeys(raw, ['base', 'products', 'routes'], 'the configuration');

  const { base, products, routes } = raw;
  if (typeof base !== 'string' || !/^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)*$/.test(base)) {
    fail(`base "${base}" must be an absolute path of lower-case segments that starts and ends with "/"`);
  }

  if (!isPlainObject(products)) fail('products must be an object keyed by product name');
  for (const id of Object.keys(products)) {
    if (!Object.hasOwn(PRODUCT_RULES, id)) fail(`unknown product "${id}" (known: ${Object.keys(PRODUCT_RULES).join(', ')})`);
  }
  for (const [id, rule] of Object.entries(PRODUCT_RULES)) {
    if (rule.required && !Object.hasOwn(products, id)) fail(`the product "${id}" is required`);
  }

  const databases = new Map();
  for (const [id, product] of Object.entries(products)) {
    const rule = PRODUCT_RULES[id];
    requireKeys(product, rule.app ? APP_KEYS : FROZEN_KEYS, `products.${id}`);

    if (rule.app) {
      if (typeof product.pronunciation !== 'boolean') fail(`products.${id}.pronunciation must be true or false`);
      if (typeof product.database !== 'string' || !/^eng-trainer-v[0-9]+$/.test(product.database)) {
        fail(`products.${id}.database "${product.database}" must look like eng-trainer-v<number>`);
      }
      if (databases.has(product.database)) {
        fail(`products.${id} and products.${databases.get(product.database)} share the database "${product.database}"`);
      }
      databases.set(product.database, id);
    }

    for (const key of FOLDER_KEYS) {
      // A product rule without a fixed folder would let the file choose what is deleted.
      if (Object.hasOwn(product, key) && !Object.hasOwn(rule.fixed, key)) fail(`products.${id}.${key} has no fixed folder in the product rules`);
    }
    for (const [key, expected] of Object.entries(rule.fixed)) {
      if (product[key] !== expected) {
        const why = FOLDER_KEYS.includes(key) ? ' Product folders are fixed in code and cannot be configured, because scripts empty and delete them.' : '';
        fail(`products.${id}.${key} must be ${JSON.stringify(expected)} (found ${JSON.stringify(product[key])}).${why}`);
      }
    }
  }

  if (!Array.isArray(routes) || !routes.length) fail('routes must be a non-empty list');
  const paths = new Set();
  const routedProducts = new Set();
  routes.forEach((route, index) => {
    const where = `routes[${index}]`;
    requireKeys(route, ROUTE_KEYS, where);
    if (typeof route.path !== 'string' || !/^(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)?$/.test(route.path)) {
      fail(`${where}.path ${JSON.stringify(route.path)} must be "" or one lower-case segment with a trailing "/"`);
    }
    if (RESERVED_ROUTE_SEGMENTS.includes(route.path.slice(0, -1))) {
      fail(`${where}.path "${route.path}" collides with a folder that every application build writes`);
    }
    if (paths.has(route.path)) fail(`the route path ${JSON.stringify(route.path)} is used twice`);
    paths.add(route.path);
    if (typeof route.product !== 'string' || !Object.hasOwn(products, route.product)) {
      fail(`${where}.product ${JSON.stringify(route.product)} is not a configured product`);
    }
    if (routedProducts.has(route.product)) fail(`the product "${route.product}" has more than one route`);
    routedProducts.add(route.product);
    if (typeof route.publish !== 'boolean') fail(`${where}.publish must be true or false`);
    const fixedRoute = PRODUCT_RULES[route.product].fixedRoute;
    if (fixedRoute !== undefined && route.path !== fixedRoute) {
      fail(`${where}: "${route.product}" is compiled for the path "${fixedRoute}" and cannot be routed to ${JSON.stringify(route.path)}`);
    }
  });
  for (const id of Object.keys(products)) {
    if (!routedProducts.has(id)) fail(`the product "${id}" has no route`);
  }

  // Publication. Every deployment replaces the whole site, so the site root must always be published.
  const rootRoute = routes.find((route) => route.path === '');
  if (!rootRoute) fail('no route has the path "" (the site root)');
  if (!rootRoute.publish) fail('the route at the site root must be published');
  if (!PRODUCT_RULES[rootRoute.product].app) fail(`"${rootRoute.product}" cannot be routed to the site root`);

  return deepFreeze(structuredClone(raw));
}

function deepFreeze(value) {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

/**
 * The on-disk half of the validation. Each generated folder of a product must be absent,
 * or be a real folder that is reached through real folders: not a file, not a symbolic
 * link or junction, and not another spelling of some other folder. A build or a content
 * run would otherwise empty whatever that path leads to.
 */
function verifyProductFolders(site) {
  for (const id of appProducts(site)) {
    const product = site.products[id];
    const folders = [['outDir', 'build']];
    if (PRODUCT_RULES[id].stagedPublic) folders.push(['publicDir', 'staged-public']);
    for (const [key, use] of folders) {
      try {
        assertGeneratedDir(repoRoot, product[key], [use]);
      } catch (error) {
        fail(`products.${id}.${key}: ${error.message}`);
      }
    }
  }
}

/**
 * Reads and validates the committed configuration, then checks the generated product
 * folders on disk. It takes no argument on purpose.
 */
export function loadSiteConfig() {
  let raw;
  try {
    raw = JSON.parse(readFileSync(join(repoRoot, SITE_CONFIG_FILE), 'utf8'));
  } catch (error) {
    fail(`cannot be read as JSON (${error.message})`);
  }
  const site = validateSiteConfig(raw);
  verifyProductFolders(site);
  return site;
}

/** Whether `vite.config.ts` builds this product from `src/`. */
export function isAppProduct(productId) {
  return Object.hasOwn(PRODUCT_RULES, productId) && PRODUCT_RULES[productId].app;
}

/** The products that `vite.config.ts` can build, in configuration order. */
export function appProducts(site) {
  return Object.keys(site.products).filter(isAppProduct);
}

export function routeOf(site, productId) {
  const route = site.routes.find((item) => item.product === productId);
  if (!route) fail(`the product "${productId}" has no route`);
  return route;
}

/** The absolute address of a route inside the site, for example "/eng-trainer/v1/". */
export function routeUrl(site, route) {
  return `${site.base}${route.path}`;
}

/** Routes that the production assembly copies into the Pages artifact. */
export function publishedRoutes(site) {
  return site.routes.filter((route) => route.publish);
}

/**
 * Addresses of the other published products, for links between versions.
 * They come from the route list, so a route change updates them without a source edit.
 */
export function versionLinks(site, productId) {
  return site.routes
    .filter((route) => route.product !== productId && route.publish)
    .map((route) => ({ product: route.product, href: routeUrl(site, route) }));
}

/**
 * Everything a build of one application product needs. The product is selected by name;
 * its identity and database never depend on the path it is published at.
 */
export function productBuild(site, productId) {
  if (!Object.hasOwn(site.products, productId)) {
    fail(`unknown product "${productId}" (configured: ${Object.keys(site.products).join(', ')})`);
  }
  if (!isAppProduct(productId)) fail(`"${productId}" is a frozen project with its own build; it is not built from src/`);

  const product = site.products[productId];
  return {
    id: productId,
    base: routeUrl(site, routeOf(site, productId)),
    publicDir: product.publicDir,
    outDir: product.outDir,
    // Compile-time constants (see src/product.d.ts). Vite replaces each name with its value,
    // so code guarded by a constant that is false is removed from that product's build.
    define: {
      __SITE_BASE__: JSON.stringify(site.base),
      __ENG_PRODUCT__: JSON.stringify(productId),
      __ENG_DATABASE__: JSON.stringify(product.database),
      __ENG_PRONUNCIATION__: JSON.stringify(product.pronunciation),
      __ENG_VERSION_LINKS__: JSON.stringify(versionLinks(site, productId))
    }
  };
}
