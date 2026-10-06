import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const DATA_DIR = path.resolve('data');
const PREFIX_FILE = path.join(DATA_DIR, 'prefixes.json');

// In-memory cache for instantaneous lookup
const prefixCache = new Map();

// Load prefixes from disk into memory cache on boot
function loadPrefixes() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    if (fs.existsSync(PREFIX_FILE)) {
      const raw = fs.readFileSync(PREFIX_FILE, 'utf8');
      const data = JSON.parse(raw || '{}');
      for (const [guildId, prefix] of Object.entries(data)) {
        prefixCache.set(guildId, prefix);
      }
    }
  } catch (error) {
    console.error('[PrefixManager] Error loading prefixes file:', error.message);
  }
}

// Persist memory cache to disk
function savePrefixes() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const data = Object.fromEntries(prefixCache);
    fs.writeFileSync(PREFIX_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('[PrefixManager] Error saving prefixes file:', error.message);
  }
}

// Initialize on module import
loadPrefixes();

/**
 * Gets the prefix for a specific guild.
 * @param {string} guildId
 * @returns {string}
 */
export function getGuildPrefix(guildId) {
  if (!guildId) return config.defaultPrefix;
  return prefixCache.get(guildId) || config.defaultPrefix;
}

/**
 * Sets the prefix for a specific guild and persists to disk.
 * @param {string} guildId
 * @param {string} newPrefix
 */
export function setGuildPrefix(guildId, newPrefix) {
  if (!guildId || !newPrefix) return;
  prefixCache.set(guildId, newPrefix);
  savePrefixes();
}

/**
 * Resets guild prefix to default.
 * @param {string} guildId
 */
export function resetGuildPrefix(guildId) {
  if (!guildId) return;
  prefixCache.delete(guildId);
  savePrefixes();
}
