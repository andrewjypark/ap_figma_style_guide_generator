// AP Style Guide Generator
//
// Generates a Section per selected variable collection on a "Style Guide"
// page, built entirely from primitives (frames/rectangles/text) rather than
// by cloning pre-existing master components from elsewhere in the file.
// This means the plugin is fully self-contained: it works in ANY Figma
// file, for any account, with no setup step (no internal components to
// copy in, no shared library to subscribe to).
//
// COLLECTIONS: every local variable collection is offered, regardless of
// naming convention. A collection is inspected by what it actually
// contains, not by what its variables are named:
//   - variables with resolvedType "COLOR"            -> a "— Colors" Section
//   - variables with resolvedType "FLOAT" or "STRING" -> a "— Tokens" Section
// A collection that has both produces two Sections. A multi-mode collection
// (e.g. Light/Dark) produces one pair of Sections per mode.
//
// GROUPING (both kinds): variables are grouped by dropping the last "/"
// segment of their name — "Colors/Base/Blue/1" groups under
// "Colors/Base/Blue", tile label "1". For COLOR variables specifically,
// a group instead collapses to just its first two segments ("shallow"
// grouping) when its variables are semantic aliases (VARIABLE_ALIAS values
// rather than literal colors) — this keeps large semantic buckets like
// "Color/background/*" from being split into dozens of one-token groups.
//
// TOKEN RENDERING (the "— Tokens" Section): each non-color variable gets a
// label + a rendering appropriate to what it looks like it represents,
// inferred with a soft, case-insensitive substring check against the
// variable's own name (never a hard requirement — collections are never
// filtered by this, only individual tokens are rendered differently). Where
// Figma exposes a bindable variable field for that property, the variable
// itself is bound (via TextNode.setBoundVariable), not just its literal
// value, so the sample shows up wired to the variable in Figma's own UI:
//   - "font size"      -> live sample text set to that literal size, bound
//   - "line height"    -> live sample text set to that literal line height, bound
//   - "letter spacing" / "tracking" -> live sample text set to that spacing, bound
//   - "font family" (STRING) -> live sample text set to that font if it
//                               loads, bound; otherwise the label alone
//                               still communicates the value
//   - "font weight" / "weight" (STRING style name, e.g. "Regular"/"Semi
//     Bold") -> live sample text set to that font style if it loads, bound
//     via the "fontStyle" field (a numeric weight is left as a plain value
//     card — mapping an arbitrary number to an installed style safely
//     requires enumerating that family's actual styles)
//   - "text transform" / "text case" -> live sample text's case (Figma has
//                               no bindable variable field for text case,
//                               so this is literal-only)
//   - anything else (spacing, radius, border width, sizes, ...) -> a plain
//                               value card: label + the literal resolved
//                               value printed as text, no font properties
//                               touched.
//
// COMPOSING A FULL TYPE STYLE: a "font size" variable is the one property
// that gets its own card — but it isn't rendered alone. It looks up every
// sibling property that belongs to the same type style (Line height, Font
// Family, Font Weight, Letter spacing, Text transform) and wires them all
// into the very same sample text, then prints a compact readout of what
// was applied underneath it (e.g. "56px  ·  IBM Plex Sans  ·  67px
// line-height"). Any sibling variable folded in this way is a redundant
// solo card, so its own category/group is skipped entirely rather than
// showing the same value twice — a "Line height" section with nothing
// left unconsumed in it never gets built. Two real-world naming shapes
// are handled: "style-first" (e.g. "typography/display-default/font-size"
// alongside ".../line-height") where the siblings share every path
// segment except the trailing kind name — matched first, since the group
// unambiguously owns one variable per kind; and "category-first" (e.g.
// "Font Size/Heading 2" <-> "Line height/Heading 2") where the siblings
// live in different top-level groups but share the same trailing name —
// matched as a fallback. Font family additionally falls back further: a
// normalized substring match (handles "Heading 1/2/3" <-> a "Headings"
// family bucket), then a bucket that reads like a base/default family
// (body, base, default, primary, text, paragraph), and finally, if the
// collection defines a Font Family variable at all, the first one
// alphabetically — so a type style only goes without a bound family when
// there are truly no Font Family variables to choose from. Text transform
// has no bindable variable field in Figma, so it's applied to the sample
// literally and flagged "(unbound)" in the readout rather than silently
// looking like a real binding.
//
// FONTS: every font load has a safe secondary family to fall back to, so
// generation never breaks in an account that doesn't have the "nice" fonts
// installed: Source Code Pro/title/sampleDefault fall back to Inter
// (bundled with every Figma install); the label and header roles (which
// use IBM Plex Mono / IBM Plex Sans as their primary — swapped in from
// Montserrat / League Gothic) fall back to Open Sans instead.

figma.showUI(__html__, { width: 360, height: 520 });

const SECTION_GAP = 450; // horizontal gap between multiple collection Sections
const MARGIN = 100; // margin between a Section's edge and its content frame
const SEMANTIC_COLUMN_CHUNK_SIZE = 8; // max cards per "color swatches" column
const TOKEN_CARDS_PER_ROW = 4; // cards per row in a "— Tokens" group

// ---------------------------------------------------------------------
// Palette + fonts extracted from the original design (see project notes).
// Every color is a plain literal here (not bound to a variable) since the
// output must render correctly in files that don't define these variables.
// ---------------------------------------------------------------------

