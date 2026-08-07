// Deterministically pack a private runtime-asset tree into independently
// uploadable ZIP volumes. No third-party ZIP dependency is used: private asset
// packaging must still work before `npm ci`, and every archive stays small
// enough for services with a 25 MB per-file ceiling.
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, parse, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateRawSync } from 'node:zlib';

export const DEFAULT_MAX_ARCHIVE_BYTES = 24_000_000;
const ZIP_EOCD_BYTES = 22;
const ZIP32_MAX = 0xffffffff;
const UTF8_FLAG = 0x0800;
const DOS_1980_01_01 = 0x0021;

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < CRC_TABLE.length; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const compareText = (a, b) => (a < b ? -1 : (a > b ? 1 : 0));

function listFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => compareText(a.name, b.name))) {
      const absolute = resolve(directory, entry.name);
      const info = lstatSync(absolute);
      if (info.isSymbolicLink()) throw new Error(`Private asset bundles do not follow symbolic links: ${absolute}`);
      if (info.isDirectory()) visit(absolute);
      else if (info.isFile()) {
        const path = relative(root, absolute).split(sep).join('/');
        if (path.includes('\\') || path.split('/').some((part) => !part || part === '.' || part === '..')) {
          throw new Error(`Private asset path is not ZIP-safe: ${path}`);
        }
        files.push({ absolute, path, bytes: info.size });
      }
    }
  };
  visit(root);
  return files.sort((a, b) => compareText(a.path, b.path));
}

function prepareEntry(file) {
  if (file.bytes >= ZIP32_MAX) throw new Error(`ZIP64 is not supported; file is too large: ${file.path}`);
  const data = readFileSync(file.absolute);
  const bytes = data.length;
  if (bytes >= ZIP32_MAX) throw new Error(`ZIP64 is not supported; file is too large: ${file.path}`);
  const deflated = deflateRawSync(data, { level: 9 });
  const useDeflate = deflated.length < data.length;
  const payload = useDeflate ? deflated : data;
  const method = useDeflate ? 8 : 0;
  const name = Buffer.from(file.path, 'utf8');
  if (name.length > 0xffff) throw new Error(`ZIP path is too long: ${file.path}`);
  const checksum = crc32(data);

  const localHeader = Buffer.alloc(30 + name.length);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(UTF8_FLAG, 6);
  localHeader.writeUInt16LE(method, 8);
  localHeader.writeUInt16LE(0, 10);
  localHeader.writeUInt16LE(DOS_1980_01_01, 12);
  localHeader.writeUInt32LE(checksum, 14);
  localHeader.writeUInt32LE(payload.length, 18);
  localHeader.writeUInt32LE(bytes, 22);
  localHeader.writeUInt16LE(name.length, 26);
  localHeader.writeUInt16LE(0, 28);
  name.copy(localHeader, 30);

  return {
    ...file,
    bytes,
    name,
    method,
    checksum,
    payload,
    localHeader,
    sha256: sha256(data),
    archiveContribution: localHeader.length + payload.length + 46 + name.length,
  };
}

