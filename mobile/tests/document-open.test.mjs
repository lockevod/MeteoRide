/* How another app opens a route in MeteoRide, checked as text.
 *
 * Nothing in this repository builds iOS, so the only thing standing between a wrong
 * declaration and a phone is reading it — the same reason `privacy-manifest.test.mjs`
 * exists. What is pinned here cost a device, three log captures and two wrong
 * conclusions, and every part of it looks eminently undoable to someone who meets the
 * symptom without that history.
 *
 * MeteoRide used to ship a share extension. It appeared in the share sheet, stored the
 * file and finished — and could not open the app, because no share extension can: Apple
 * gives `NSExtensionContext.open` to a Today widget and to no other extension type, and
 * on iOS 18 the responder-chain `openURL:` workaround is refused outright. Apple's DTS,
 * developer.apple.com/forums/thread/764570: "App extensions are not allowed to open URLs
 * directly. This isn't accidental, but a deliberate design choice on Apple's part."
 *
 * What opens the app is the other mechanism entirely: `CFBundleDocumentTypes`, whose
 * entry LAUNCHES. Both mechanisms put an icon in the share sheet, with the same name and
 * the same artwork, and the extension's was the one being tapped — which is why sharing
 * a route appeared to do nothing while the route was, in fact, already stored. Removing
 * the extension from the build was tested on the device and fixed it.
 *
 * These assertions read the declarations as PARSED VALUES, not as text. The first version
 * of this file matched them with regexes and passed against three separate mutations that
 * reproduced the original bug — including deleting the `.gpx` binding outright. Anything
 * added here should be checked the same way: break the plist, watch the test go red.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const source = await readFile(join(HERE, '../native/ios/Info.plist.additions.xml'), 'utf8');

/** The additions file is a plist FRAGMENT: top-level <key>/value pairs, no enclosing
 *  <dict>. Parsed into a plain object, so an assertion names a value rather than a
 *  shape, and reordering keys or reindenting cannot turn it red. */