function hexToRgb(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

const PALETTE = {
  ink: hexToRgb("#1c1d1f"),
  grey: hexToRgb("#7a7e87"),
  stroke: hexToRgb("#b3b6bb"),
  placeholder: hexToRgb("#f1f1f2"),
  headerBg: hexToRgb("#33312b"),
  headerCream: hexToRgb("#f3f0ea"),
  sectionBg: { r: 0.9019607901573181, g: 0.9019607901573181, b: 0.9019607901573181 },
  white: { r: 1, g: 1, b: 1 },
};

const FONTS = {
  title: { primary: { family: "Inter", style: "Semi Bold" }, fallback: { family: "Inter", style: "Bold" } },
  label: { primary: { family: "IBM Plex Mono", style: "SemiBold" }, fallback: { family: "Open Sans", style: "SemiBold" } },
  mono: { primary: { family: "Source Code Pro", style: "Regular" }, fallback: { family: "Inter", style: "Regular" } },
  headerTitle: { primary: { family: "IBM Plex Sans", style: "Regular" }, fallback: { family: "Open Sans", style: "Bold" } },
  headerDesc: { primary: { family: "IBM Plex Mono", style: "Regular" }, fallback: { family: "Open Sans", style: "Regular" } },
  sampleDefault: { family: "Inter", style: "Regular" },
};

// Cached + timeout-guarded: font loads for the same family/style only pay
// the network/lookup cost once, and a slow or hung load (e.g. a family name
// Figma can't resolve) can never stall generation — it degrades to the
// fallback instead of blocking forever.
const fontLoadCache = new Map();
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("font load timed out")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
async function loadFontSafe(primary, fallback) {
  const key = JSON.stringify(primary) + "|" + JSON.stringify(fallback);
  if (fontLoadCache.has(key)) return fontLoadCache.get(key);
  const promise = (async () => {
    try {
      await withTimeout(figma.loadFontAsync(primary), 4000);
      return primary;
    } catch (e) {
      try {
        await withTimeout(figma.loadFontAsync(fallback), 4000);
      } catch (e2) {
        // even the fallback failed/hung; caller still gets a font name back
        // and Figma will substitute something renderable.
      }
      return fallback;
    }
  })();
  fontLoadCache.set(key, promise);
  return promise;
}

// Figma's own font list, fetched once and cached — used to correct a font
// name's casing when the exact string a variable resolves to doesn't load
// (see tryLoadFont below).
let availableFontsPromise = null;
function getAvailableFonts() {
  if (!availableFontsPromise) availableFontsPromise = figma.listAvailableFontsAsync();
  return availableFontsPromise;
}

// Attempts to load an arbitrary (name not known ahead of time) font family,
// reusing the same cache + timeout discipline as loadFontSafe so a family
// that repeats across several variables is only ever attempted once, and a
// slow/unresolvable family can never stall generation. If the exact name
// fails to load, falls back to a case-insensitive match against Figma's own
// font list — design tokens are often authored in a different case
// convention than Figma's canonical font names (e.g. a CSS-style lowercase
// "modak" where Figma lists the font as "Modak"), and that mismatch would
// otherwise silently read as "font not installed". Returns the *corrected*
// {family, style} to actually assign (which may differ in case from the
// input), or null if nothing loadable was found, so call sites can fall
// through to a plain value card without throwing.
async function tryLoadFont(fontName) {
  const key = JSON.stringify(fontName);
  if (fontLoadCache.has(key)) return fontLoadCache.get(key);
  const promise = (async () => {
    try {
      await withTimeout(figma.loadFontAsync(fontName), 4000);
      return fontName;
    } catch (e) {
      try {
        const available = await withTimeout(getAvailableFonts(), 4000);
        const familyLower = fontName.family.toLowerCase();
        const styleLower = (fontName.style || "").toLowerCase();
        const match =
          available.find((f) => f.fontName.family.toLowerCase() === familyLower && f.fontName.style.toLowerCase() === styleLower) ||
          available.find((f) => f.fontName.family.toLowerCase() === familyLower);
        if (match) {
          await withTimeout(figma.loadFontAsync(match.fontName), 4000);
          return match.fontName;
        }
      } catch (e2) {}
      return null;
    }
  })();
  fontLoadCache.set(key, promise);
  return promise;
}

// Creates a fully-configured TEXT node. `spec` is one of the FONTS entries
// (with .primary/.fallback) or a literal {family, style} font.
async function makeText(chars, spec, size, color, opts) {
  opts = opts || {};
  const font = spec.primary
    ? await loadFontSafe(spec.primary, spec.fallback)
    : await loadFontSafe(spec, FONTS.sampleDefault);
  const t = figma.createText();
  t.fontName = font;
  t.fontSize = size;
  t.fills = [{ type: "SOLID", color }];
  if (opts.lineHeight) t.lineHeight = opts.lineHeight;
  if (opts.letterSpacing) t.letterSpacing = opts.letterSpacing;
  if (opts.textCase) t.textCase = opts.textCase;
  t.characters = chars;
  return t;
}

function autoFrame(name, mode) {
  const f = figma.createFrame();
  f.name = name;
  f.layoutMode = mode;
  f.primaryAxisSizingMode = "AUTO";
  f.counterAxisSizingMode = "AUTO";
  f.fills = [];
  return f;
}

function rgbaToHex(rgba) {
  const toHex = (c) => Math.round(c * 255).toString(16).padStart(2, "0").toUpperCase();
  return "#" + toHex(rgba.r) + toHex(rgba.g) + toHex(rgba.b);
}

// ---------------------------------------------------------------------
// Variable helpers
// ---------------------------------------------------------------------

async function findVariableByName(name) {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  for (const c of collections) {
    for (const id of c.variableIds) {
      const v = await figma.variables.getVariableByIdAsync(id);
      if (v.name === name) return v;
    }
  }
  return null;
}

function getRawValue(variable, modeId) {
  const modeKey = Object.prototype.hasOwnProperty.call(variable.valuesByMode, modeId)
    ? modeId
    : Object.keys(variable.valuesByMode)[0];
  return variable.valuesByMode[modeKey];
}

function isAliasVariable(variable, modeId) {
  const raw = getRawValue(variable, modeId);
  return !!(raw && raw.type === "VARIABLE_ALIAS");
}

async function getImmediateAliasTargetName(variable, modeId) {
  const raw = getRawValue(variable, modeId);
  if (raw && raw.type === "VARIABLE_ALIAS") {
    const target = await figma.variables.getVariableByIdAsync(raw.id);
    return target.name;
  }
  return null;
}

async function resolveVariableRGBA(variable, preferredModeId) {
  let current = variable;
  for (let i = 0; i < 10; i++) {
    const value = getRawValue(current, preferredModeId);
    if (!value) return null;
    if (value.type === "VARIABLE_ALIAS") {
      current = await figma.variables.getVariableByIdAsync(value.id);
      continue;
    }
    return value; // { r, g, b, a }
  }
  return null;
}

async function resolveVariableValue(variable, preferredModeId) {
  let current = variable;
  for (let i = 0; i < 10; i++) {
    const value = getRawValue(current, preferredModeId);
    if (value === undefined || value === null) return null;
    if (typeof value === "object" && value.type === "VARIABLE_ALIAS") {
      current = await figma.variables.getVariableByIdAsync(value.id);
      continue;
    }
    return value;
  }
  return null;
}

function shadeSortKey(shade) {
  if (shade.toLowerCase() === "white") return -Infinity;
  if (shade.toLowerCase() === "black") return Infinity;
  const n = parseInt(shade, 10);
  return Number.isNaN(n) ? shade : n;
}

// Comparator over two variables' trailing names: numeric shades ascending
// (white first, black last), anything else alphabetical.
function compareShades(a, b) {
  const ka = shadeSortKey(a.name.split("/").pop());
  const kb = shadeSortKey(b.name.split("/").pop());
  if (typeof ka === "number" && typeof kb === "number") return ka - kb;
  return String(ka).localeCompare(String(kb));
}

// True when every variable's trailing name is a numeric step (or
// white/black) — i.e. the group is a scale whose natural order is numeric,
// not a list of named tokens.
function isNumericScaleGroup(vars) {
  return vars.every((v) => typeof shadeSortKey(v.name.split("/").pop()) === "number");
}

function tileLabel(variable, labelParts) {
  return variable.name.split("/").slice(labelParts.length).join("/");
}

// Orders collections to match the Variables panel convention: "N. Name"
// collections first (sorted by N), then plain "Tier N" collections (sorted
// by their own N). Anything else falls back to the end, alphabetically.
function collectionSortKey(name) {
  const prefixMatch = name.match(/^(\d+)\.\s*/);
  if (prefixMatch) return [0, parseInt(prefixMatch[1], 10), name];
  const tierMatch = name.match(/(\d+)/);
  if (tierMatch) return [1, parseInt(tierMatch[1], 10), name];
  return [2, 0, name];
}
function compareCollections(a, b) {
  const ka = collectionSortKey(a);
  const kb = collectionSortKey(b);
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] < kb[i]) return -1;
    if (ka[i] > kb[i]) return 1;
  }
  return 0;
}

