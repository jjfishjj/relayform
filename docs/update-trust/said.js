// VerifyFirst · Update Trust — browser-side KERI/ACDC structural verifier.
// Pure ES module, no dependencies. Everything here is deterministic and testable in Node.
//
// What it does (and what it does NOT do — see README section in index.html):
//   • BLAKE3-256 (reference algorithm, hash mode) → CESR "E" digests → ACDC/KERI SAID recomputation
//   • CESR stream parsing (JSON bodies + controller signature attachments)
//   • Ed25519 KEL signature verification via WebCrypto (when the runtime supports it)
//   • ACDC edge chaining (I2I operator), schema SAID pinning, TEL issuance + KEL anchoring checks
//   • Synthetic Agent Delegation ACDC (PROPOSED schema, not GLEIF official) chained to a real ECR credential
//
// It does NOT verify witness receipts, watcher/duplicity state, live key state via OOBI, or the
// production GLEIF root of trust policy — those are delegated to the keripy vLEI verifier backend.

/* ------------------------------------------------------------------ BLAKE3 */
const IV = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
const MSG_PERMUTATION = [2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8];
const CHUNK_START = 1, CHUNK_END = 2, PARENT = 4, ROOT = 8;
const BLOCK_LEN = 64, CHUNK_LEN = 1024;

const rotr = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;

function g(s, a, b, c, d, mx, my) {
  s[a] = (s[a] + s[b] + mx) >>> 0; s[d] = rotr(s[d] ^ s[a], 16);
  s[c] = (s[c] + s[d]) >>> 0; s[b] = rotr(s[b] ^ s[c], 12);
  s[a] = (s[a] + s[b] + my) >>> 0; s[d] = rotr(s[d] ^ s[a], 8);
  s[c] = (s[c] + s[d]) >>> 0; s[b] = rotr(s[b] ^ s[c], 7);
}

function round(s, m) {
  g(s, 0, 4, 8, 12, m[0], m[1]); g(s, 1, 5, 9, 13, m[2], m[3]);
  g(s, 2, 6, 10, 14, m[4], m[5]); g(s, 3, 7, 11, 15, m[6], m[7]);
  g(s, 0, 5, 10, 15, m[8], m[9]); g(s, 1, 6, 11, 12, m[10], m[11]);
  g(s, 2, 7, 8, 13, m[12], m[13]); g(s, 3, 4, 9, 14, m[14], m[15]);
}

function compress(cv, blockWords, counter, blockLen, flags) {
  const s = new Uint32Array(16);
  s.set(cv.subarray(0, 8), 0); s.set(IV.subarray(0, 4), 8);
  s[12] = Number(counter & 0xffffffffn) >>> 0; s[13] = Number((counter >> 32n) & 0xffffffffn) >>> 0;
  s[14] = blockLen; s[15] = flags;
  let m = Uint32Array.from(blockWords);
  for (let r = 0; r < 7; r++) {
    round(s, m);
    if (r < 6) { const p = new Uint32Array(16); for (let i = 0; i < 16; i++) p[i] = m[MSG_PERMUTATION[i]]; m = p; }
  }
  for (let i = 0; i < 8; i++) { s[i] = (s[i] ^ s[i + 8]) >>> 0; s[i + 8] = (s[i + 8] ^ cv[i]) >>> 0; }
  return s;
}

function wordsFromBlock(block) {
  const w = new Uint32Array(16);
  for (let i = 0; i < 16; i++) w[i] = (block[i * 4] | (block[i * 4 + 1] << 8) | (block[i * 4 + 2] << 16) | (block[i * 4 + 3] << 24)) >>> 0;
  return w;
}

class Output {
  constructor(cv, blockWords, counter, blockLen, flags) { Object.assign(this, { cv, blockWords, counter, blockLen, flags }); }
  chainingValue() { return compress(this.cv, this.blockWords, this.counter, this.blockLen, this.flags).slice(0, 8); }
  rootBytes(outLen = 32) {
    const out = new Uint8Array(outLen); let offset = 0, counter = 0n;
    while (offset < outLen) {
      const words = compress(this.cv, this.blockWords, counter, this.blockLen, this.flags | ROOT);
      for (let i = 0; i < 16 && offset < outLen; i++) for (let b = 0; b < 4 && offset < outLen; b++) out[offset++] = (words[i] >>> (8 * b)) & 0xff;
      counter += 1n;
    }
    return out;
  }
}

class ChunkState {
  constructor(key, chunkCounter, flags) { this.cv = Uint32Array.from(key); this.chunkCounter = chunkCounter; this.block = new Uint8Array(BLOCK_LEN); this.blockLen = 0; this.blocksCompressed = 0; this.flags = flags; }
  len() { return BLOCK_LEN * this.blocksCompressed + this.blockLen; }
  startFlag() { return this.blocksCompressed === 0 ? CHUNK_START : 0; }
  update(input) {
    let i = 0;
    while (i < input.length) {
      if (this.blockLen === BLOCK_LEN) {
        this.cv = compress(this.cv, wordsFromBlock(this.block), this.chunkCounter, BLOCK_LEN, this.flags | this.startFlag()).slice(0, 8);
        this.blocksCompressed++; this.block.fill(0); this.blockLen = 0;
      }
      const take = Math.min(BLOCK_LEN - this.blockLen, input.length - i);
      this.block.set(input.subarray(i, i + take), this.blockLen); this.blockLen += take; i += take;
    }
  }
  output() { return new Output(this.cv, wordsFromBlock(this.block), this.chunkCounter, this.blockLen, this.flags | this.startFlag() | CHUNK_END); }
}

function parentOutput(left, right, key, flags) {
  const words = new Uint32Array(16); words.set(left, 0); words.set(right, 8);
  return new Output(Uint32Array.from(key), words, 0n, BLOCK_LEN, flags | PARENT);
}