function parsePlistFragment(xml) {
  const src = xml.replace(/<!--[\s\S]*?-->/g, '');

  // The tokeniser below understands a deliberately small dialect. Anything outside it
  // has to fail LOUDLY rather than parse to a wrong value: a test that reads a plist
  // differently from the way iOS reads it is worse than no test at all. Both of these
  // came from an adversarial review that got a wrong value past the first version —
  // `<string>gpx<![CDATA[wrong]]></string>` read as `gpx`, and an attributed tag was
  // skipped entirely.
  if (/<!\[CDATA\[/.test(src)) throw new Error('CDATA: the tokeniser would silently drop it');
  for (const [, inner] of src.matchAll(/<([^!?/][^>]*)>/g)) {
    if (/\s/.test(inner.replace(/\s*\/$/, ''))) throw new Error(`attributes on <${inner}>: not understood`);
  }

  const tags = [];
  const re = /<(\/?)([a-zA-Z]+)(\s*\/)?>([^<]*)/g;
  for (let m; (m = re.exec(src)); ) {
    tags.push({ close: !!m[1], name: m[2], selfClosing: !!m[3], text: m[4] });
  }
  const unescape = (s) => s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');

  function value(i) {
    const t = tags[i];
    if (t.selfClosing) {
      // `<array/>` used to come back as `false`, which quietly satisfied the boolean
      // assertion on LSSupportsOpeningDocumentsInPlace. An empty array is legal plist;
      // this file has none, and if it grows one the test should say so rather than
      // guess.
      if (t.name !== 'true' && t.name !== 'false') {
        throw new Error(`<${t.name}/> is empty; only <true/> and <false/> are values here`);
      }
      return [t.name === 'true', i + 1];
    }
    if (t.name === 'array') {
      const out = [];
      let j = i + 1;
      while (!(tags[j].close && tags[j].name === 'array')) { const [v, n] = value(j); out.push(v); j = n; }
      return [out, j + 1];
    }
    if (t.name === 'dict') {
      const [out, end] = pairs(i + 1, 'dict');
      return [out, end];
    }
    if (t.name === 'integer' || t.name === 'real') return [Number(t.text), i + 2];
    return [unescape(t.text), i + 2];            // string, date, data
  }

  /** Reads <key>value</key> pairs until `closes` shuts them, or the tags run out. */
  function pairs(start, closes) {
    const out = {};
    let i = start;
    while (i < tags.length) {
      if (closes && tags[i].close && tags[i].name === closes) return [out, i + 1];
      if (tags[i].name !== 'key' || tags[i].close) { i += 1; continue; }
      const key = unescape(tags[i].text);
      const [v, next] = value(i + 2);            // skip </key>
      out[key] = v;
      i = next;
    }
    return [out, i];
  }
  return pairs(0, null)[0];
}

const plist = parsePlistFragment(source);

test('the share extension stays gone', async () => {
  // Not a style preference. While it existed it took the tap that was meant for the
  // document entry, and it cannot do anything with it. Adding one back reintroduces a
  // second, identical-looking MeteoRide in the share sheet that silently does nothing.
  // The reason is pinned too: a typo in the path would otherwise pass forever.
  await assert.rejects(
    access(join(HERE, '../native/ios/ShareExtension')),
    { code: 'ENOENT' },
    'the share extension is back; it hides the entry that actually opens the app'
  );
});

/* Each identifier is declared on the side that owns it: `cc.meteoride.gpx` exported,
 * because MeteoRide invented it and nobody else will ever export it; `com.google.earth.kml`
 * imported, because it is Google's and this app only handles it. Where both exist for one
 * identifier, the exported declaration wins.
 *
 * What this test does NOT assert, because it is not true: that imported would have left
 * `.gpx` bound to nothing. Apple's own wording is that an imported declaration is how you
 * make the system know a type "even if the actual [owning] application is not available".
 * The GPX declaration was changed from imported to exported while chasing a bug, and the
 * device only ever settled the OTHER change made at the same time — removing the share
 * extension. This assertion pins a correctness decision, not a proven cause.
 */
test('each type identifier is declared on the side that owns it', () => {
  const exported = (plist.UTExportedTypeDeclarations || []).map((d) => d.UTTypeIdentifier);
  const imported = (plist.UTImportedTypeDeclarations || []).map((d) => d.UTTypeIdentifier);
  assert.deepEqual(exported, ['cc.meteoride.gpx'],
    'a UTI the app invents must be exported; imported says another app owns it');
  assert.deepEqual(imported, ['com.google.earth.kml'],
    "KML is Google's type, so imported — but it must still be declared, or it binds to nothing");
});

test('each declared type actually binds its filename extension', () => {
  // The binding is the whole point and it was missing once: a declaration with no tag
  // specification names an identifier the system attaches to no file at all, so
  // `CFBundleDocumentTypes` has nothing to match an incoming route against.
  const declared = [...(plist.UTExportedTypeDeclarations || []), ...(plist.UTImportedTypeDeclarations || [])];
  const bindings = Object.fromEntries(declared.map((d) => [
    d.UTTypeIdentifier,
    d.UTTypeTagSpecification?.['public.filename-extension'] || [],
  ]));
  assert.deepEqual(bindings, {
    'cc.meteoride.gpx': ['gpx'],
    'com.google.earth.kml': ['kml'],
  });
  for (const d of declared) {
    assert.ok((d.UTTypeConformsTo || []).includes('public.xml'),
      `${d.UTTypeIdentifier} declares no conformance; both formats are XML`);
  }
});

test('the document types the app opens are exactly the ones it declares', () => {
  // The two halves have to name the same identifiers: `CFBundleDocumentTypes` lists what
  // an incoming file is matched against, and the declarations above are what give those
  // identifiers a meaning. A rename in one half alone is silent on the device, and this
  // is the assertion that catches it — compared as values, so a suffix typo fails too.
  const documents = plist.CFBundleDocumentTypes;
  assert.ok(Array.isArray(documents) && documents.length === 1,
    'no CFBundleDocumentTypes: nothing would open the app');
  const declared = [
    ...(plist.UTExportedTypeDeclarations || []),
    ...(plist.UTImportedTypeDeclarations || []),
  ].map((d) => d.UTTypeIdentifier);
  assert.deepEqual([...documents[0].LSItemContentTypes].sort(), [...declared].sort());
  assert.equal(documents[0].LSHandlerRank, 'Alternate');
  assert.equal(plist.LSSupportsOpeningDocumentsInPlace, false,
    'ingest copies the bytes and deletes the system inbox copy; in-place would be a lie');
});

test('the tokeniser refuses what it would otherwise read wrongly', () => {
  // The guards above are load bearing, so they get their own mutations. Each of these
  // parsed to a plausible WRONG value in the first version of this file.
  assert.throws(() => parsePlistFragment('<key>k</key><array/>'), /only <true\/> and <false\/>/);
  assert.throws(() => parsePlistFragment('<key>k</key><string>gpx<![CDATA[wrong]]></string>'), /CDATA/);
  assert.throws(() => parsePlistFragment('<key>k</key><string xml:space="preserve">x</string>'), /attributes/);
  // And it still reads the ordinary shapes it is meant to.
  assert.deepEqual(
    parsePlistFragment('<key>a</key><array><string>x</string><string>y</string></array><key>b</key><true/>'),
    { a: ['x', 'y'], b: true }
  );
  assert.deepEqual(parsePlistFragment('<key>a</key><string>&amp;&lt;&quot;</string>'), { a: '&<"' });
});

test('the declarations carry the MIME type and role a handler is judged by', () => {
  const declared = [...plist.UTExportedTypeDeclarations, ...plist.UTImportedTypeDeclarations];
  assert.deepEqual(
    Object.fromEntries(declared.map((d) => [d.UTTypeIdentifier, d.UTTypeTagSpecification['public.mime-type']])),
    {
      'cc.meteoride.gpx': ['application/gpx+xml'],
      'com.google.earth.kml': ['application/vnd.google-earth.kml+xml'],
    }
  );
  assert.equal(plist.CFBundleDocumentTypes[0].CFBundleTypeRole, 'Viewer');
});

/* `mobile/ios/` is generated and gitignored, so the file above is the tracked source and
 * the one Xcode actually builds is maintained beside it by hand. They drift, and the
 * drift ships: only the generated one reaches the device. Compared here when it exists,
 * skipped when it does not, because it will not on a fresh clone or in CI. */
test('the plist Xcode builds agrees with the tracked one', async (t) => {
  const generated = join(HERE, '../ios/App/App/Info.plist');
  let xml;
  try { xml = await readFile(generated, 'utf8'); }
  catch { return t.skip('mobile/ios/ has not been generated here'); }

  // A full plist, not a fragment: parse the outer <dict> rather than scanning loose keys.
  const body = /<dict>([\s\S]*)<\/dict>/.exec(xml);
  assert.ok(body, 'the generated Info.plist has no root dict');
  const shipped = parsePlistFragment(body[1]);
  for (const key of [
    'UTExportedTypeDeclarations', 'UTImportedTypeDeclarations',
    'CFBundleDocumentTypes', 'LSSupportsOpeningDocumentsInPlace', 'CFBundleURLTypes',
    // The names too: they live only in the generated plist unless the fragment carries
    // them, and `cap add ios` would put Capacitor's "App" back without a word.
    'CFBundleDisplayName', 'CFBundleName', 'CFBundleLocalizations',
    // The permission reasons: App Review reads the built one, not this fragment.
    'NSLocationWhenInUseUsageDescription', 'NSLocationAlwaysAndWhenInUseUsageDescription',
    'NSLocationAlwaysUsageDescription',
  ]) {
    assert.deepEqual(shipped[key], plist[key], `${key} has drifted between the tracked and the built plist`);
  }
});

test('the app declares both languages it speaks', () => {
  assert.deepEqual([...plist.CFBundleLocalizations].sort(), ['en', 'es']);
});

/* CFBundleLocalizations declares es, so a Spanish iPhone draws the permission alerts in
 * Spanish. Without a Spanish InfoPlist.strings the reason inside them stayed English: a
 * half-translated prompt, which is what a second review flagged. Every purpose string the
 * plist declares needs its Spanish line. */
const esPath = join(HERE, '../native/ios/es.lproj/InfoPlist.strings');
const esStrings = await readFile(esPath, 'utf8');

/** Parses an old-style .strings file the way iOS must, or throws. Matching each key line by
 *  itself passed files iOS reads as nothing at all: one line without its semicolon anywhere
 *  makes the whole file unreadable, and a comment left open swallows every key after it. */
function parseStrings(src) {
  const out = {};
  let i = 0;
  const skip = () => {
    for (;;) {
      while (/\s/.test(src[i] ?? '')) i++;
      if (src.startsWith('/*', i)) {
        const end = src.indexOf('*/', i + 2);
        if (end < 0) throw new Error(`comment opened at ${i} never closes`);
        i = end + 2;
      } else if (src.startsWith('//', i)) {
        i = src.indexOf('\n', i); if (i < 0) i = src.length;
      } else return;
    }
  };
  const quoted = () => {
    if (src[i] !== '"') throw new Error(`expected a quoted string at ${i}: ${JSON.stringify(src.slice(i, i + 20))}`);
    let s = ''; i++;
    while (src[i] !== '"') {
      if (i >= src.length) throw new Error('string never closes');
      if (src[i] === '\\') { const c = src[++i]; s += c === 'n' ? '\n' : c === 't' ? '\t' : c; i++; }
      else s += src[i++];
    }
    i++; return s;
  };
  const expect = (c) => { skip(); if (src[i] !== c) throw new Error(`expected ${c} at ${i}`); i++; };
  for (skip(); i < src.length; skip()) {
    const k = quoted(); expect('='); skip(); out[k] = quoted(); expect(';');
  }
  return out;
}

test('the Spanish strings parse, and every permission reason has its translation', async (t) => {
  const es = parseStrings(esStrings);
  const keys = Object.keys(plist).filter((k) => /UsageDescription$/.test(k));
  assert.ok(keys.length >= 3, 'the plist declares fewer purpose strings than expected; the scan is broken');
  const missing = keys.filter((k) => !(es[k] || '').trim());
  assert.deepEqual(missing, [], 'purpose strings with no Spanish line');
  if (process.platform !== 'darwin') return;
  // Apple's own reader, where there is one, must agree key for key.
  const { execFileSync } = await import('node:child_process');
  const apple = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', esPath], { encoding: 'utf8' }));
  assert.deepEqual(apple, es, 'plutil reads the file differently');
});

test('the strings parser refuses what iOS would not read', () => {
  const good = '/* c */\n"A" = "x";\n"B" = "y \\" z";\n';
  assert.deepEqual(parseStrings(good), { A: 'x', B: 'y " z' });
  assert.throws(() => parseStrings(good + '"C" = "x"\n'), /expected ;/);
  assert.throws(() => parseStrings('/* open\n"A" = "x";\n"B" = "y";\n'), /never closes/);
  assert.throws(() => parseStrings(good + 'stray'), /expected a quoted string/);
});

/* App Review (21/09, 5.1.1(ii)) rejected a reason that said what, but gave no example.
 * The drift tests only compare copies, so putting the old text back in every copy would
 * pass them; this is what would not. */
test('every location reason gives an example, in both languages', () => {
  const es = parseStrings(esStrings);
  for (const key of Object.keys(plist).filter((k) => /^NSLocation.*UsageDescription$/.test(k))) {
    assert.match(plist[key], /For example,/, `${key} gives no example`);
    assert.match(es[key], /Por ejemplo,/, `${key} (es) gives no example`);
  }
});

/* Centring the map asks OpenStreetMap for the tiles of that area, and privacy-ios.html
 * says so. A reason promising the position goes nowhere would contradict the policy the
 * listing links to; "not sent to the weather services" is the exact claim. */
test('no location reason promises more than the privacy policy', () => {
  const es = parseStrings(esStrings);
  const keys = Object.keys(plist).filter((k) => /^NSLocation.*UsageDescription$/.test(k));
  assert.equal(keys.length, 3, 'the plist no longer declares the three location reasons');
  for (const key of keys) {
    assert.doesNotMatch(plist[key], /anywhere|anyone|nowhere|never leaves/i, `${key} claims the position never leaves the phone`);
    assert.doesNotMatch(es[key], /ningún (sitio|lado)|nadie|ninguna parte|no sale/i, `${key} (es) claims the position never leaves the phone`);
  }
});

test('the Xcode project ships the Spanish strings it is given', async (t) => {
  let pbx;
  try { pbx = await readFile(join(HERE, '../ios/App/App.xcodeproj/project.pbxproj'), 'utf8'); }
  catch { return t.skip('mobile/ios/ has not been generated here'); }
  const copy = await readFile(join(HERE, '../ios/App/App/es.lproj/InfoPlist.strings'), 'utf8').catch(() => null);
  assert.equal(copy, esStrings, 'ios/App/App/es.lproj/InfoPlist.strings has drifted from the tracked one');
  // Follow the IDs, not the comments: file reference -> variant group -> build file -> Resources.
  const fileRef = pbx.match(/(\w{24}) \/\* es \*\/ = \{isa = PBXFileReference;[^}]*path = es\.lproj\/InfoPlist\.strings;/)?.[1];
  assert.ok(fileRef, 'the strings file is not in the Xcode project');
  const group = [...pbx.matchAll(/(\w{24}) \/\* InfoPlist\.strings \*\/ = \{\s*isa = PBXVariantGroup;([\s\S]*?)\};/g)]
    .find((m) => m[2].includes(fileRef))?.[1];
  assert.ok(group, 'the Spanish file is not a variant of a localised InfoPlist.strings');
  const buildFile = pbx.match(new RegExp(`(\\w{24}) /\\* [^*]+ \\*/ = \\{isa = PBXBuildFile; fileRef = ${group}\\b`))?.[1];
  assert.ok(buildFile, 'the localised InfoPlist.strings is never built');
  const resources = pbx.match(/isa = PBXResourcesBuildPhase;[\s\S]*?files = \(([\s\S]*?)\);/)?.[1] ?? '';
  assert.ok(resources.includes(buildFile), 'the strings file is not in the Resources build phase');
  assert.match(pbx, /knownRegions = \([^)]*\bes,/, 'es is not a known region of the project');
});