// ---------------------------------------------------------------------
// GROUPING — naming-agnostic. Collections are never filtered by name; only
// by what resolvedType their variables actually have.
// ---------------------------------------------------------------------

// Groups a set of COLOR variables into { labelParts, vars, shallow } groups.
function discoverColorGroups(vars, modeId) {
  const groups = new Map();
  for (const v of vars) {
    if (v.resolvedType !== "COLOR") continue;
    const parts = v.name.split("/");
    if (parts.length < 2) continue;

    const isShallow = parts.length > 2 && isAliasVariable(v, modeId);
    const groupPath = isShallow ? parts.slice(0, 2).join("/") : parts.slice(0, -1).join("/");

    if (!groups.has(groupPath)) groups.set(groupPath, { vars: [], shallow: isShallow });
    groups.get(groupPath).vars.push(v);
  }
  const result = [];
  for (const [groupPath, entry] of groups) {
    if (!entry.shallow) {
      entry.vars.sort((a, b) => {
        const ka = shadeSortKey(a.name.split("/").pop());
        const kb = shadeSortKey(b.name.split("/").pop());
        if (typeof ka === "number" && typeof kb === "number") return ka - kb;
        return String(ka).localeCompare(String(kb));
      });
    }
    result.push({ labelParts: groupPath.split("/"), vars: entry.vars, shallow: entry.shallow });
  }
  return result;
}

// Groups non-color (FLOAT/STRING) variables the same "deep" way colors do
// by default: drop the last path segment.
function discoverTokenGroups(vars) {
  const groups = new Map();
  for (const v of vars) {
    if (v.resolvedType !== "FLOAT" && v.resolvedType !== "STRING") continue;
    const parts = v.name.split("/");
    const groupPath = parts.length > 1 ? parts.slice(0, -1).join("/") : parts[0];
    if (!groups.has(groupPath)) groups.set(groupPath, []);
    groups.get(groupPath).push(v);
  }
  const result = [];
  for (const [groupPath, groupVars] of groups) {
    // Only reorder a true numeric scale (4, 8, 12 ...). Named tokens
    // (h1, h2-lg, body ...) keep the collection's own variable order — the
    // one the Variables panel shows — instead of being alphabetized.
    if (isNumericScaleGroup(groupVars)) groupVars.sort(compareShades);
    result.push({ labelParts: groupPath.split("/"), vars: groupVars });
  }
  return result;
}

// Soft, case-insensitive signal for how to render one token's live sample —
// never used to decide whether a collection/variable is included, only how
// it's drawn once it's already known to be a FLOAT/STRING variable.
function inferTokenKind(name) {
  const n = name.toLowerCase();
  if (/font[\s_-]?size/.test(n)) return "font-size";
  if (/line[\s_-]?height/.test(n)) return "line-height";
  if (/letter[\s_-]?spacing|tracking/.test(n)) return "letter-spacing";
  if (/font[\s_-]?family/.test(n)) return "font-family";
  if (/text[\s_-]?transform|text[\s_-]?case/.test(n)) return "text-transform";
  if (/font[\s_-]?weight|weight/.test(n)) return "font-weight";
  return "value";
}

const TEXT_CASE_MAP = { uppercase: "UPPER", lowercase: "LOWER", capitalize: "TITLE", none: "ORIGINAL" };

// ---------------------------------------------------------------------
// COLOR TILES — built from scratch, matching the original design's look:
// a square/rect swatch shown at full, undiluted color, a bold label, and
// either a literal hex readout (primitive) or a reference to the aliased
// token (semantic).
// ---------------------------------------------------------------------

async function buildPrimitiveColorTile(v, labelParts, modeId) {
  const tile = autoFrame(".color-tile", "VERTICAL");
  tile.itemSpacing = 16;

  const swatch = figma.createFrame();
  swatch.name = "swatch";
  swatch.resize(128, 128);
  const resolvedColor = await resolveVariableRGBA(v, modeId);
  const rgb = resolvedColor ? { r: resolvedColor.r, g: resolvedColor.g, b: resolvedColor.b } : PALETTE.placeholder;
  const paint = { type: "SOLID", color: rgb };
  swatch.fills = resolvedColor ? [figma.variables.setBoundVariableForPaint(paint, "color", v)] : [paint];
  tile.appendChild(swatch);

  const info = autoFrame("info", "VERTICAL");
  info.counterAxisSizingMode = "FIXED";
  info.itemSpacing = 8;
  tile.appendChild(info);
  info.resize(128, info.height);

  const label = await makeText(tileLabel(v, labelParts) || v.name, FONTS.label, 16, PALETTE.ink, {
    lineHeight: { unit: "PIXELS", value: 24 },
  });
  info.appendChild(label);

  const hexText = await makeText(resolvedColor ? rgbaToHex(resolvedColor) : "—", FONTS.mono, 14, PALETTE.ink, {
    lineHeight: { unit: "PIXELS", value: 16 },
    letterSpacing: { unit: "PIXELS", value: 1 },
  });
  info.appendChild(hexText);
  hexText.layoutSizingHorizontal = "FILL";

  return tile;
}

async function buildSemanticColorTile(v, labelParts, modeId, isBorderGroup) {
  const tile = autoFrame(".color-tile", "HORIZONTAL");
  tile.resize(320, tile.height);
  tile.primaryAxisSizingMode = "FIXED";
  tile.cornerRadius = 4;
  tile.strokes = [{ type: "SOLID", color: PALETTE.stroke }];
  tile.strokeWeight = 1;
  tile.strokeAlign = "INSIDE";
  tile.itemSpacing = 16;
  tile.paddingTop = 8;
  tile.paddingBottom = 8;
  tile.paddingLeft = 8;
  tile.paddingRight = 8;
  tile.fills = [{ type: "SOLID", color: PALETTE.white }];

  const swatch = figma.createFrame();
  swatch.name = "swatch";
  swatch.resize(48, 48);
  swatch.cornerRadius = 2;
  const resolvedColor = await resolveVariableRGBA(v, modeId);
  const rgb = resolvedColor ? { r: resolvedColor.r, g: resolvedColor.g, b: resolvedColor.b } : PALETTE.placeholder;
  const paint = { type: "SOLID", color: rgb };
  const boundPaint = resolvedColor ? figma.variables.setBoundVariableForPaint(paint, "color", v) : paint;
  if (isBorderGroup) {
    swatch.fills = [{ type: "SOLID", color: PALETTE.white }];
    swatch.strokes = [boundPaint];
    swatch.strokeWeight = 8;
    swatch.strokeAlign = "INSIDE";
  } else {
    swatch.fills = [boundPaint];
  }
  tile.appendChild(swatch);

  const info = autoFrame("info", "VERTICAL");
  info.counterAxisSizingMode = "FIXED";
  info.itemSpacing = 4;
  tile.appendChild(info);
  info.layoutSizingHorizontal = "FILL";

  const label = await makeText(tileLabel(v, labelParts) || v.name, FONTS.label, 16, PALETTE.ink, {
    lineHeight: { unit: "PIXELS", value: 24 },
  });
  info.appendChild(label);

  const targetName = (await getImmediateAliasTargetName(v, modeId)) || v.name;
  const refText = await makeText(targetName, FONTS.mono, 14, PALETTE.grey, {
    lineHeight: { unit: "PIXELS", value: 16 },
    letterSpacing: { unit: "PIXELS", value: 1 },
  });
  info.appendChild(refText);
  refText.layoutSizingHorizontal = "FILL";

  return tile;
}