export function blake3(input, outLen = 32) {
  const key = IV, flags = 0, stack = [];
  let chunk = new ChunkState(key, 0n, flags), i = 0;
  while (i < input.length) {
    if (chunk.len() === CHUNK_LEN) {
      let cv = chunk.output().chainingValue(), total = chunk.chunkCounter + 1n;
      let t = total; while ((t & 1n) === 0n) { cv = parentOutput(stack.pop(), cv, key, flags).chainingValue(); t >>= 1n; }
      stack.push(cv); chunk = new ChunkState(key, total, flags);
    }
    const take = Math.min(CHUNK_LEN - chunk.len(), input.length - i);
    chunk.update(input.subarray(i, i + take)); i += take;
  }
  let output = chunk.output();
  for (let n = stack.length - 1; n >= 0; n--) output = parentOutput(stack[n], output.chainingValue(), key, flags);
  return output.rootBytes(outLen);
}

/* -------------------------------------------------------------------- CESR */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_INDEX = Object.fromEntries([...B64].map((c, i) => [c, i]));

export function b64urlEncode(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return out.replace(/=+$/, '');
}

export function b64urlDecode(text) {
  const clean = text.replace(/=+$/, ''), out = [];
  let bits = 0, value = 0;
  for (const ch of clean) {
    if (!(ch in B64_INDEX)) throw new Error(`INVALID_BASE64URL · ${ch}`);
    value = (value << 6) | B64_INDEX[ch]; bits += 6;
    if (bits >= 8) { bits -= 8; out.push((value >> bits) & 0xff); }
  }
  return Uint8Array.from(out);
}

// One-character CESR codes used by the vLEI ecosystem (raw size in bytes, qb64 length).
export const CESR_CODES = {
  A: { name: 'Ed25519 seed', raw: 32, qb64: 44 },
  B: { name: 'Ed25519 non-transferable prefix', raw: 32, qb64: 44 },
  D: { name: 'Ed25519 public key', raw: 32, qb64: 44 },
  E: { name: 'Blake3-256 digest', raw: 32, qb64: 44 },
  F: { name: 'Blake2b-256 digest', raw: 32, qb64: 44 },
  H: { name: 'SHA3-256 digest', raw: 32, qb64: 44 },
  I: { name: 'SHA2-256 digest', raw: 32, qb64: 44 },
  '0B': { name: 'Ed25519 signature', raw: 64, qb64: 88 },
};

export function cesrEncode(code, raw) {
  const ps = code.length % 4 === 0 ? (3 - (raw.length % 3)) % 3 : code.length;
  const padded = new Uint8Array(ps + raw.length); padded.set(raw, ps);
  return code + b64urlEncode(padded).slice(code.length);
}

export function cesrDecode(qb64) {
  const code = qb64[0] === '0' ? qb64.slice(0, 2) : qb64[0];
  const spec = CESR_CODES[code];
  if (!spec) throw new Error(`UNSUPPORTED_CESR_CODE · ${code}`);
  if (qb64.length !== spec.qb64) throw new Error(`INVALID_CESR_LENGTH · ${code} expects ${spec.qb64}`);
  const bytes = b64urlDecode('A'.repeat(code.length) + qb64.slice(code.length));
  return { code, name: spec.name, raw: bytes.slice(code.length) };
}

// Indexed Ed25519 signature: code "A" + 1 index char + 86 chars (2 lead pad bytes)
export function decodeIndexedSig(qb64) {
  if (qb64.length !== 88 || qb64[0] !== 'A') throw new Error('UNSUPPORTED_INDEXED_SIG');
  const index = B64_INDEX[qb64[1]];
  const bytes = b64urlDecode('AA' + qb64.slice(2));
  return { index, raw: bytes.slice(2) };
}

export const blake3Digest = bytes => cesrEncode('E', blake3(bytes, 32));

/* --------------------------------------------------------------------- SAID */
const encoder = new TextEncoder();
export const DUMMY = '#'.repeat(44);
export const serialize = obj => encoder.encode(JSON.stringify(obj));

export function versionString(proto, kind, size) {
  return `${proto}10${kind}${size.toString(16).padStart(6, '0')}_`;
}

export function parseVersion(v) {
  const m = /^([A-Z]{4})(\d)(\d)(JSON|CBOR|MGPK)([0-9a-f]{6})_$/.exec(v || '');
  if (!m) return null;
  return { proto: m[1], major: +m[2], minor: +m[3], kind: m[4], size: parseInt(m[5], 16) };
}

// Compute the SAID of a KERI/ACDC map. `labels` are the fields that hold the self-address
// (icp/dip/vcp use ['d','i']; everything else ['d']). Returns the saidified copy too.
export function saidify(obj, labels = ['d']) {
  const copy = { ...obj };
  for (const l of labels) copy[l] = DUMMY;
  if (typeof copy.v === 'string') {
    const ver = parseVersion(copy.v);
    if (!ver) throw new Error('INVALID_VERSION_STRING');
    copy.v = versionString(ver.proto, ver.kind, serialize(copy).length);
  }
  const raw = serialize(copy), said = blake3Digest(raw);
  for (const l of labels) copy[l] = said;
  return { said, obj: copy, raw: serialize(copy), size: raw.length };
}

export function verifySaid(obj, labels = ['d']) {
  const expected = obj?.[labels[0]];
  if (typeof expected !== 'string' || expected.length !== 44) return { ok: false, expected, computed: null, reason: 'NO_SAID' };
  const { said } = saidify(obj, labels);
  return { ok: said === expected, expected, computed: said, reason: said === expected ? 'SAID_MATCH' : 'SAID_MISMATCH' };
}

export const SAID_LABELS = { icp: ['d', 'i'], dip: ['d', 'i'], vcp: ['d', 'i'] };
export const saidLabelsFor = ked => SAID_LABELS[ked.t] || ['d'];

/* ------------------------------------------------------------- CESR STREAM */
// Splits a CESR text stream into JSON messages + the attachment text that follows each.
export function parseCesrStream(text) {
  const messages = []; let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf('{', cursor);
    if (start < 0) break;
    let depth = 0, inString = false, escaped = false, end = -1;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') inString = false; continue; }
      if (ch === '"') { inString = true; continue; }
      if (ch === '{') depth++;
      if (ch === '}' && --depth === 0) { end = i + 1; break; }
    }
    if (end < 0) break;
    const next = text.indexOf('{', end);
    const attachment = text.slice(end, next < 0 ? text.length : next).trim();
    try {
      const ked = JSON.parse(text.slice(start, end));
      messages.push({ ked, attachment, sigs: parseControllerSigs(attachment) });
    } catch (error) {
      // Never drop a message silently: a corrupted TEL event must surface as a verification failure.
      messages.push({ ked: null, error: `JSON_PARSE_ERROR · ${String(error?.message || error).slice(0, 80)}`, raw: text.slice(start, Math.min(end, start + 200)), attachment, sigs: [] });
    }
    cursor = end;
  }
  return messages;
}

