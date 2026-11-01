// Save files on disk for the desktop build. One file per slot:
//   line 1  metadata JSON (id, name, savedAt, campaignId, week, bossName, format)
//   rest    the world JSON exactly as the game serialised it
// Writes go to a temporary file, are flushed to disk, then renamed over the
// slot; the previous version is kept as .bak and read if the slot is damaged.
// Writes to one slot run one at a time (two quick saves shared a temporary
// file and could interleave), and the metadata records the world's length so
// a damaged world is recognised and its backup used.
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_BYTES = 256 * 1024 * 1024;

function fileFor(dir, id) {
  return path.join(dir, crypto.createHash('sha256').update(id, 'utf8').digest('hex') + '.ogsave');
}

async function retry(fn) {
  // Windows virus scanners and indexers briefly lock freshly written files.
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(e && e.code)) throw e;
      await new Promise(r => setTimeout(r, 50 * (i + 1)));
    }
  }
}

function checkId(id) {
  if (typeof id !== 'string' || !id || id.length > 200) throw new Error('Invalid save name.');
}

// One write at a time per slot, in the order asked for.
const queues = new Map();
function serial(key, fn) {
  const next = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(fn);
  queues.set(key, next);
  const done = () => { if (queues.get(key) === next) queues.delete(key); };
  next.then(done, done);
  return next;
}
let tmpCounter = 0;

async function writeSlot(dir, meta, worldJson) {
  if (!meta || typeof meta !== 'object') throw new Error('Invalid save metadata.');
  checkId(meta.id);
  if (typeof worldJson !== 'string' || worldJson.length > MAX_BYTES) throw new Error('Invalid save data.');
  const file = fileFor(dir, meta.id);
  return serial(file, async () => {
    await fs.mkdir(dir, { recursive: true });
    const tmp = `${file}.tmp-${process.pid}-${++tmpCounter}`;
    const handle = await fs.open(tmp, 'w');
    try {
      await handle.writeFile(JSON.stringify({ ...meta, format: 2, worldLength: worldJson.length,
        worldBytes: Buffer.byteLength(worldJson, 'utf8') }) + '\n', 'utf8');
      await handle.writeFile(worldJson, 'utf8');
      await handle.sync();
    } finally { await handle.close(); }
    // The slot being replaced becomes the backup, unless it is itself damaged:
    // a bad save must never overwrite the only good copy.
    let current = null;
    try { current = await retry(() => fs.readFile(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (current != null) {
      let sound = true;
      try { parseFile(current); } catch { sound = false; }
      if (sound) await retry(() => fs.writeFile(file + '.bak', current, 'utf8'));
    }
    await retry(() => fs.rename(tmp, file));
  });
}

function parseFile(text) {
  const cut = text.indexOf('\n');
  if (cut < 0) throw new Error('This save is damaged.');
  const meta = JSON.parse(text.slice(0, cut));
  const worldJson = text.slice(cut + 1);
  // Saves since 1.0.3 record the world's length; older ones end in '}'. A torn
  // or interleaved write fails the check and the .bak is used instead.
  if (typeof meta.worldLength === 'number' ? worldJson.length !== meta.worldLength : !worldJson.trimEnd().endsWith('}'))
    throw new Error('This save is incomplete.');
  return { ...meta, worldJson };
}

async function readSlotFile(file) {
  // A file a virus scanner holds for a moment is read again, not passed over
  // for the older backup.
  try { return parseFile(await retry(() => fs.readFile(file, 'utf8'))); } catch (e) {
    try { return parseFile(await retry(() => fs.readFile(file + '.bak', 'utf8'))); } catch { /* fall through */ }
    return { id: 'file:' + path.basename(file, '.ogsave'), name: 'Unreadable save', savedAt: 0, week: 0, bossName: 'Unknown',
      format: 2, worldJson: '', unreadable: e instanceof Error ? e.message : 'This save is damaged.' };
  }
}

/**
 * The first line of a slot file, and whether the file is the size it says
 * (a torn or interleaved write is not). Only the header is read: the save
 * list no longer reads, sends and parses every city to show its name.
 */
async function readHeader(file) {
  const handle = await retry(() => fs.open(file, 'r'));
  try {
    const { size } = await handle.stat();
    const chunk = Buffer.alloc(Math.min(size, 64 * 1024));
    const { bytesRead } = await handle.read(chunk, 0, chunk.length, 0);
    const cut = chunk.subarray(0, bytesRead).indexOf(10);
    if (cut < 0) throw new Error('This save is damaged.');
    const meta = JSON.parse(chunk.subarray(0, cut).toString('utf8'));
    if (typeof meta.worldBytes === 'number' ? size !== cut + 1 + meta.worldBytes : false) throw new Error('This save is incomplete.');
    return meta;
  } finally { await handle.close(); }
}

async function readSlotHeader(file) {
  try { return { ...await readHeader(file), lazy: true }; } catch (e) {
    try { return { ...await readHeader(file + '.bak'), lazy: true, fromBackup: true }; } catch { /* fall through */ }
    return { id: 'file:' + path.basename(file, '.ogsave'), name: 'Unreadable save', savedAt: 0, week: 0, bossName: 'Unknown',
      format: 2, unreadable: e instanceof Error ? e.message : 'This save is damaged.' };
  }
}

/** Every slot's header, for the save list (the world is read with readSlot). */
async function listHeaders(dir) {
  let names;
  try { names = await fs.readdir(dir); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  const out = [];
  for (const name of names) if (name.endsWith('.ogsave')) out.push(await readSlotHeader(path.join(dir, name)));
  for (const name of names) {
    if (!name.endsWith('.ogsave.bak') || names.includes(name.slice(0, -4))) continue;
    out.push(await readSlotHeader(path.join(dir, name.slice(0, -4))));
  }
  return out;
}

/** One slot in full, for loading (its backup if the slot itself is damaged). */
async function readSlot(dir, id) {
  checkId(id);
  return readSlotFile(fileFor(dir, id));
}

async function listSlots(dir) {
  let names;
  try { names = await fs.readdir(dir); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  const out = [];
  for (const name of names) if (name.endsWith('.ogsave')) out.push(await readSlotFile(path.join(dir, name)));
  // A slot whose main file is missing but whose backup survives.
  for (const name of names) {
    if (!name.endsWith('.ogsave.bak') || names.includes(name.slice(0, -4))) continue;
    out.push(await readSlotFile(path.join(dir, name.slice(0, -4))));
  }
  return out;
}

async function removeSlot(dir, id) {
  checkId(id);
  // Unreadable slots are listed as file:<hash>, since their name is lost.
  const hashed = /^file:([0-9a-f]{64})$/.exec(id);
  const file = hashed ? path.join(dir, hashed[1] + '.ogsave') : fileFor(dir, id);
  return serial(file, async () => {
    const stray = (await fs.readdir(dir).catch(() => [])).filter(n => n.startsWith(path.basename(file) + '.tmp'));
    for (const f of [file, file + '.bak', ...stray.map(n => path.join(dir, n))]) {
      try { await retry(() => fs.unlink(f)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
  });
}

module.exports = { writeSlot, listSlots, listHeaders, readSlot, removeSlot, fileFor };