// ---------------------------------------------------------------------
// TOKEN CARDS (non-color: typography, spacing, radius, sizes, ...)
// ---------------------------------------------------------------------

// Binds a variable directly to a text node's property (Figma's native
// "apply variable to style" mechanism — shows as a bound field in the
// properties panel, and updates live if the variable's value changes).
// Not every field/variable combination is bindable (e.g. Figma has no
// bindable field for textCase), and a bind can fail even when the literal
// value was applied fine (e.g. a fontStyle string that isn't one of the
// current font's installed styles) — always safe to attempt and ignore.
function tryBindVariable(node, field, variable) {
  try {
    node.setBoundVariable(field, variable);
    return true;
  } catch (e) {
    return false;
  }
}

// Cross-category lookup for composing a full type-style sample (e.g. the
// "Font Size/Heading 2" card also picking up "Line height/Heading 2" and,
// only on an exact name match, "Font Family/Heading 2") from token
// categories that share the same trailing label. Built once per collection
// from its full variable list, before grouping — a no-op for any
// collection whose naming doesn't line up this way.
// Two different real-world naming shapes both need to compose correctly:
//   - "category-first" (e.g. "Font Size/Heading 2", "Line height/Heading 2")
//     — siblings live in a DIFFERENT top-level group but share the same
//     trailing name ("Heading 2"). Indexed in byTrailingLabel.
//   - "style-first" (e.g. "typography/display-default/font-size",
//     ".../line-height") — siblings live in the SAME group (everything but
//     the last path segment) and are told apart by their own trailing kind
//     name, which is identical ("font-size", "line-height", ...) across
//     every style, so it CANNOT be used as a cross-style key here — indexed
//     in byGroupPath instead, one bucket per style with kind as the key.
function buildTokenSiblingIndex(vars) {
  const byTrailingLabel = new Map(); // kind -> Map(trailing name -> variable)
  const byGroupPath = new Map(); // group path (all but last segment) -> Map(kind -> variable)
  for (const v of vars) {
    if (v.resolvedType !== "FLOAT" && v.resolvedType !== "STRING") continue;
    if (!v.name.includes("/")) continue;
    const parts = v.name.split("/");
    const trailingLabel = parts[parts.length - 1];
    const groupPath = parts.slice(0, -1).join("/");
    const kind = inferTokenKind(v.name);

    if (!byTrailingLabel.has(kind)) byTrailingLabel.set(kind, new Map());
    byTrailingLabel.get(kind).set(trailingLabel, v);

    if (!byGroupPath.has(groupPath)) byGroupPath.set(groupPath, new Map());
    byGroupPath.get(groupPath).set(kind, v);
  }
  return { byTrailingLabel, byGroupPath };
}