// Extracts the controller indexed signature group "-AA<count>" followed by 88-char indexed sigs.
export function parseControllerSigs(attachment) {
  const m = /-AA([A-Za-z0-9_-])/.exec(attachment || '');
  if (!m) return [];
  const count = B64_INDEX[m[1]], sigs = []; let pos = m.index + 4;
  for (let i = 0; i < count; i++) { sigs.push(attachment.slice(pos, pos + 88)); pos += 88; }
  return sigs.filter(s => s.length === 88);
}

/* ---------------------------------------------------------------- ED25519 */
export async function verifyEd25519(pubQb64, sigQb64Indexed, messageBytes) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return { ok: false, reason: 'WEBCRYPTO_UNAVAILABLE' };
  try {
    const pub = cesrDecode(pubQb64), sig = decodeIndexedSig(sigQb64Indexed);
    if (pub.code !== 'D') return { ok: false, reason: `UNSUPPORTED_KEY_CODE_${pub.code}` };
    const key = await subtle.importKey('raw', pub.raw, { name: 'Ed25519' }, false, ['verify']);
    const ok = await subtle.verify({ name: 'Ed25519' }, key, sig.raw, messageBytes);
    return { ok, reason: ok ? 'SIGNATURE_VALID' : 'SIGNATURE_INVALID', index: sig.index };
  } catch (error) {
    const msg = String(error?.message || error);
    return { ok: false, reason: /Ed25519|algorithm|not supported|Unrecognized/i.test(msg) ? 'ED25519_UNSUPPORTED_IN_RUNTIME' : `SIGNATURE_ERROR · ${msg}` };
  }
}

/* ------------------------------------------------------------- vLEI SCHEMA */
// Official schema SAIDs published in https://github.com/GLEIF-IT/vLEI-schema (main).
export const VLEI_SCHEMAS = {
  EBfdlu8R27Fbx: { said: 'EBfdlu8R27Fbx-ehrqwImnK-8Cm79sqbAQ4MmvEAYqao', key: 'QVI', title: 'Qualified vLEI Issuer Credential', file: 'qualified-vLEI-issuer-vLEI-credential.json', issuer: 'GLEIF', issuee: 'QVI', edges: {} },
  ENPXp1vQzRF6J: { said: 'ENPXp1vQzRF6JwIuS-mp2U8Uf1MoADoP_GqQ62VsDZWY', key: 'LE', title: 'Legal Entity vLEI Credential', file: 'legal-entity-vLEI-credential.json', issuer: 'QVI', issuee: 'Legal Entity', edges: { qvi: 'EBfdlu8R27Fbx-ehrqwImnK-8Cm79sqbAQ4MmvEAYqao' } },
  EKA57bKBKxr_k: { said: 'EKA57bKBKxr_kN7iN5i7lMUxpMG-s19dRcmov1iDxz-E', key: 'OOR_AUTH', title: 'OOR Authorization vLEI Credential', file: 'oor-authorization-vlei-credential.json', issuer: 'Legal Entity', issuee: 'QVI', edges: { le: 'ENPXp1vQzRF6JwIuS-mp2U8Uf1MoADoP_GqQ62VsDZWY' } },
  EBNaNu_M9P5cg: { said: 'EBNaNu-M9P5cgrnfl2Fvymy4E_jvxxyjb70PRtiANlJy', key: 'OOR', title: 'Legal Entity Official Organizational Role vLEI Credential', file: 'legal-entity-official-organizational-role-vLEI-credential.json', issuer: 'QVI', issuee: 'Person (OOR)', edges: { auth: 'EKA57bKBKxr_kN7iN5i7lMUxpMG-s19dRcmov1iDxz-E' } },
  EH6ekLjSr8V32: { said: 'EH6ekLjSr8V32WyFbGe1zXjTzFs9PkTYmupJ9H65O14g', key: 'ECR_AUTH', title: 'ECR Authorization vLEI Credential', file: 'ecr-authorization-vlei-credential.json', issuer: 'Legal Entity', issuee: 'QVI', edges: { le: 'ENPXp1vQzRF6JwIuS-mp2U8Uf1MoADoP_GqQ62VsDZWY' } },
  EEy9PkikFcANV: { said: 'EEy9PkikFcANV1l7EHukCeXqrzT1hNZjGlUk7wuMO5jw', key: 'ECR', title: 'Legal Entity Engagement Context Role vLEI Credential', file: 'legal-entity-engagement-context-role-vLEI-credential.json', issuer: 'QVI or Legal Entity', issuee: 'Person (ECR)', edges: { auth: 'EH6ekLjSr8V32WyFbGe1zXjTzFs9PkTYmupJ9H65O14g', le: 'ENPXp1vQzRF6JwIuS-mp2U8Uf1MoADoP_GqQ62VsDZWY' } },
};
export const schemaBySaid = said => Object.values(VLEI_SCHEMAS).find(s => s.said === said) || null;

