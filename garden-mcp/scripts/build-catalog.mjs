#!/usr/bin/env node
/**
 * Builds data/components.json from the zendeskgarden/react-components repo.
 *
 * For every package it captures the pieces an agent needs to write correct
 * Garden code: the npm name/version, peer deps, the value exports (components),
 * the type exports, the full prop interfaces (with JSDoc, straight from source),
 * and the README (install + usage examples).
 *
 * Source: raw.githubusercontent.com (no auth, generous limits). Override the
 * git ref with GARDEN_REF (default "main").
 *
 *   node scripts/build-catalog.mjs
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REF = process.env.GARDEN_REF || 'main';
const BASE = `https://raw.githubusercontent.com/zendeskgarden/react-components/${REF}/.packages`;
const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'data', 'components.json');

// Packages published from the monorepo. `dropdowns.legacy` is intentionally
// omitted (superseded by `dropdowns`).
const PACKAGES = [
  'accordions', 'avatars', 'breadcrumbs', 'buttons', 'chrome', 'colorpickers',
  'datepickers', 'draggable', 'dropdowns', 'forms', 'grid', 'loaders', 'modals',
  'notifications', 'pagination', 'tables', 'tabs', 'tags', 'theming', 'tooltips',
  'typography'
];

// Curated one-liners: what the package is for and when to reach for it. The
// repo READMEs are boilerplate ("components relating to X"), so these carry the
// signal an agent uses to pick the right package.
const SUMMARIES = {
  accordions: 'Collapsible disclosure sections (Accordion) and stepped flows (Stepper). Use to progressively reveal content.',
  avatars: 'User/system avatars with status badges. Use for agent/end-user identity.',
  breadcrumbs: 'Hierarchical navigation trail. Use for nested page/location context.',
  buttons: 'Button, IconButton, ToggleButton, Anchor, SplitButton, ChevronButton. Primary way to trigger actions.',
  chrome: 'App shell layout: Chrome, Nav, Header, Body, Content, Sidebar, SkipNav. Use to frame full-page (nav_bar/modal) apps.',
  colorpickers: 'ColorPicker and ColorSwatch. Use to select colors.',
  datepickers: 'DatePicker, DatePickerRange, Datepicker inputs. Use for date/time entry.',
  draggable: 'Draggable and Sortable primitives (drag-and-drop). Use for reorderable lists.',
  dropdowns: 'Menu, Combobox, Autocomplete, Select, Field option lists (the current dropdowns API). Use for menus and selection inputs.',
  forms: 'Field, Input, Textarea, Checkbox, Radio, Toggle, Select (native), FileUpload, Range, labels/hints/messages. Core of any data-entry UI.',
  grid: 'Responsive 12-column layout: Grid, Row, Col. Use to lay out regions.',
  loaders: 'Spinner, Dots, Progress, Skeleton. Use for loading/async states.',
  modals: 'Modal, Drawer, TooltipModal. Use for dialogs and overlays (ticket_editor modal apps).',
  notifications: 'Alert, Notification, Toast, Well, GlobalAlert + useToast. Use for status/feedback messaging.',
  pagination: 'Pagination and OffsetPagination + Cursor pagination. Use to page long lists.',
  tables: 'Table, Head, HeaderRow, HeaderCell, Body, Row, Cell, GroupRow, Caption. Use for tabular data.',
  tabs: 'Tabs, TabList, Tab, TabPanel. Use to switch between sibling views.',
  tags: 'Tag with close/avatar. Use for labels, keywords, filter chips.',
  theming: 'ThemeProvider, DEFAULT_THEME, getColor, PALETTE, useDocument, focus-visible + RTL. REQUIRED root wrapper for every Garden app.',
  tooltips: 'Tooltip and Paragraph tooltip. Use for supplemental hover/focus hints.',
  typography: 'Span, Paragraph, Code, Ellipsis, MediaFigure, OrderedList, UnorderedList, XL/LG/MD/SM/Text. Use for text and lists.'
};

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.text();
}

/** Parse `src/index.ts` into value exports (components) and type exports. */
function parseExports(src) {
  const components = new Set();
  const types = new Set();
  if (!src) return { components: [], types: [] };
  // export { A, B as C } from '...';  and  export type { ... } from '...';
  const re = /export\s+(type\s+)?\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(src))) {
    const isType = Boolean(m[1]);
    for (const raw of m[2].split(',')) {
      const name = raw.trim().split(/\s+as\s+/).pop().trim();
      if (!name) continue;
      (isType ? types : components).add(name);
    }
  }
  return { components: [...components], types: [...types] };
}

/** Pull interface/type names from the types source for quick indexing. */
function parseInterfaceNames(src) {
  if (!src) return [];
  const names = new Set();
  const re = /export\s+(?:interface|type)\s+([A-Za-z0-9_]+)/g;
  let m;
  while ((m = re.exec(src))) names.add(m[1]);
  return [...names];
}

async function buildPackage(pkg) {
  const dir = `${BASE}/${pkg}`;
  const [pkgJsonRaw, indexRaw, typesRaw, readme] = await Promise.all([
    fetchText(`${dir}/package.json`),
    fetchText(`${dir}/src/index.ts`),
    fetchText(`${dir}/src/types/index.ts`),
    fetchText(`${dir}/README.md`)
  ]);

  let npm = `@zendeskgarden/react-${pkg}`;
  let version = null;
  let peerDependencies = {};
  if (pkgJsonRaw) {
    try {
      const j = JSON.parse(pkgJsonRaw);
      npm = j.name || npm;
      version = j.version || null;
      peerDependencies = j.peerDependencies || {};
    } catch { /* keep defaults */ }
  }

  const { components, types } = parseExports(indexRaw);
  return {
    package: pkg,
    npm,
    version,
    peerDependencies,
    summary: SUMMARIES[pkg] || '',
    components,
    typeExports: types,
    interfaces: parseInterfaceNames(typesRaw),
    props: typesRaw || '',      // full prop source with JSDoc
    readme: readme || '',
    docs: `https://garden.zendesk.com/components/${pkg}`
  };
}

async function main() {
  console.error(`Fetching ${PACKAGES.length} Garden packages @ ${REF} ...`);
  const results = {};
  for (const pkg of PACKAGES) {
    process.stderr.write(`  ${pkg} ... `);
    results[pkg] = await buildPackage(pkg);
    console.error(results[pkg].components.length ? 'ok' : 'no exports');
  }
  const gardenVersion = results.theming?.version || null;
  const catalog = {
    generatedAt: new Date().toISOString(),
    ref: REF,
    gardenVersion,
    source: 'https://github.com/zendeskgarden/react-components',
    packages: results
  };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(catalog, null, 2) + '\n');
  console.error(`\nWrote ${OUT} (Garden ${gardenVersion}).`);
}

main().catch(err => { console.error(err); process.exit(1); });
