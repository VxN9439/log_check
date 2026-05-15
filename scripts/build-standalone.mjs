import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();
const distDir = path.join(rootDir, 'dist');
const outputDir = path.join(rootDir, 'browser-release');
const outputFile = path.join(outputDir, 'Log-Check-browser.html');

const html = await readFile(path.join(distDir, 'index.html'), 'utf8');

const scriptMatch = html.match(/<script[^>]+src="\.\/assets\/([^"]+\.js)"[^>]*><\/script>/);
const styleMatch = html.match(/<link[^>]+href="\.\/assets\/([^"]+\.css)"[^>]*>/);

if (!scriptMatch || !styleMatch) {
  throw new Error('Cannot find Vite JS/CSS assets in dist/index.html.');
}

const script = await readFile(path.join(distDir, 'assets', scriptMatch[1]), 'utf8');
const style = await readFile(path.join(distDir, 'assets', styleMatch[1]), 'utf8');

const standalone = html
  .replace(styleMatch[0], () => `<style>\n${style}\n</style>`)
  .replace(scriptMatch[0], () => `<script type="module">\n${script}\n</script>`);

await mkdir(outputDir, { recursive: true });
await writeFile(outputFile, standalone, 'utf8');

console.log(`Standalone browser file created: ${outputFile}`);
