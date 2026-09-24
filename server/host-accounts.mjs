// Host accounts, managed by the admin and saved to <DATA_DIR>/hosts.json.
// Passwords are stored only as salted scrypt hashes.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 32;
const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,32}$/;
const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 128;
// Random part of each host's ntfy topic: letters/digits ntfy allows, no look-alikes.
const NTFY_KEY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const NTFY_KEY_LENGTH = 8;
const newNtfyKey = () => Array.from({ length: NTFY_KEY_LENGTH }, () => NTFY_KEY_ALPHABET[randomInt(NTFY_KEY_ALPHABET.length)]).join("");

/**
 * @typedef {{ username: string, salt: string, hash: string, createdAt: number, updatedAt: number, ntfyKey?: string }} HostAccount
 */

export function createHostAccounts(dataDir) {
  const file = join(dataDir, "hosts.json");
  /** @type {Map<string, HostAccount>} lower-cased username -> account */
  const accounts = new Map();

  if (existsSync(file)) {
    for (const account of JSON.parse(readFileSync(file, "utf8"))) accounts.set(account.username.toLowerCase(), account);
  }

  function save() {
    mkdirSync(dataDir, { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify([...accounts.values()], null, 2), { mode: 0o600 });
    renameSync(tmp, file); // atomic: a crash mid-write never leaves a half-written file
  }

  async function hashPassword(password, salt = randomBytes(16).toString("base64")) {
    const hash = /** @type {Buffer} */ (await scryptAsync(password, salt, KEY_LENGTH)).toString("base64");
    return { salt, hash };
  }

  /** Returns an error message, or null if valid. */
  function validate(username, password, { passwordRequired }) {
    if (username !== undefined && !USERNAME_PATTERN.test(username)) {
      return "Username must be 3–32 characters: letters, numbers, dot, dash or underscore.";
    }
    if (password !== undefined || passwordRequired) {
      if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
        return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
      }
      if (password.length > MAX_PASSWORD_LENGTH) return `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`;
    }
    return null;
  }

  // Hashed on a random password so unknown usernames take as long to reject as wrong passwords.
  const dummy = hashPassword(randomBytes(16).toString("hex"));

  return {
    /** Public list for the admin: no hashes. */
    list() {
      return [...accounts.values()]
        .map(({ username, createdAt, updatedAt }) => ({ username, createdAt, updatedAt }))
        .sort((a, b) => a.username.localeCompare(b.username));
    },

    /** The account's permanent random ntfy key; accounts created before this existed get one now. */
    ntfyKey(username) {
      const account = accounts.get(String(username).toLowerCase());
      if (!account) return null;
      if (!account.ntfyKey) {
        account.ntfyKey = newNtfyKey();
        save();
      }
      return account.ntfyKey;
    },

    exists(username) {
      return accounts.has(String(username).toLowerCase());
    },

    /** Returns the account's canonical username if the password matches, else null. */
    async verify(username, password) {
      const account = accounts.get(String(username).toLowerCase());
      const { salt, hash } = account ?? (await dummy);
      const attempt = await hashPassword(String(password), salt);
      const ok = timingSafeEqual(Buffer.from(attempt.hash, "base64"), Buffer.from(hash, "base64"));
      return ok && account ? account.username : null;
    },

    /** Returns { error } or { account }. */
    async add(username, password) {
      const error = validate(username, password, { passwordRequired: true });
      if (error) return { error };
      if (accounts.has(username.toLowerCase())) return { error: `A host named "${username}" already exists.` };
      const now = Date.now();
      const account = { username, ...(await hashPassword(password)), createdAt: now, updatedAt: now, ntfyKey: newNtfyKey() };
      accounts.set(username.toLowerCase(), account);
      save();
      return { account };
    },

    /** Rename and/or set a new password. Returns { error } or { account, previousUsername }. */
    async update(username, { newUsername, password }) {
      const account = accounts.get(String(username).toLowerCase());
      if (!account) return { error: "That host no longer exists." };
      const renaming = newUsername !== undefined && newUsername !== account.username;
      const error = validate(renaming ? newUsername : undefined, password, { passwordRequired: false });
      if (error) return { error };
      if (renaming && newUsername.toLowerCase() !== account.username.toLowerCase() && accounts.has(newUsername.toLowerCase())) {
        return { error: `A host named "${newUsername}" already exists.` };
      }
      if (!renaming && password === undefined) return { error: "Nothing to change." };
      const previousUsername = account.username;
      if (password !== undefined) Object.assign(account, await hashPassword(password));
      if (renaming) {
        accounts.delete(previousUsername.toLowerCase());
        account.username = newUsername;
        accounts.set(newUsername.toLowerCase(), account);
      }
      account.updatedAt = Date.now();
      save();
      return { account, previousUsername };
    },

    /** Returns the deleted account's username, or null if it didn't exist. */
    remove(username) {
      const account = accounts.get(String(username).toLowerCase());
      if (!account) return null;
      accounts.delete(account.username.toLowerCase());
      save();
      return account.username;
    },
  };
}