/* ----------------------------------------------------- AGENT DELEGATION */
// PROPOSED (non-GLEIF) schema: an ACDC issued by a vLEI role holder (ECR/OOR person) to an AI agent AID.
// The edge `role` chains to the holder's official vLEI role credential with the I2I operator, so the
// delegation is only valid if the issuer of this ACDC is the issuee of a valid ECR/OOR credential.
export const AGENT_DELEGATION_SCHEMA = saidify({
  $id: DUMMY,
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'Agent Delegation Credential (VerifyFirst proposal · NOT a GLEIF vLEI schema)',
  description: 'Short-lived, single-purpose mandate issued by a vLEI ECR/OOR holder to an AI agent AID; chained I2I to the official vLEI role credential; revocable through a TEL registry controlled by the issuer.',
  version: '0.3.0',
  type: 'object',
  properties: {
    v: { type: 'string' }, d: { type: 'string' }, i: { description: 'Issuer AID — must be the issuee of the chained vLEI role credential', type: 'string' }, ri: { type: 'string' }, s: { type: 'string' },
    a: { type: 'object', properties: { d: { type: 'string' }, i: { description: 'Agent AID (issuee)', type: 'string' }, dt: { type: 'string', format: 'date-time' }, LEI: { type: 'string', format: 'ISO 17442' }, agentAID: { type: 'string' }, principalRole: { type: 'string' }, principalCredential: { type: 'string' }, purpose: { type: 'string' }, scope: { type: 'object', properties: { allow: { type: 'array' }, deny: { type: 'array' }, confirm: { type: 'array' } } }, expires: { type: 'string', format: 'date-time' }, ttlMinutes: { type: 'integer' }, disclosure: { type: 'string' } }, required: ['i', 'dt', 'LEI', 'agentAID', 'principalRole', 'purpose', 'scope', 'expires'] },
    e: { type: 'object', properties: { d: { type: 'string' }, role: { type: 'object', properties: { n: { type: 'string' }, s: { type: 'string' }, o: { type: 'string', const: 'I2I' } }, required: ['n', 's', 'o'] } }, required: ['d', 'role'] },
    r: { type: 'object' },
  },
  required: ['v', 'd', 'i', 'ri', 's', 'a', 'e', 'r'],
}, ['$id']).obj;
export const isProposedSchema = said => said === AGENT_DELEGATION_SCHEMA.$id;

export function buildAgentDelegation({ roleCredential, agentAid, registry, purpose, scope, expires, dt, ttlMinutes = 10 }) {
  const attrs = {
    d: DUMMY,
    i: agentAid,
    dt,
    LEI: roleCredential.a.LEI,
    agentAID: agentAid,
    principalRole: roleCredential.a.engagementContextRole || roleCredential.a.officialRole,
    principalCredential: roleCredential.d,
    purpose,
    scope: { allow: scope.allow, deny: scope.deny, confirm: scope.confirm || [] },
    expires,
    ttlMinutes,
    disclosure: 'MINIMUM_NECESSARY',
  };
  const edges = { d: DUMMY, role: { n: roleCredential.d, s: roleCredential.s, o: 'I2I' } };
  const rules = {
    d: DUMMY,
    proposalDisclaimer: { l: 'This Agent Delegation Credential is a VerifyFirst hackathon proposal. It is not defined by the GLEIF vLEI Ecosystem Governance Framework and does not assert GLEIF, QVI or Legal Entity endorsement.' },
    accountability: { l: 'The natural person holding the chained vLEI role credential remains accountable for every action the agent performs within scope.' },
  };
  const a = saidify(attrs).obj, e = saidify(edges).obj, r = saidify(rules).obj;
  const acdc = { v: versionString('ACDC', 'JSON', 0), d: DUMMY, i: roleCredential.a.i, ri: registry, s: AGENT_DELEGATION_SCHEMA.$id, a, e, r };
  return saidify(acdc).obj;
}

/* ------------------------------------------------------------ CHAIN WALK */
export const ROOT_OF_TRUST = {
  fixture: { label: 'TEST ROOT · keripy regression fixture', aid: 'EHOuGiHMxJShXHgSb6k_9pqxmRb8H-LT0R2hQouHp8pW' },
  production: { label: 'PRODUCTION · GLEIF External (vlei-verifier README default)', aid: 'EINmHd5g7iV-UldkkkKyBIH052bIyxZNBn9pq-zNrYoS' },
};

function summarizeAcdc(ked) {
  const schema = schemaBySaid(ked.s);
  return { said: ked.d, schema: ked.s, schemaKey: schema?.key || (isProposedSchema(ked.s) ? 'AGENT_DELEGATION' : 'UNKNOWN'), schemaTitle: schema?.title || ked.s, issuer: ked.i, issuee: ked.a?.i, lei: ked.a?.LEI, registry: ked.ri, edges: ked.e && typeof ked.e === 'object' ? Object.fromEntries(Object.entries(ked.e).filter(([k]) => k !== 'd')) : {} };
}

/**
 * @typedef {{ ked: any, attachment?: string, sigs?: string[], error?: string, raw?: string }} CesrMessage
 * @typedef {{ id: string, ok: boolean, label: string, detail: string, level: string, anchored?: boolean }} Check
 * @typedef {{ ri: string, issuerAid: string, vcpSaidOk: boolean, anchored: boolean, events: number }} RegistryInfo
 * @typedef {{ checks: Check[], credentials: any[], aids: Record<string, any>, registries: Record<string, RegistryInfo>, decision: any, signaturesUnverifiable?: boolean }} ChainReport
 * @typedef {{ rootAid?: string|null, extraAcdcs?: any[], revoked?: Set<string>, now?: Date|null, verifySignatures?: boolean, leafSaid?: string|null, unanchoredOk?: Set<string> }} ChainOptions
 */