function centralHeader(entry, localOffset) {
  const header = Buffer.alloc(46 + entry.name.length);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(UTF8_FLAG, 8);
  header.writeUInt16LE(entry.method, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(DOS_1980_01_01, 14);
  header.writeUInt32LE(entry.checksum, 16);
  header.writeUInt32LE(entry.payload.length, 20);
  header.writeUInt32LE(entry.bytes, 24);
  header.writeUInt16LE(entry.name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(localOffset, 42);
  entry.name.copy(header, 46);
  return header;
}

function makeZip(entries) {
  if (entries.length > 0xffff) throw new Error('A ZIP volume cannot contain more than 65,535 files.');
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const entry of entries) {
    localParts.push(entry.localHeader, entry.payload);
    centralParts.push(centralHeader(entry, localOffset));
    localOffset += entry.localHeader.length + entry.payload.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(ZIP_EOCD_BYTES);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

function partitionEntries(entries, exclusiveLimit) {
  const bins = [];
  const bySize = [...entries].sort(
    (a, b) => b.archiveContribution - a.archiveContribution || compareText(a.path, b.path),
  );
  for (const entry of bySize) {
    if (ZIP_EOCD_BYTES + entry.archiveContribution >= exclusiveLimit) {
      throw new Error(
        `${entry.path} cannot fit below ${exclusiveLimit} bytes by itself `
        + `(${ZIP_EOCD_BYTES + entry.archiveContribution} ZIP bytes).`,
      );
    }
    let selected = null;
    let smallestRemainder = Infinity;
    for (const bin of bins) {
      const nextBytes = bin.bytes + entry.archiveContribution;
      const remainder = exclusiveLimit - nextBytes;
      if (nextBytes < exclusiveLimit && remainder < smallestRemainder) {
        selected = bin;
        smallestRemainder = remainder;
      }
    }
    if (!selected) {
      selected = { bytes: ZIP_EOCD_BYTES, entries: [] };
      bins.push(selected);
    }
    selected.entries.push(entry);
    selected.bytes += entry.archiveContribution;
  }
  for (const bin of bins) bin.entries.sort((a, b) => compareText(a.path, b.path));
  return bins;
}

function safeOutput(source, output) {
  const sourcePrefix = `${source}${sep}`;
  const outputPrefix = `${output}${sep}`;
  if (source === output || source.startsWith(outputPrefix) || output.startsWith(sourcePrefix)) {
    throw new Error('Source and output directories must be separate sibling trees.');
  }
  if (output === parse(output).root) throw new Error('Refusing to use a filesystem root as bundle output.');
}

export function bundleAssets({
  source,
  output,
  name = null,
  maxArchiveBytes = DEFAULT_MAX_ARCHIVE_BYTES,
  force = false,
}) {
  if (!source || !output) throw new Error('Both source and output directories are required.');
  if (!Number.isSafeInteger(maxArchiveBytes) || maxArchiveBytes <= ZIP_EOCD_BYTES) {
    throw new Error('maxArchiveBytes must be a safe integer larger than the ZIP header.');
  }
  const sourceRoot = resolve(source);
  const outputRoot = resolve(output);
  if (!existsSync(sourceRoot) || !statSync(sourceRoot).isDirectory()) {
    throw new Error(`Private asset source is not a directory: ${sourceRoot}`);
  }
  safeOutput(sourceRoot, outputRoot);
  const bundleName = name || basename(sourceRoot);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(bundleName)) {
    throw new Error(`Bundle name must be filename-safe: ${bundleName}`);
  }

  const files = listFiles(sourceRoot);
  if (!files.length) throw new Error(`Private asset source is empty: ${sourceRoot}`);
  const entries = files.map(prepareEntry);
  const bins = partitionEntries(entries, maxArchiveBytes);
  const digits = Math.max(2, String(bins.length).length);
  const archives = bins.map((bin, index) => {
    const ordinal = String(index + 1).padStart(digits, '0');
    const total = String(bins.length).padStart(digits, '0');
    const file = `${bundleName}.part-${ordinal}-of-${total}.zip`;
    const data = makeZip(bin.entries);
    if (data.length >= maxArchiveBytes) throw new Error(`${file} unexpectedly exceeds the archive ceiling.`);
    return { file, data, entries: bin.entries };
  });

  if (existsSync(outputRoot)) {
    if (!force) throw new Error(`Bundle output already exists (pass --force to replace it): ${outputRoot}`);
    rmSync(outputRoot, { recursive: true, force: true });
  }
  mkdirSync(outputRoot, { recursive: true });

  const fileIndex = [];
  const volumeIndex = [];
  for (const archive of archives) {
    writeFileSync(resolve(outputRoot, archive.file), archive.data);
    volumeIndex.push({
      file: archive.file,
      bytes: archive.data.length,
      sha256: sha256(archive.data),
      files: archive.entries.map((entry) => entry.path),
    });
    for (const entry of archive.entries) {
      fileIndex.push({
        path: entry.path,
        bytes: entry.bytes,
        sha256: entry.sha256,
        volume: archive.file,
      });
    }
  }
  fileIndex.sort((a, b) => compareText(a.path, b.path));
  const index = {
    schemaVersion: 1,
    bundle: bundleName,
    format: 'zip-volumes',
    exclusiveArchiveByteLimit: maxArchiveBytes,
    volumes: volumeIndex,
    files: fileIndex,
  };
  const indexFile = `${bundleName}.index.json`;
  writeFileSync(resolve(outputRoot, indexFile), `${JSON.stringify(index, null, 2)}\n`);
  return { ...index, indexFile, output: outputRoot };
}

function usage() {
  return `Usage:
  node tools/bundle-private-assets.mjs --source <dir> --out <dir> [options]

Options:
  --name <name>       Archive basename (default: source directory name)
  --max-mb <number>   Exclusive decimal-MB ceiling (default: 24)
  --max-bytes <bytes> Exclusive byte ceiling; overrides --max-mb
  --force             Replace an existing output directory
  --help              Show this help
`;
}

function parseArgs(argv) {
  const options = {};
  const values = new Set(['source', 'out', 'name', 'max-mb', 'max-bytes']);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help') return { help: true };
    if (arg === '--force') { options.force = true; continue; }
    if (!arg.startsWith('--')) throw new Error(`Unknown argument: ${arg}`);
    const [rawKey, inline] = arg.slice(2).split(/=(.*)/s, 2);
    if (!values.has(rawKey)) throw new Error(`Unknown option: --${rawKey}`);
    const value = inline ?? argv[++i];
    if (value === undefined || value.startsWith('--')) throw new Error(`--${rawKey} needs a value.`);
    options[rawKey] = value;
  }
  const mb = options['max-mb'] === undefined ? 24 : Number(options['max-mb']);
  const maxBytes = options['max-bytes'] === undefined
    ? Math.floor(mb * 1_000_000)
    : Number(options['max-bytes']);
  return {
    source: options.source,
    output: options.out,
    name: options.name,
    maxArchiveBytes: maxBytes,
    force: options.force || false,
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) process.stdout.write(usage());
    else {
      const result = bundleAssets(options);
      for (const volume of result.volumes) {
        console.log(`${volume.file}: ${volume.bytes} bytes, ${volume.files.length} file(s)`);
      }
      console.log(`${result.indexFile}: ${result.files.length} source file(s), ${result.volumes.length} volume(s)`);
    }
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exitCode = 1;
  }
}
