import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const bundle = path.join(root, '.output/chrome-mv3');
const manifest = JSON.parse(await readFile(path.join(bundle, 'manifest.json'), 'utf8'));
const product = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
assert.equal(manifest.version, product.version, 'Build and package versions must match');
assert.equal(manifest.manifest_version, 3, 'Prepare a production MV3 build first');

const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
const runtimeHelpers = new Set([
  'wxt', '@wxt-dev/browser', 'webextension-polyfill',
  '@webext-core/isolated-element', '@webext-core/match-patterns',
  '@1natsu/wait-element', 'is-potential-custom-element-name', 'defu', 'many-keys-map',
].map(name => `node_modules/${name}`));
const notices = ['Third-party licenses and notices bundled with MeliExtension.\nRuntime dependencies and extension build helpers are included conservatively.\n'];
let packages = 0;

for (const [directory, item] of Object.entries(lock.packages)) {
  if (!directory.startsWith('node_modules/') || (item.dev && !runtimeHelpers.has(directory))) continue;
  assert.match(item.resolved ?? '', /^https:\/\/registry\.npmjs\.org\//, 'Dependency must have a registry source');
  const installed = path.join(root, directory);
  const metadata = JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8'));
  assert.equal(metadata.version, item.version, 'Installed dependency differs from the lockfile');
  assert.equal(typeof metadata.license, 'string', 'Dependency requires declared license metadata');
  const documents = (await readdir(installed)).filter(name => /^(licen[sc]e|copying|notice|ofl)([.-]|$)/i.test(name)).sort();
  notices.push(`\n===== ${metadata.name}@${metadata.version} =====\nLicense: ${metadata.license}\nSource: ${item.resolved}\n`);
  if (!documents.length && ['wxt', '@wxt-dev/browser'].includes(metadata.name)) {
    assert.equal(metadata.license, 'MIT');
    assert.equal(metadata.repository?.url, 'git+https://github.com/wxt-dev/wxt.git');
    notices.push('\nLicense source: https://raw.githubusercontent.com/wxt-dev/wxt/ee7c2cd3afc74f55f6c060dbd95c6ac930596325/LICENSE\n');
    notices.push(await readFile(path.join(root, 'docs/licenses/WXT-LICENSE.txt'), 'utf8'), '\n');
  } else if (!documents.length && ['@webext-core/isolated-element', '@webext-core/match-patterns'].includes(metadata.name)) {
    assert.equal(metadata.license, 'MIT');
    assert.equal(metadata.repository?.url, 'git+https://github.com/aklinker1/webext-core.git');
    notices.push('\nLicense source: https://raw.githubusercontent.com/aklinker1/webext-core/49c570d155cf5a57b7a15abded01ed4071f17f95/LICENSE\n');
    notices.push(await readFile(path.join(root, 'docs/licenses/WEBEXT-CORE-LICENSE.txt'), 'utf8'), '\n');
  } else {
    assert.ok(documents.length, `${metadata.name} requires a license file`);
  }
  for (const document of documents) {
    notices.push(`\n--- ${document} ---\n`, await readFile(path.join(installed, document), 'utf8'), '\n');
  }
  packages += 1;
}

await mkdir(path.join(bundle, 'docs'), { recursive: true });
for (const document of ['README.md', 'PRIVACY.md', 'docs/implementation-plan.md']) {
  await copyFile(path.join(root, document), path.join(bundle, document));
}
await writeFile(path.join(bundle, 'THIRD_PARTY_NOTICES.txt'), notices.join(''), 'utf8');
console.log(JSON.stringify({ prepared: '.output/chrome-mv3', licensedPackages: packages, version: manifest.version }));