// Verifies a parsed CESR stream (plus optional extra ACDCs such as an agent delegation) and returns
// a machine-readable report. Options let the UI simulate TEL revocations / expiry / tampering.
// `now` defaults to the real clock (expiry is never skipped); `leafSaid` names the credential that MUST be the leaf.
/** @param {CesrMessage[]} messages @param {ChainOptions} [options] @returns {Promise<ChainReport>} */
export async function verifyChain(messages, options = {}) {
  const { rootAid = null, extraAcdcs = [], revoked = new Set(), now = new Date(), verifySignatures = true, leafSaid = null, unanchoredOk = new Set() } = options;
  const corrupt = messages.filter(m => !m.ked);
  const events = messages.filter(m => m.ked).map(m => m.ked);
  /** @type {ChainReport} */
  const report = { checks: [], credentials: [], aids: {}, registries: {}, decision: null };
  const push = (id, ok, label, detail, level = 'BROWSER') => report.checks.push({ id, ok, label, detail, level });
  push('parse', corrupt.length === 0, corrupt.length ? `CESR stream · ${corrupt.length} message(s) failed to parse` : `CESR stream · ${events.length} messages parsed`, corrupt.length ? corrupt.map(c => c.error).join(' · ') : 'Brace-balanced JSON bodies with CESR attachments; nothing is dropped silently.');
  const kels = {}, tels = {}, acdcs = [];
  for (const ked of events) {
    if (ked.v?.startsWith('ACDC')) { acdcs.push(ked); continue; }
    if (['icp', 'dip', 'rot', 'ixn'].includes(ked.t)) (kels[ked.i] ||= []).push(ked);
    if (['vcp', 'iss', 'rev', 'bis', 'brv'].includes(ked.t)) (tels[ked.t === 'vcp' ? ked.i : ked.ri] ||= []).push(ked);
  }
  for (const extra of extraAcdcs) acdcs.push(extra);

  // 1. SAID integrity for every message (dedupe repeated KEL copies in the stream)
  const seen = new Set(); let saidOk = 0, saidTotal = 0;
  messages = messages.filter(m => m.ked);
  for (const ked of events) {
    const key = `${ked.t || 'acdc'}:${ked.d}`; if (seen.has(key)) continue; seen.add(key); saidTotal++;
    const r = verifySaid(ked, saidLabelsFor(ked)); if (r.ok) saidOk++;
    if (!r.ok) push(`said:${ked.d}`, false, `SAID mismatch · ${ked.t || 'ACDC'}`, `expected ${r.expected} computed ${r.computed}`);
  }
  push('said', saidOk === saidTotal, `BLAKE3 SAID · ${saidOk}/${saidTotal} messages self-addressing`, 'Every KEL event, TEL event and ACDC digest recomputed in the browser (CESR code E = Blake3-256).');

  // 2. Nested SAIDs of ACDC blocks
  let nestedOk = 0, nestedTotal = 0;
  for (const acdc of acdcs) for (const k of ['a', 'e']) if (acdc[k] && typeof acdc[k] === 'object' && acdc[k].d) { nestedTotal++; if (verifySaid(acdc[k]).ok) nestedOk++; }
  push('nested', nestedOk === nestedTotal, `ACDC attribute／edge block SAIDs · ${nestedOk}/${nestedTotal}`, 'a.d and e.d recomputed; the rules block (r.d) is a schema constant and is not recomputed.');

  // 3. AID self-certification + KEL signatures
  for (const [aid, kel] of Object.entries(kels)) {
    const icp = kel.find(e => e.t === 'icp' || e.t === 'dip');
    const info = { aid, events: kel.length, icpSaidOk: false, keys: icp?.k || [], sigs: [], anchors: [] };
    if (icp) {
      info.icpSaidOk = verifySaid(icp, ['d', 'i']).ok && icp.i === aid;
      if (verifySignatures) {
        // Key-state aware: each event is verified with the keys established by the latest icp/dip/rot at or before it.
        const uniq = new Map(); for (const m of messages) if (m.ked.i === aid && ['icp', 'dip', 'ixn', 'rot'].includes(m.ked.t)) uniq.set(m.ked.d, m);
        const ordered = [...uniq.values()].sort((a, b) => parseInt(a.ked.s, 16) - parseInt(b.ked.s, 16));
        let keys = [], nextDigests = [];
        for (const m of ordered) {
          const ked = m.ked;
          if (ked.t === 'icp' || ked.t === 'dip') { keys = ked.k; nextDigests = ked.n || []; }
          let preRotationOk = true;
          if (ked.t === 'rot') {
            preRotationOk = nextDigests.length > 0 && blake3Digest(encoder.encode(ked.k[0])) === nextDigests[0];
            info.rotations = (info.rotations || 0) + 1; info.preRotation = preRotationOk;
            keys = ked.k; nextDigests = ked.n || [];
          }
          const raw = saidify(ked, saidLabelsFor(ked)).raw;
          // Signing threshold: kt is a hex integer or a weighted array; weighted thresholds are treated conservatively (all keys).
          const threshold = Array.isArray(ked.kt) ? keys.length : Math.max(1, parseInt(ked.kt ?? '1', 16) || 1);
          const results = await Promise.all(m.sigs.map(async sigQb64 => {
            let index = 0; try { index = decodeIndexedSig(sigQb64).index; } catch { return { ok: false, reason: 'MALFORMED_SIGNATURE' }; }
            const key = keys[index];
            return key ? { index, ...(await verifyEd25519(key, sigQb64, raw)) } : { index, ok: false, reason: 'SIGNATURE_INDEX_OUT_OF_RANGE' };
          }));
          const valid = results.filter(r => r.ok).length, unsupported = results.find(r => r.reason === 'ED25519_UNSUPPORTED_IN_RUNTIME' || r.reason === 'WEBCRYPTO_UNAVAILABLE');
          const ok = preRotationOk && results.length > 0 && valid >= threshold;
          info.sigs.push({ t: ked.t, s: ked.s, d: ked.d, ok, threshold, valid, provided: results.length, reason: !preRotationOk ? 'PRE_ROTATION_VIOLATED' : results.length === 0 ? 'NO_CONTROLLER_SIGNATURE' : unsupported ? unsupported.reason : ok ? 'SIGNATURE_VALID' : `THRESHOLD_NOT_MET · ${valid}/${threshold}` });
        }
      }
      for (const e of kel) if (e.t === 'ixn') for (const seal of e.a || []) info.anchors.push({ seq: e.s, seal });
    }
    report.aids[aid] = info;
  }
  const aidList = Object.values(report.aids);
  push('aid', aidList.every(a => a.icpSaidOk), `AID 自我認證 · ${aidList.filter(a => a.icpSaidOk).length}/${aidList.length} inception events`, 'Prefix = SAID of the inception event (d = i), so an AID cannot be forged without rewriting its KEL.');
  if (verifySignatures) {
    const sigs = aidList.flatMap(a => a.sigs), okSigs = sigs.filter(s => s.ok).length, unsupported = sigs.find(s => s.reason === 'ED25519_UNSUPPORTED_IN_RUNTIME' || s.reason === 'WEBCRYPTO_UNAVAILABLE');
    const rotated = aidList.filter(a => a.rotations).length;
    report.signaturesUnverifiable = !!unsupported;
    push('sig', sigs.length > 0 && okSigs === sigs.length, unsupported ? 'Ed25519 KEL 簽章 · 此瀏覽器不支援 WebCrypto Ed25519（未驗證，非簽章錯誤）' : `Ed25519 KEL 簽章 · ${okSigs}/${sigs.length} events meet their signing threshold (kt)${rotated ? ` · ${rotated} AID rotated (pre-rotation ${aidList.every(a => !a.rotations || a.preRotation) ? 'honoured' : 'VIOLATED'})` : ''}`, unsupported ? 'Chrome 137+／Safari 17+／Firefox 130+ 可在瀏覽器驗證；否則交由後端。' : 'Every controller indexed signature in the CESR attachment is verified against keys[index] established by the latest icp／rot; valid signatures must reach kt; rot.k[0] must match the prior next-key digest.');
  }

  // 4. Registries + credential status
  for (const [ri, tel] of Object.entries(tels)) {
    const vcp = tel.find(e => e.t === 'vcp');
    report.registries[ri] = { ri, issuerAid: vcp?.ii, vcpSaidOk: vcp ? verifySaid(vcp, ['d', 'i']).ok : false, anchored: !!(vcp && report.aids[vcp.ii]?.anchors.some(a => a.seal.i === ri && a.seal.d === vcp.d)), events: tel.length };
  }

  // 5. Credentials: schema, edges, TEL status, expiry
  const bySaid = Object.fromEntries(acdcs.map(a => [a.d, a]));
  for (const acdc of acdcs) {
    const c = summarizeAcdc(acdc), checks = [];
    const schema = schemaBySaid(acdc.s), proposed = !schema && isProposedSchema(acdc.s);
    checks.push({ id: 'schema', ok: !!schema || proposed, label: schema ? `Schema SAID pinned · ${schema.key}` : proposed ? 'Schema · PROPOSED (not GLEIF)' : 'Schema SAID unknown', detail: schema ? `${schema.title} — GLEIF-IT/vLEI-schema main` : proposed ? AGENT_DELEGATION_SCHEMA.title : acdc.s });
    for (const [name, edge] of Object.entries(c.edges)) {
      const target = bySaid[edge.n];
      const requiredSchema = schema?.edges?.[name];
      const op = edge.o || 'I2I';
      const ok = !!target && (!requiredSchema || target.s === requiredSchema) && (!edge.s || target.s === edge.s) && (op !== 'I2I' || target.a?.i === acdc.i);
      checks.push({ id: `edge:${name}`, ok, label: `Edge ${name} → ${target ? (schemaBySaid(target.s)?.key || 'ACDC') : 'MISSING'} · ${op}`, detail: !target ? `edge.n ${edge.n} not present in stream` : op === 'I2I' && target.a?.i !== acdc.i ? `I2I violated: issuer ${acdc.i} ≠ target issuee ${target.a?.i}` : `issuer ${acdc.i.slice(0, 16)}… is the issuee of ${edge.n.slice(0, 16)}…; schema ${target.s === (edge.s || target.s) ? 'matches edge.s' : 'DRIFT'}`, target: edge.n });
    }
    const tel = tels[acdc.ri] || [];
    const iss = tel.find(e => e.t === 'iss' && e.i === acdc.d), rev = tel.find(e => (e.t === 'rev' || e.t === 'brv') && e.i === acdc.d);
    const registry = report.registries[acdc.ri];
    const simulatedRevoked = revoked.has(acdc.d);
    const issAnchored = !!(iss && registry && report.aids[registry.issuerAid]?.anchors.some(a => a.seal.i === acdc.d && a.seal.d === iss.d));
    const status = simulatedRevoked || rev ? 'REVOKED' : iss ? 'ISSUED' : 'UNKNOWN';
    checks.push({ id: 'tel', ok: status === 'ISSUED', anchored: issAnchored, label: `TEL status · ${status}${rev ? ` · rev ${rev.d.slice(0, 12)}…` : ''}`, detail: rev ? `rev event ${rev.d.slice(0, 16)}… supersedes iss in registry ${acdc.ri.slice(0, 16)}…` : iss ? `iss event ${iss.d.slice(0, 16)}… in registry ${acdc.ri.slice(0, 16)}…` : 'No iss event for this credential in the stream.' });
    if (iss) {
      const anchored = issAnchored && !!registry?.anchored, simulated = unanchoredOk.has(acdc.d);
      checks.push({ id: 'anchor', ok: anchored || simulated, anchored, label: anchored ? 'KEL anchoring · iss and vcp sealed in issuer KEL (ixn)' : simulated ? 'KEL anchoring · SIMULATED (not anchored; allowed by demo policy)' : 'KEL anchoring · iss／vcp NOT sealed in any KEL in this stream', detail: anchored ? `registry ${acdc.ri.slice(0, 16)}… and iss ${iss.d.slice(0, 16)}… appear as seals in ${registry?.issuerAid?.slice(0, 16)}…'s interaction events` : simulated ? 'The holder private key is not in the fixture, so the delegation registry cannot be anchored; production wallets (KERIA／Signify) anchor it.' : 'A TEL event that is not anchored in the issuer KEL is not proof of issuance.' });
    }
    if (acdc.a?.expires !== undefined) {
      const expiresAt = new Date(acdc.a.expires).getTime();
      const expired = !Number.isFinite(expiresAt) || expiresAt <= now.getTime();
      checks.push({ id: 'expiry', ok: !expired, label: !Number.isFinite(expiresAt) ? 'Expiry · unparseable a.expires (treated as expired)' : expired ? 'Expired · mandate TTL elapsed' : `Expires ${acdc.a.expires}`, detail: `ttlMinutes=${acdc.a.ttlMinutes} · short-lived single-purpose mandate · evaluated at ${now.toISOString()}` });
    }
    c.checks = checks; c.status = status; c.valid = checks.every(x => x.ok);
    report.credentials.push(c);
  }

  // 6. Root of trust + upstream validity propagation (walk from leaf to root)
  const credBySaid = Object.fromEntries(report.credentials.map(c => [c.said, c]));
  const chainValid = (c, trail = []) => {
    if (!c || trail.includes(c.said)) return false;
    if (!c.valid) return false;
    const edges = Object.values(c.edges);
    if (!edges.length) return rootAid ? c.issuer === rootAid : true;
    return edges.every(e => chainValid(credBySaid[e.n], [...trail, c.said]));
  };
  for (const c of report.credentials) c.chainValid = chainValid(c);
  const rootCred = report.credentials.find(c => !Object.keys(c.edges).length);
  push('root', !!rootCred && (!rootAid || rootCred.issuer === rootAid), rootAid ? `Root of trust · ${rootCred?.issuer === rootAid ? 'issuer of QVI credential = configured root AID' : 'ROOT MISMATCH'}` : 'Root of trust · not enforced in browser', rootCred ? `QVI credential issued by ${rootCred.issuer}` : 'No root credential found', 'POLICY');

  const leaf = leafSaid ? credBySaid[leafSaid] || null : report.credentials[report.credentials.length - 1] || null;
  const failing = leaf ? [leaf, ...report.credentials].flatMap(c => c.checks.filter(x => !x.ok).map(x => ({ cred: c.schemaKey, ...x }))) : [];
  const brokenUpstream = leaf && !leaf.chainValid ? report.credentials.find(c => !c.valid) : null;
  const failed = id => report.checks.some(x => !x.ok && x.id === id);
  const code = !leaf ? (leafSaid ? 'DENY_NO_DELEGATION' : 'DENY_NO_CREDENTIAL')
    : failed('parse') ? 'DENY_STREAM_CORRUPT'
    : leaf.chainValid && report.checks.every(x => x.ok) ? 'ALLOW_CHAIN_VERIFIED'
    : report.checks.some(x => !x.ok && (x.id === 'said' || x.id === 'nested' || x.id.startsWith('said:'))) ? 'DENY_SAID_MISMATCH'
    : failed('root') ? 'DENY_ROOT_MISMATCH'
    : failed('sig') ? (report.signaturesUnverifiable ? 'DENY_SIGNATURE_UNVERIFIABLE' : 'DENY_SIGNATURE_INVALID')
    : brokenUpstream && brokenUpstream.said !== leaf.said ? `DENY_UPSTREAM_${brokenUpstream.schemaKey}_${brokenUpstream.status === 'REVOKED' ? 'REVOKED' : 'INVALID'}`
    : failing[0]?.id === 'expiry' ? 'DENY_MANDATE_EXPIRED'
    : failing[0]?.id === 'tel' ? 'DENY_CREDENTIAL_REVOKED'
    : failing.some(f => f.id === 'anchor') ? 'DENY_TEL_NOT_ANCHORED'
    : failing.some(f => f.id.startsWith('edge')) ? 'DENY_CHAIN_BROKEN'
    : 'DENY_VERIFICATION_FAILED';
  report.decision = { code, leaf: leaf?.said || null, tool_execution: false };
  report.decision.tool_execution = report.decision.code.startsWith('ALLOW');
  return report;
}

