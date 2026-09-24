// Alerts are kept on the host device only, in IndexedDB, trimmed to the admin's limit (newest kept).
import type { AlertRecord } from "@/lib/alerts/types";

const DB_NAME = "ip-camera-alerts";
const STORE = "alerts";
const BY_ACCOUNT_TIME = "byAccountTs";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: "id" });
      store.createIndex(BY_ACCOUNT_TIME, ["account", "ts"]);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function done(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

function accountRange(account: string) {
  return IDBKeyRange.bound([account, -Infinity], [account, Infinity]);
}

/** All of this host account's alerts on this device, oldest first. */
export async function listAlerts(account: string): Promise<AlertRecord[]> {
  const db = await openDb();
  const req = db.transaction(STORE).objectStore(STORE).index(BY_ACCOUNT_TIME).getAll(accountRange(account));
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as AlertRecord[]);
    req.onerror = () => reject(req.error);
  });
}

/** Deletes all but the newest `keep` alerts of this account. Returns the ids that were removed. */
export async function pruneAlerts(account: string, keep: number): Promise<string[]> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  const removed: string[] = [];
  const countReq = tx.objectStore(STORE).index(BY_ACCOUNT_TIME).count(accountRange(account));
  countReq.onsuccess = () => {
    let excess = countReq.result - keep;
    if (excess <= 0) return;
    // Walk oldest → newest, deleting until only `keep` remain.
    const cursorReq = tx.objectStore(STORE).index(BY_ACCOUNT_TIME).openCursor(accountRange(account));
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor || excess <= 0) return;
      removed.push((cursor.value as AlertRecord).id);
      cursor.delete();
      excess--;
      cursor.continue();
    };
  };
  await done(tx);
  return removed;
}

/** Saves an alert, then trims to `keep`. Returns the ids of alerts that were removed to make room. */
export async function addAlert(record: AlertRecord, keep: number): Promise<string[]> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put(record);
  await done(tx);
  return pruneAlerts(record.account, keep);
}
