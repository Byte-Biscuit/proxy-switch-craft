import { Storage } from "@plasmohq/storage"
import type { ProxyRule } from "~types/common"
import { STORAGE_KEYS, PROXY_RULES_CHUNK_COUNT } from "~types/common"

// Use local storage in development for faster testing, sync storage in production
const isDevelopment = process.env.NODE_ENV === "development"

export const localStorage = new Storage({
    area: "local"
})

export const syncStorage = new Storage({
    area: "sync"
})

// Use local storage in development, sync storage in production
const storage = isDevelopment ? localStorage : syncStorage

console.log(`Storage mode: ${isDevelopment ? 'LOCAL (development)' : 'SYNC (production)'}`)

/**
 * Get proxy rules from Chrome sync storage
 * Reads from multiple keys (PROXY_RULES_0 to PROXY_RULES_19) and merges them
 * This approach avoids Chrome's single key storage limit (8KB per key in sync storage)
 * 
 * Automatically migrates old single-key storage to new chunked storage on first run
 * 
 * @returns {Promise<ProxyRule[]>} - Array of all proxy rules
 */
export async function getProxyRules(): Promise<ProxyRule[]> {
    let allRules: ProxyRule[] = []
    try {
        // First, check if there's old data in the legacy single key
        const legacyRules = await storage.get<ProxyRule[]>(STORAGE_KEYS.PROXY_RULES)

        if (legacyRules && Array.isArray(legacyRules) && legacyRules.length > 0) {
            console.log(`📦 Found ${legacyRules.length} rules in legacy storage, migrating...`)

            // Migrate to new chunked storage
            await saveProxyRules(legacyRules)

            // Remove old key to avoid confusion
            await storage.remove(STORAGE_KEYS.PROXY_RULES)

            console.log(`✅ Migration completed: ${legacyRules.length} rules migrated to chunked storage`)
            return legacyRules
        }
        // Read from chunks sequentially until we hit an empty key
        for (let i = 0; i < PROXY_RULES_CHUNK_COUNT; i++) {
            const key = `${STORAGE_KEYS.PROXY_RULES}_${i}`
            const chunk = await storage.get(key)

            // If key doesn't exist or is empty, stop reading
            if (!chunk || !Array.isArray(chunk) || chunk.length === 0) {
                break
            }
            allRules.push(...chunk)
        }
        console.log(`Loaded ${allRules.length} proxy rules from storage`)
        return allRules
    } catch (error) {
        console.error('Error loading proxy rules:', error)
        return []
    }
}

/**
 * Set proxy rules to Chrome sync storage
 * Stores rules sequentially with 100 rules per key
 * This approach avoids Chrome's single key storage limit (8KB per key in sync storage)
 * 
 * @param {ProxyRule[]} rules - Array of proxy rules to store
 * @returns {Promise<void>}
 */
export async function saveProxyRules(rules: ProxyRule[]): Promise<void> {
    try {
        const RULES_PER_KEY = 100 // Each key stores up to 100 rules
        const totalKeys = Math.ceil(rules.length / RULES_PER_KEY)
        if (totalKeys > PROXY_RULES_CHUNK_COUNT) {
            console.warn(`⚠️ Warning: Attempting to store ${rules.length} rules which exceeds the maximum supported ${PROXY_RULES_CHUNK_COUNT * RULES_PER_KEY} rules. Excess rules will be ignored.`)
            return
        }
        // Only write keys that have data
        for (let i = 0; i < totalKeys; i++) {
            const start = i * RULES_PER_KEY
            const end = start + RULES_PER_KEY
            const chunk = rules.slice(start, end)
            const key = `${STORAGE_KEYS.PROXY_RULES}_${i}`

            await storage.set(key, chunk)
        }

        // Clear unused keys (if rules were deleted)
        // For example, if we previously had 10 keys but now only need 3
        if (totalKeys < PROXY_RULES_CHUNK_COUNT) {
            for (let i = totalKeys; i < PROXY_RULES_CHUNK_COUNT; i++) {
                const key = `${STORAGE_KEYS.PROXY_RULES}_${i}`

                // Check if key exists before removing
                const existingData = await storage.get(key)
                if (existingData === null || existingData === undefined) {
                    // Key doesn't exist, no need to check remaining keys
                    break
                }

                await storage.remove(key)
            }
        }

        console.log(`Saved ${rules.length} proxy rules to ${totalKeys} key(s) (${RULES_PER_KEY} rules per key)`)
    } catch (error) {
        /**
         *  1. Error saving proxy rules: Error: This request exceeds the MAX_WRITE_OPERATIONS_PER_MINUTE quota.
         */
        console.error('Error saving proxy rules:', error)
        throw error
    }
}