/* --------------------------------------------------- SIMULATED TEL EVENTS */
// Builds SAID-correct (but unsigned, un-anchored) TEL events so the same verifier logic can be exercised.
export function buildRegistryInception(issuerAid, nonce) {
  return saidify({ v: versionString('KERI', 'JSON', 0), t: 'vcp', d: DUMMY, i: DUMMY, ii: issuerAid, s: '0', c: ['NB'], bt: '0', b: [], n: nonce }, ['d', 'i']).obj;
}
export function buildIssuance(credentialSaid, registry, dt) {
  return saidify({ v: versionString('KERI', 'JSON', 0), t: 'iss', d: DUMMY, i: credentialSaid, s: '0', ri: registry, dt }).obj;
}
export function buildRevocation(credentialSaid, registry, priorSaid, dt) {
  return saidify({ v: versionString('KERI', 'JSON', 0), t: 'rev', d: DUMMY, i: credentialSaid, s: '1', ri: registry, p: priorSaid, dt }).obj;
}
// KERI inception event for a freshly generated Ed25519 key pair (no witnesses) — the agent's own AID.
export function buildInception(currentKeyQb64, nextKeyQb64) {
  const nextDigest = blake3Digest(encoder.encode(nextKeyQb64));
  return saidify({ v: versionString('KERI', 'JSON', 0), t: 'icp', d: DUMMY, i: DUMMY, s: '0', kt: '1', k: [currentKeyQb64], nt: '1', n: [nextDigest], bt: '0', b: [], c: [], a: [] }, ['d', 'i']).obj;
}
export const asMessage = (ked, sigs = []) => ({ ked, attachment: sigs.length ? `-AA${B64[sigs.length]}${sigs.join('')}` : '', sigs });
export function encodeIndexedSig(rawSig, index = 0) {
  const padded = new Uint8Array(2 + rawSig.length); padded.set(rawSig, 2);
  return 'A' + B64[index] + b64urlEncode(padded).slice(2);
}

