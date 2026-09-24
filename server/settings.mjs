// App-wide settings the admin can change, saved to <DATA_DIR>/settings.json.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULTS = { maxAlerts: 100 };
const LIMITS = { maxAlerts: { min: 1, max: 1000 } };

export function createSettings(dataDir) {
  const file = join(dataDir, "settings.json");
  let current = { ...DEFAULTS, ...(existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {}) };

  return {
    get: () => ({ ...current }),

    /** Returns { error } or { settings }. Only known keys are accepted. */
    update(changes) {
      const next = { ...current };
      if (changes.maxAlerts !== undefined) {
        const n = Number(changes.maxAlerts);
        const { min, max } = LIMITS.maxAlerts;
        if (!Number.isInteger(n) || n < min || n > max) return { error: `Alerts to keep must be a whole number from ${min} to ${max}.` };
        next.maxAlerts = n;
      }
      current = next;
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(`${file}.tmp`, JSON.stringify(current, null, 2));
      renameSync(`${file}.tmp`, file);
      return { settings: { ...current } };
    },
  };
}