// Best-effort choice of a Font Family variable for a size/line-height
// label that has no exact-name match. Tries, in order: (1) a normalized
// substring match against the label with its trailing digits stripped
// (handles the common "Heading 1/2/3" -> "Headings" split); (2) a family
// bucket whose own name reads like a base/default family (body, base,
// default, primary, text, paragraph); (3) if the collection defines at
// least one Font Family variable at all, the first one alphabetically —
// so a type style ends up wired to *some* family rather than none, even
// when the naming gives no real signal to go on.
function pickFallbackFontFamily(label, familyMap) {
  if (!familyMap || familyMap.size === 0) return null;

  const normalized = label.toLowerCase().replace(/[\s_-]*\d+$/, "").trim();
  for (const [famLabel, famVar] of familyMap) {
    const famNormalized = famLabel.toLowerCase().replace(/[\s_-]*\d+$/, "").trim();
    if (famNormalized && (normalized.includes(famNormalized) || famNormalized.includes(normalized))) {
      return famVar;
    }
  }

  for (const [famLabel, famVar] of familyMap) {
    if (/body|base|default|primary|text|paragraph/i.test(famLabel)) return famVar;
  }

  const sorted = [...familyMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return sorted[0][1];
}

// Pure name-based lookup (no resolving, no font loading) for every sibling
// property of a font-size variable's type style — the same dual strategy
// buildTokenSiblingIndex indexes for: an exact same-group match first
// (style-first naming), falling back to the same-trailing-name match
// across groups (category-first naming). Font Family additionally falls
// back to the best-effort guess above, so a style only goes without a
// bound family when the collection has no Font Family variables at all.
// Deterministic and side-effect-free so it can double as both (a) the
// consumption check that decides which variables no longer need their own
// solo card, and (b) the actual sibling set a composed card renders from.
function findStyleSiblings(sizeVar, siblingIndex) {
  const parts = sizeVar.name.split("/");
  const trailingLabel = parts[parts.length - 1];
  const groupPath = parts.length > 1 ? parts.slice(0, -1).join("/") : null;
  const groupSiblings = groupPath ? siblingIndex.byGroupPath.get(groupPath) : null;

  function findExact(kind) {
    const trailingMap = siblingIndex.byTrailingLabel.get(kind);
    return (groupSiblings && groupSiblings.get(kind)) || (trailingMap && trailingMap.get(trailingLabel)) || null;
  }

  const familyMap = siblingIndex.byTrailingLabel.get("font-family");
  const familyVar = findExact("font-family") || pickFallbackFontFamily(trailingLabel, familyMap);

  return {
    lineHeightVar: findExact("line-height"),
    familyVar,
    weightVar: findExact("font-weight"),
    letterSpacingVar: findExact("letter-spacing"),
    textTransformVar: findExact("text-transform"),
  };
}

function isNumericLabel(str) {
  return /^-?\d+(\.\d+)?$/.test(str.trim());
}

// A font-size variable only anchors a composed type-style card when its own
// trailing label is a real style name ("display-default-mobile", or a
// category-first label like "Heading 2") rather than a bare rung of a
// numeric type scale ("12", "100"). A raw scale has no real per-style
// siblings — any "match" for it (a same-numbered Line height, a Font
// Family picked by the last-resort "just grab one" fallback) is coincidence
// or guesswork, not a real type style, so it's left as its own plain value
// card instead of being fused into a misleading composed sample.
function isComposableFontSizeVar(v) {
  if (inferTokenKind(v.name) !== "font-size") return false;
  const suffix = v.name.split("/").pop();
  return !isNumericLabel(suffix);
}

// One pass over every font-size variable in the collection, gathering the
// ids of every sibling findStyleSiblings locates for it. Any variable in
// that set is fully represented inside some other style's composed card
// already, so its own category group should skip rendering it as a
// redundant solo card (and, if that empties a group entirely — e.g. every
// Line height value got folded into a Font Size style — the group's
// section is skipped too, in generateForCollectionMode).
function computeConsumedSiblingIds(vars, siblingIndex) {
  const consumed = new Set();
  for (const v of vars) {
    if (!isComposableFontSizeVar(v)) continue;
    const siblings = findStyleSiblings(v, siblingIndex);
    for (const key of ["lineHeightVar", "familyVar", "weightVar", "letterSpacingVar", "textTransformVar"]) {
      if (siblings[key]) consumed.add(siblings[key].id);
    }
  }
  return consumed;
}

// Applies font-size plus every sibling findStyleSiblings found to one
// sample node — font-family and font-weight are resolved together and
// loaded as a single font (a style name like "Semi Bold" is a font STYLE,
// not a numeric weight, so it binds via Figma's "fontStyle" field) — and
// returns one entry per property actually called out for the card's
// documentation rows below the sample: { label, varName, value }. A
// property whose sibling variable doesn't exist for this style is simply
// omitted (never a hard requirement). Two properties never get a real
// Figma binding but are still called out for reference: text-case has no
// bindable variable field at all, and a font-weight variable authored as
// a bare number (e.g. 400) can't be applied as a font style (Figma only
// accepts a named style like "Semi Bold" there) — both are flagged
// "(unbound)" in their value rather than silently looking like a real
// binding.
async function composeStyleSample(sample, sizeVar, siblings, modeId) {
  const entries = [];

  const sizeValue = await resolveVariableValue(sizeVar, modeId);
  if (typeof sizeValue === "number") {
    sample.fontSize = sizeValue;
    tryBindVariable(sample, "fontSize", sizeVar);
    entries.push({ label: "font size:", varName: sizeVar.name, value: sizeValue + "px" });
  }

  let familyStr = null;
  let weightRaw = null;
  if (siblings.familyVar) {
    try {
      const resolved = await resolveVariableValue(siblings.familyVar, modeId);
      if (typeof resolved === "string") familyStr = resolved;
    } catch (e) {}
  }
  if (siblings.weightVar) {
    try {
      weightRaw = await resolveVariableValue(siblings.weightVar, modeId);
    } catch (e) {}
  }
  const weightStr = typeof weightRaw === "string" ? weightRaw : null;

  let loadedFont = null;
  if (familyStr || weightStr) {
    const current = sample.fontName;
    const candidate = { family: familyStr || current.family, style: weightStr || current.style };
    loadedFont = await tryLoadFont(candidate);
    if (loadedFont) sample.fontName = loadedFont;
  }

  if (siblings.familyVar && familyStr) {
    if (loadedFont) tryBindVariable(sample, "fontFamily", siblings.familyVar);
    entries.push({ label: "font family:", varName: siblings.familyVar.name, value: (loadedFont && loadedFont.family) || familyStr });
  }

  if (siblings.weightVar) {
    if (weightStr) {
      if (loadedFont) tryBindVariable(sample, "fontStyle", siblings.weightVar);
      entries.push({ label: "font weight:", varName: siblings.weightVar.name, value: (loadedFont && loadedFont.style) || weightStr });
    } else if (typeof weightRaw === "number") {
      entries.push({ label: "font weight:", varName: siblings.weightVar.name, value: weightRaw + " (unbound)" });
    }
  }

  if (siblings.lineHeightVar) {
    try {
      const resolved = await resolveVariableValue(siblings.lineHeightVar, modeId);
      if (typeof resolved === "number") {
        sample.lineHeight = { value: resolved, unit: "PIXELS" };
        tryBindVariable(sample, "lineHeight", siblings.lineHeightVar);
        entries.push({ label: "line height:", varName: siblings.lineHeightVar.name, value: resolved + "px" });
      }
    } catch (e) {}
  }

  if (siblings.letterSpacingVar) {
    try {
      const resolved = await resolveVariableValue(siblings.letterSpacingVar, modeId);
      if (typeof resolved === "number") {
        sample.letterSpacing = { value: resolved, unit: "PIXELS" };
        tryBindVariable(sample, "letterSpacing", siblings.letterSpacingVar);
        entries.push({ label: "letter spacing:", varName: siblings.letterSpacingVar.name, value: resolved + "px" });
      }
    } catch (e) {}
  }

  if (siblings.textTransformVar) {
    try {
      const resolved = await resolveVariableValue(siblings.textTransformVar, modeId);
      if (typeof resolved === "string") {
        const textCase = TEXT_CASE_MAP[resolved.toLowerCase()];
        if (textCase) {
          sample.textCase = textCase;
          entries.push({ label: "text transform:", varName: siblings.textTransformVar.name, value: resolved.toLowerCase() + " (unbound)" });
        }
      }
    } catch (e) {}
  }

  return entries;
}

// Builds one documentation row under a composed card: four separate text
// layers in a horizontal auto-layout ("label:", " variable/path/name",
// "  |", "  value") rather than one pre-joined string, so each piece stays
// independently selectable/restylable in Figma. The leading spaces (never
// trailing) matter: Figma trims trailing whitespace from an auto-width
// text layer's own bounding box, so any gap has to be the *next* run's
// leading space instead, or it silently collapses to zero width.
async function makeReadoutRun(chars, color) {
  return makeText(chars, FONTS.mono, 12, color, {
    lineHeight: { unit: "PIXELS", value: 16 },
    letterSpacing: { unit: "PIXELS", value: 0.5 },
  });
}

async function buildReadoutRow(entry) {
  const row = autoFrame("readout-row", "HORIZONTAL");
  row.itemSpacing = 0;
  row.appendChild(await makeReadoutRun(entry.label, PALETTE.ink));
  row.appendChild(await makeReadoutRun(" " + entry.varName, PALETTE.grey));
  row.appendChild(await makeReadoutRun("  |", PALETTE.grey));
  row.appendChild(await makeReadoutRun("  " + entry.value, PALETTE.ink));
  return row;
}

async function buildTokenCard(v, labelParts, modeId, siblingIndex) {
  const card = autoFrame(".token-card", "VERTICAL");
  card.itemSpacing = 8;
  card.fills = [{ type: "SOLID", color: PALETTE.white }];

  const label = await makeText(tileLabel(v, labelParts) || v.name, FONTS.label, 16, PALETTE.ink, {
    lineHeight: { unit: "PIXELS", value: 24 },
  });
  card.appendChild(label);

  const resolved = await resolveVariableValue(v, modeId);
  const kind = inferTokenKind(v.name);

  const sample = await makeText(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ\nabcdefghijklmnopqrstuvwxyz\n0123456789",
    FONTS.sampleDefault,
    18,
    PALETTE.ink,
    { lineHeight: { unit: "PERCENT", value: 120 } }
  );

  let applied = false;
  if (resolved !== null) {
    try {
      if (kind === "font-size" && typeof resolved === "number") {
        // A bare rung of a numeric type scale (not a real named type style —
        // see isComposableFontSizeVar) still gets its size applied and bound
        // to the live sample, exactly like line-height/letter-spacing below;
        // it just never gets a composed multi-property readout underneath.
        sample.fontSize = resolved;
        applied = true;
        tryBindVariable(sample, "fontSize", v);
      } else if (kind === "line-height" && typeof resolved === "number") {
        sample.lineHeight = { value: resolved, unit: "PIXELS" };
        applied = true;
        tryBindVariable(sample, "lineHeight", v);
      } else if (kind === "letter-spacing" && typeof resolved === "number") {
        sample.letterSpacing = { value: resolved, unit: "PIXELS" };
        applied = true;
        tryBindVariable(sample, "letterSpacing", v);
      } else if (kind === "font-family" && typeof resolved === "string") {
        const current = sample.fontName;
        const candidate = { family: resolved, style: current.style };
        const loadedFont = await tryLoadFont(candidate);
        if (loadedFont) {
          sample.fontName = loadedFont;
          applied = true;
          tryBindVariable(sample, "fontFamily", v);
        }
      } else if (kind === "font-weight" && typeof resolved === "string") {
        // Values like "Regular" / "Semi Bold" are font STYLE names, not
        // numeric weights — bind them via Figma's "fontStyle" field rather
        // than "fontWeight" (which expects a 100-900 number).
        const current = sample.fontName;
        const candidate = { family: current.family, style: resolved };
        const loadedFont = await tryLoadFont(candidate);
        if (loadedFont) {
          sample.fontName = loadedFont;
          applied = true;
          tryBindVariable(sample, "fontStyle", v);
        }
      } else if (kind === "text-transform" && typeof resolved === "string") {
        const textCase = TEXT_CASE_MAP[resolved.toLowerCase()];
        if (textCase) {
          sample.textCase = textCase;
          applied = true;
          // Figma has no bindable variable field for text case; literal only.
        }
      }
    } catch (e) {
      // preview application failed; fall through to a plain value card.
    }
  }

  if (applied) {
    card.appendChild(sample);
  } else {
    sample.remove();
    const valueText = await makeText(
      resolved === null || resolved === undefined ? "—" : String(resolved),
      FONTS.mono,
      14,
      PALETTE.grey,
      { lineHeight: { unit: "PIXELS", value: 16 }, letterSpacing: { unit: "PIXELS", value: 1 } }
    );
    card.appendChild(valueText);
  }

  return card;
}

// Only called for a font-size variable: this is the one card a full type
// style gets. Composes a single alphabet sample with every sibling
// property findStyleSiblings can locate (font-family + weight combined
// into one font load, line-height, letter-spacing, text-transform applied
// literally), then appends one documentation row per property actually
// called out — "font family:  typography/display-sm/font-family  |
// Instrument Sans" as four separate text layers (see buildReadoutRow) —
// so the card still documents every underlying variable and value even
// though they're shown fused into one rendered style above.
async function buildComposedTokenCard(sizeVar, groupLabelParts, modeId, siblingIndex) {
  const card = autoFrame(".token-card", "VERTICAL");
  card.itemSpacing = 8;
  card.fills = [{ type: "SOLID", color: PALETTE.white }];

  // Style-first naming (the group IS the style, e.g. "viewport/typography/
  // display-default") leaves only the property name ("font-size") as the
  // tile suffix — in that case the group's own last segment is the real
  // style name. Category-first naming (e.g. "Font Size/Heading 2") already
  // gives the real style name as the suffix.
  const suffix = tileLabel(sizeVar, groupLabelParts) || sizeVar.name;
  const isStyleFirstGroup = inferTokenKind(suffix) === "font-size";
  const styleName = isStyleFirstGroup ? groupLabelParts[groupLabelParts.length - 1] : suffix;

  const label = await makeText(styleName, FONTS.label, 16, PALETTE.ink, {
    lineHeight: { unit: "PIXELS", value: 24 },
  });
  card.appendChild(label);

  const sample = await makeText(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ\nabcdefghijklmnopqrstuvwxyz\n0123456789",
    FONTS.sampleDefault,
    18,
    PALETTE.ink,
    { lineHeight: { unit: "PERCENT", value: 120 } }
  );
  card.appendChild(sample);

  let entries = [];
  try {
    const siblings = findStyleSiblings(sizeVar, siblingIndex);
    entries = await composeStyleSample(sample, sizeVar, siblings, modeId);
  } catch (e) {
    // composition failed; the sample keeps its plain default styling.
  }

  if (entries.length) {
    const readoutStack = autoFrame("readout-stack", "VERTICAL");
    readoutStack.itemSpacing = 4;
    for (const entry of entries) {
      readoutStack.appendChild(await buildReadoutRow(entry));
    }
    card.appendChild(readoutStack);
  }

  return card;
}

// ---------------------------------------------------------------------
// GROUP SECTIONS — a title (breadcrumb-style label) + a row/grid of tiles
// or cards. Mirrors the original ".color-tile-section" look without
// depending on any pre-existing component.
// ---------------------------------------------------------------------

async function buildGroupTitle(labelParts) {
  const title = autoFrame("title", "HORIZONTAL");
  title.itemSpacing = 16;
  for (let i = 0; i < labelParts.length; i++) {
    const isLast = i === labelParts.length - 1;
    const text = await makeText(labelParts[i], FONTS.title, 32, isLast ? PALETTE.ink : PALETTE.grey, {});
    title.appendChild(text);
    if (!isLast) {
      const line = figma.createLine();
      line.name = "Line";
      line.resize(32, 0);
      line.strokes = [{ type: "SOLID", color: PALETTE.stroke }];
      line.strokeWeight = 2;
      title.appendChild(line);
    }
  }
  return title;
}

async function buildColorGroupSection(group, modeId) {
  const wrapper = autoFrame(".color-tile-section", "VERTICAL");
  wrapper.itemSpacing = 32;
  wrapper.paddingTop = 64;
  wrapper.paddingBottom = 64;
  wrapper.paddingLeft = 64;
  wrapper.paddingRight = 64;

  wrapper.appendChild(await buildGroupTitle(group.labelParts));

  const semantic = group.vars.length > 0 && isAliasVariable(group.vars[0], modeId);
  const tileList = autoFrame("color-tile-list", "HORIZONTAL");
  wrapper.appendChild(tileList);

  if (!semantic) {
    for (const v of group.vars) {
      tileList.appendChild(await buildPrimitiveColorTile(v, group.labelParts, modeId));
    }
  } else {
    tileList.itemSpacing = 64;
    const isBorderGroup = group.labelParts.some((p) => p.toLowerCase().includes("border"));
    for (let i = 0; i < group.vars.length; i += SEMANTIC_COLUMN_CHUNK_SIZE) {
      const chunk = group.vars.slice(i, i + SEMANTIC_COLUMN_CHUNK_SIZE);
      const column = autoFrame("color swatches", "VERTICAL");
      column.itemSpacing = 8;
      tileList.appendChild(column);
      for (const v of chunk) {
        column.appendChild(await buildSemanticColorTile(v, group.labelParts, modeId, isBorderGroup));
      }
    }
  }

  return wrapper;
}

async function buildTokenGroupSection(group, modeId, siblingIndex) {
  const wrapper = autoFrame(".token-group-section", "VERTICAL");
  wrapper.itemSpacing = 32;
  wrapper.paddingTop = 64;
  wrapper.paddingBottom = 64;
  wrapper.paddingLeft = 64;
  wrapper.paddingRight = 64;

  wrapper.appendChild(await buildGroupTitle(group.labelParts));

  const grid = autoFrame("token-card-grid", "VERTICAL");
  grid.itemSpacing = 24;
  wrapper.appendChild(grid);

  for (let i = 0; i < group.vars.length; i += TOKEN_CARDS_PER_ROW) {
    const chunk = group.vars.slice(i, i + TOKEN_CARDS_PER_ROW);
    const row = autoFrame("row", "HORIZONTAL");
    row.itemSpacing = 40;
    grid.appendChild(row);
    for (const v of chunk) {
      const card = isComposableFontSizeVar(v)
        ? await buildComposedTokenCard(v, group.labelParts, modeId, siblingIndex)
        : await buildTokenCard(v, group.labelParts, modeId, siblingIndex);
      row.appendChild(card);
    }
  }

  return wrapper;
}

// ---------------------------------------------------------------------
// SECTION HEADER — dark banner with the collection name + (for multi-mode
// collections) the mode name.
// ---------------------------------------------------------------------

async function buildSectionHeader(title, description) {
  const header = figma.createFrame();
  header.name = ".section-header";
  header.layoutMode = "HORIZONTAL";
  header.primaryAxisSizingMode = "FIXED";
  header.counterAxisSizingMode = "AUTO";
  header.primaryAxisAlignItems = "MIN";
  header.counterAxisAlignItems = "CENTER";
  header.itemSpacing = 80;
  header.paddingTop = 64;
  header.paddingBottom = 64;
  header.paddingLeft = 64;
  header.paddingRight = 64;
  header.fills = [{ type: "SOLID", color: PALETTE.headerBg }];

  const titleText = await makeText(title, FONTS.headerTitle, 80, PALETTE.headerCream, {
    lineHeight: { unit: "PIXELS", value: 80 },
    letterSpacing: { unit: "PERCENT", value: -1 },
    textCase: "UPPER",
  });
  header.appendChild(titleText);

  if (description) {
    const descText = await makeText(description, FONTS.headerDesc, 40, PALETTE.headerCream, {
      lineHeight: { unit: "PERCENT", value: 120 },
    });
    header.appendChild(descText);
  }

  return header;
}

// ---------------------------------------------------------------------
// OUTPUT SECTION — wraps a content frame in a positioned Figma Section,
// replacing any previous output Section with the same label, and applying
// the collection's explicit mode override so bound fills render correctly.
// ---------------------------------------------------------------------

function reflowSections(outputPage) {
  const sections = outputPage.children.filter((n) => n.type === "SECTION").sort((a, b) => a.x - b.x);
  let cursor = 0;
  for (const s of sections) {
    s.x = cursor;
    cursor += s.width + SECTION_GAP;
  }
}

// Mirrors Figma's own "Resize to fit" action, but keeps the same MARGIN gap
// on the bottom/right edges that buildOutputSection already bakes into the
// wrapper's top-left inset (wrapper.x = wrapper.y = MARGIN) — so a resized
// Section reads as evenly padded on all four sides instead of tight against
// content on the bottom/right while still inset on the top/left. A Section
// built by an older version of this plugin (or one whose content changed
// without being regenerated) can otherwise drift out of sync with its
// actual content — too large in some directions, clipping overflow in
// others — since a stale stored size never self-corrects on its own.
function resizeSectionToFit(section) {
  let maxX = 0;
  let maxY = 0;
  for (const child of section.children) {
    maxX = Math.max(maxX, child.x + child.width);
    maxY = Math.max(maxY, child.y + child.height);
  }
  if (maxX > 0 && maxY > 0) section.resizeWithoutConstraints(maxX + MARGIN, maxY + MARGIN);
}

async function buildOutputSection(sectionLabel, headerTitle, headerDescription, groupSections, xOffset, outputPage, collection, modeId, modeName) {
  const existingSection = outputPage.findOne((n) => n.name === sectionLabel && n.type === "SECTION");
  if (existingSection) {
    for (const child of [...existingSection.children]) child.remove();
    existingSection.remove();
  }

  const wrapper = figma.createFrame();
  wrapper.name = "collection_" + sectionLabel;
  wrapper.layoutMode = "VERTICAL";
  wrapper.primaryAxisSizingMode = "AUTO";
  wrapper.counterAxisSizingMode = "FIXED";
  wrapper.itemSpacing = 0;
  wrapper.fills = [{ type: "SOLID", color: PALETTE.white }];

  wrapper.appendChild(await buildSectionHeader(headerTitle, headerDescription));

  for (const groupSection of groupSections) {
    wrapper.appendChild(groupSection);
  }

  wrapper.counterAxisSizingMode = "AUTO";
  for (const child of wrapper.children) {
    if (child.name === ".section-header") child.layoutSizingHorizontal = "FILL";
  }

  const section = figma.createSection();
  section.name = sectionLabel;
  section.fills = [{ type: "SOLID", opacity: 1, color: PALETTE.sectionBg }];
  outputPage.appendChild(section);
  section.appendChild(wrapper);
  wrapper.x = MARGIN;
  wrapper.y = MARGIN;
  resizeSectionToFit(section);
  section.x = xOffset;
  section.y = 0;

  if (modeName) {
    const matchingMode = collection.modes.find((m) => m.name === modeName);
    if (matchingMode) {
      try {
        section.setExplicitVariableModeForCollection(collection, matchingMode.modeId);
      } catch (e) {
        // this collection doesn't support an override here; skip
      }
    }
  }

  return section;
}

// ---------------------------------------------------------------------
// TOP-LEVEL GENERATION
// ---------------------------------------------------------------------

async function generateForCollectionMode(collection, modeId, modeName, xCursor, outputPage, selectedGroupLabels) {
  const allVars = [];
  for (const id of collection.variableIds) {
    allVars.push(await figma.variables.getVariableByIdAsync(id));
  }

  // selectedGroupLabels is the set of "labelParts.join(' / ')" strings the
  // UI's checkbox tree left checked for this collection — null means no
  // filtering (every group renders), matching the old whole-collection
  // behavior. Filtering happens here, after discovery, so sibling matching
  // downstream (buildTokenSiblingIndex / computeConsumedSiblingIds) still
  // sees every variable in the collection regardless of what's selected —
  // deselecting "Line height" shouldn't degrade a still-selected "Font
  // Size" style's composed sample, which needs that sibling's value.
  const colorGroups = discoverColorGroups(allVars, modeId).filter(
    (g) => !selectedGroupLabels || selectedGroupLabels.has(g.labelParts.join(" / "))
  );
  const tokenGroups = discoverTokenGroups(allVars).filter(
    (g) => !selectedGroupLabels || selectedGroupLabels.has(g.labelParts.join(" / "))
  );

  const created = [];
  const baseLabel = modeName ? collection.name + " — " + modeName : collection.name;

  if (colorGroups.length) {
    const groupSections = [];
    for (const g of colorGroups) {
      if (g.vars.length) groupSections.push(await buildColorGroupSection(g, modeId));
    }
    const section = await buildOutputSection(
      baseLabel + " — Colors",
      collection.name,
      modeName,
      groupSections,
      xCursor,
      outputPage,
      collection,
      modeId,
      modeName
    );
    created.push(section);
    xCursor += section.width + SECTION_GAP;
  }

  if (tokenGroups.length) {
    const groupSections = [];
    const siblingIndex = buildTokenSiblingIndex(allVars);
    const consumedIds = computeConsumedSiblingIds(allVars, siblingIndex);
    for (const g of tokenGroups) {
      const visibleVars = g.vars.filter((v) => !consumedIds.has(v.id));
      if (visibleVars.length) {
        groupSections.push(await buildTokenGroupSection({ labelParts: g.labelParts, vars: visibleVars }, modeId, siblingIndex));
      }
    }
    const section = await buildOutputSection(
      baseLabel + " — Tokens",
      collection.name,
      modeName,
      groupSections,
      xCursor,
      outputPage,
      collection,
      modeId,
      modeName
    );
    created.push(section);
    xCursor += section.width + SECTION_GAP;
  }

  return { created, xCursor };
}

// `selection` is { [collectionName]: string[] of selected group labels },
// exactly the shape the UI's checkbox tree sends — a collection missing
// from it, or present with an empty array, is skipped entirely.
async function generateSelected(selection) {
  let outputPage = figma.root.children.find((p) => p.name === "Style Guide");
  if (!outputPage) {
    outputPage = figma.createPage();
    outputPage.name = "Style Guide";
  }
  await outputPage.loadAsync();
  await figma.setCurrentPageAsync(outputPage);

  const orderedNames = Object.keys(selection).sort(compareCollections);
  const allCollections = await figma.variables.getLocalVariableCollectionsAsync();

  let xCursor = 0;
  const createdSections = [];
  for (const name of orderedNames) {
    const groupLabels = selection[name];
    if (!groupLabels || !groupLabels.length) continue;
    const collection = allCollections.find((c) => c.name === name);
    if (!collection) continue;
    const selectedGroupLabels = new Set(groupLabels);
    const modes = collection.modes;

    if (modes.length <= 1) {
      const { created, xCursor: next } = await generateForCollectionMode(
        collection, modes[0].modeId, null, xCursor, outputPage, selectedGroupLabels
      );
      createdSections.push(...created);
      xCursor = next;
    } else {
      for (const mode of modes) {
        const { created, xCursor: next } = await generateForCollectionMode(
          collection, mode.modeId, mode.name, xCursor, outputPage, selectedGroupLabels
        );
        createdSections.push(...created);
        xCursor = next;
      }
    }
  }

  // Belt-and-suspenders re-fit: buildOutputSection already calls
  // resizeSectionToFit for each section right after building it, but under
  // this function's tight back-to-back frame construction (many sections,
  // no yielding in between) Figma's auto-layout recompute for a wrapper's
  // final width can occasionally still be settling at the instant that
  // per-section resize reads it, leaving a section a hair stale relative to
  // its actual content. Re-running the fit once more here, after every
  // section for this whole generation has finished building and had a
  // chance to fully settle, catches that without relying on timing.
  for (const section of createdSections) resizeSectionToFit(section);
  reflowSections(outputPage);

  figma.currentPage.selection = createdSections;
  figma.viewport.scrollAndZoomIntoView(createdSections);

  return { sectionCount: createdSections.length };
}

// Builds the tree the UI's checkbox picker is drawn from: one row per
// local variable collection (regardless of naming convention — nothing
// here filters by variable name), with a nested row per group it would
// actually produce a Section for, using the exact same discovery
// generation itself runs — so a group a user sees (and can leave
// unchecked) here is precisely one they can leave out of the output.
// Uses each collection's first mode only to decide the group shape:
// grouping comes from variable names, not resolved values, so it doesn't
// meaningfully vary by mode.
async function listCollectionTree() {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const ordered = [...collections].sort((a, b) => compareCollections(a.name, b.name));
  const tree = [];
  for (const collection of ordered) {
    const allVars = [];
    for (const id of collection.variableIds) {
      allVars.push(await figma.variables.getVariableByIdAsync(id));
    }
    const modeId = collection.modes[0].modeId;
    // Variables per group label — a label can show up in both the color and
    // token discovery, so counts accumulate. A Map keeps discovery order.
    const counts = new Map();
    for (const g of [...discoverColorGroups(allVars, modeId), ...discoverTokenGroups(allVars)]) {
      const label = g.labelParts.join(" / ");
      counts.set(label, (counts.get(label) || 0) + g.vars.length);
    }
    const groups = [...counts.keys()];
    const groupCounts = {};
    for (const [label, n] of counts) groupCounts[label] = n;
    tree.push({ name: collection.name, groups, groupCounts });
  }
  return tree;
}

figma.ui.onmessage = async (msg) => {
  if (msg.type === "ui-ready") {
    try {
      const collections = await listCollectionTree();
      figma.ui.postMessage({ type: "tree", collections });
    } catch (err) {
      figma.ui.postMessage({ type: "error", message: err.message });
    }
  } else if (msg.type === "generate") {
    const hasAnySelection = msg.selection && Object.values(msg.selection).some((groups) => groups && groups.length);
    if (!hasAnySelection) {
      figma.ui.postMessage({ type: "error", message: "Select at least one collection." });
      return;
    }
    try {
      const result = await generateSelected(msg.selection);
      figma.ui.postMessage({ type: "success", message: "Generated " + result.sectionCount + " section(s) on the Style Guide page." });
    } catch (err) {
      figma.ui.postMessage({ type: "error", message: err.message });
    }
  }
};