/* ------------------------------------------------- SELECTIVE DISCLOSURE */
// ACDC graduated／partial disclosure: every nested block carries its own SAID, and the SAID of a parent
// block is computed over its MOST COMPACT form (nested blocks replaced by their SAIDs). A holder can
// therefore withhold any nested block by presenting just its SAID, and the verifier still recomputes the
// parent SAID — and the credential's top-level SAID — without seeing the withheld content.
// Note: the vLEI credentials in the fixture are SAIDed by keripy over their expanded form (they do not use
// graduated disclosure); the carbon-footprint credential below is a VerifyFirst proposal using the compact rule.
const isSaidBlock = v => v && typeof v === 'object' && !Array.isArray(v) && typeof v.d === 'string' && v.d.length === 44;

/** Replace every nested SAID block with its SAID, verifying each one on the way. */
export function compactify(block, path = 'a') {
  const checks = [], compact = {};
  for (const [key, value] of Object.entries(block)) {
    if (key !== 'd' && isSaidBlock(value)) {
      const inner = compactify(value, `${path}.${key}`);
      checks.push(...inner.checks);
      const computed = saidify(inner.compact).said;
      checks.push({ path: `${path}.${key}`, ok: computed === value.d, expected: value.d, computed, disclosed: true });
      compact[key] = value.d;
    } else compact[key] = value;
  }
  return { compact, checks };
}

export const CARBON_SCHEMA = saidify({
  $id: DUMMY,
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'Product Carbon Footprint Credential (VerifyFirst proposal · NOT a GLEIF vLEI schema)',
  description: 'Issued by a Legal Entity (supplier) under its Legal Entity vLEI Credential (edge le, I2I). Attribute sub-blocks product／carbon／process／audit are independently SAIDed so a presentation can disclose the carbon figure while withholding process secrets.',
  version: '0.2.0',
  disclosure: 'ACDC most-compact SAID rule: a.d = SAID over {product: SAID, carbon: SAID, process: SAID, audit: SAID}; d = SAID over {v,d,i,ri,s,a: a.d, e: e.d, r: r.d}',
  required: ['product', 'carbon'],
  scopeTags: { product: 'read:product-id', carbon: 'read:carbon-footprint-vc', process: 'read:process-recipe', audit: 'read:audit-report' },
}, ['$id']).obj;

export function buildCarbonCredential({ leCredential, registry, dt, product, carbon, process, audit }) {
  const sub = obj => saidify({ d: DUMMY, ...obj }).obj;
  const attrs = { d: DUMMY, i: leCredential.a.i, dt, LEI: leCredential.a.LEI, product: sub(product), carbon: sub(carbon), process: sub(process), audit: sub(audit) };
  const a = { ...attrs, d: saidify(compactify(attrs).compact).said };
  const e = saidify({ d: DUMMY, le: { n: leCredential.d, s: leCredential.s } }).obj;
  const r = saidify({ d: DUMMY, disclosureRule: { l: 'Sub-blocks of the attribute section may be withheld and presented as SAIDs; the verifier recomputes all disclosed SAIDs and the most-compact top-level SAID.' }, proposalDisclaimer: { l: 'VerifyFirst hackathon proposal; not a GLEIF vLEI credential type.' } }).obj;
  const compactTop = saidify({ v: versionString('ACDC', 'JSON', 0), d: DUMMY, i: leCredential.a.i, ri: registry, s: CARBON_SCHEMA.$id, a: a.d, e: e.d, r: r.d }).obj;
  return { ...compactTop, a, e, r };
}

/** Build a presentation that discloses only the named attribute sub-blocks (others become their SAID). */
export function disclose(acdc, disclosed) {
  const a = { ...acdc.a };
  for (const [key, value] of Object.entries(a)) if (key !== 'd' && isSaidBlock(value) && !disclosed.includes(key)) a[key] = value.d;
  return { ...acdc, a };
}

export function verifyDisclosure(presentation, chainReport, { requiredBlocks = ['carbon'] } = {}) {
  const checks = [];
  const push = (id, ok, label, detail) => checks.push({ id, ok, label, detail, level: 'BROWSER' });
  const { compact, checks: blockChecks } = compactify(presentation.a);
  const disclosedBlocks = Object.keys(presentation.a).filter(k => k !== 'd' && isSaidBlock(presentation.a[k]));
  const knownBlocks = Object.keys(CARBON_SCHEMA.scopeTags);
  const withheldBlocks = knownBlocks.filter(k => typeof presentation.a[k] === 'string' && presentation.a[k].length === 44);
  for (const c of blockChecks) push(`block:${c.path}`, c.ok, `${c.path} · disclosed block SAID ${c.ok ? 'recomputed' : 'MISMATCH'}`, c.ok ? c.computed : `expected ${c.expected} computed ${c.computed}`);
  const aSaid = saidify(compact).said;
  push('a', aSaid === presentation.a.d, `a.d · attribute section ${aSaid === presentation.a.d ? 'recomputed from most-compact form' : 'MISMATCH'}`, `${withheldBlocks.length} block(s) withheld as SAIDs: ${withheldBlocks.join(', ') || 'none'}`);
  const eOk = !isSaidBlock(presentation.e) || saidify(presentation.e).said === presentation.e.d;
  const rOk = !isSaidBlock(presentation.r) || saidify(presentation.r).said === presentation.r.d;
  const topCompact = { v: presentation.v, d: presentation.d, i: presentation.i, ri: presentation.ri, s: presentation.s, a: presentation.a.d, e: isSaidBlock(presentation.e) ? presentation.e.d : presentation.e, r: isSaidBlock(presentation.r) ? presentation.r.d : presentation.r };
  const topOk = saidify(topCompact).said === presentation.d && eOk && rOk;
  push('top', topOk, `d · credential SAID ${topOk ? 'recomputed over most-compact form' : 'MISMATCH'}`, presentation.d);
  push('schema', presentation.s === CARBON_SCHEMA.$id, presentation.s === CARBON_SCHEMA.$id ? 'Schema · PROPOSED carbon-footprint schema (not GLEIF)' : 'Schema · unknown', presentation.s);
  const missing = requiredBlocks.filter(b => !disclosedBlocks.includes(b));
  push('required', missing.length === 0, missing.length ? `Required block(s) not disclosed: ${missing.join(', ')}` : `Required block(s) disclosed: ${requiredBlocks.join(', ')}`, 'The verifier asks only for what it needs; everything else may stay withheld.');
  const edge = isSaidBlock(presentation.e) ? presentation.e.le : null;
  const issuerCred = edge ? chainReport?.credentials.find(c => c.said === edge.n) : null;
  const edgeOk = !!issuerCred && issuerCred.schemaKey === 'LE' && issuerCred.chainValid && issuerCred.status === 'ISSUED' && issuerCred.issuee === presentation.i && (!edge.s || issuerCred.schema === edge.s);
  push('edge', edgeOk, `Edge le → Legal Entity vLEI · I2I ${edgeOk ? 'satisfied' : 'FAILED'}`, issuerCred ? `issuer ${presentation.i.slice(0, 16)}… is the issuee of LE credential ${issuerCred.said.slice(0, 16)}… (LEI ${issuerCred.lei}) · chain ${issuerCred.chainValid ? 'valid' : 'BROKEN'} · ${issuerCred.status}` : 'LE credential not found in verified chain');
  const decision = !topOk || checks.some(c => !c.ok && (c.id === 'a' || c.id.startsWith('block:'))) ? 'DENY_SAID_MISMATCH' : !edgeOk ? 'DENY_ISSUER_CHAIN_INVALID' : missing.length ? 'DENY_REQUIRED_BLOCK_WITHHELD' : presentation.s !== CARBON_SCHEMA.$id ? 'DENY_UNKNOWN_SCHEMA' : 'ACCEPT_CARBON_CLAIM';
  const bytes = serialize(presentation).length;
  return { checks, disclosedBlocks, withheldBlocks, decision, bytes, carbon: disclosedBlocks.includes('carbon') ? presentation.a.carbon : null };
}
