import { Storage } from "@plasmohq/storage"
import type { ProxyRule } from "~types/common"
import { STORAGE_KEYS, PROXY_RULES_CHUNK_COUNT } from "~types/common"

export const localStorage = new Storage({
    area: "local"
})


export const syncStorage = new Storage({
    area: "sync"
})

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
        const legacyRules = await syncStorage.get<ProxyRule[]>(STORAGE_KEYS.PROXY_RULES)
        
        if (legacyRules && Array.isArray(legacyRules) && legacyRules.length > 0) {
            console.log(`📦 Found ${legacyRules.length} rules in legacy storage, migrating...`)
            
            // Migrate to new chunked storage
            await setProxyRules(legacyRules)
            
            // Remove old key to avoid confusion
            await syncStorage.remove(STORAGE_KEYS.PROXY_RULES)
            
            console.log(`✅ Migration completed: ${legacyRules.length} rules migrated to chunked storage`)
            return legacyRules
        }

        // Read from all chunks in parallel
        const promises = Array.from({ length: PROXY_RULES_CHUNK_COUNT }, (_, index) => {
            const key = `${STORAGE_KEYS.PROXY_RULES}_${index}`
            return syncStorage.get(key)
        })

        const chunks = await Promise.all(promises)

        // Merge all chunks
        for (const chunk of chunks) {
            if (Array.isArray(chunk) && chunk.length > 0) {
                allRules.push(...chunk)
            }
        }

        console.log(`📥 Loaded ${allRules.length} proxy rules from ${PROXY_RULES_CHUNK_COUNT} chunks`)
        return allRules
    } catch (error) {
        console.error('Error loading proxy rules:', error)
        return []
    }
}

/**
 * Set proxy rules to Chrome sync storage
 * Splits rules into 20 chunks and stores them in separate keys
 * This approach avoids Chrome's single key storage limit (8KB per key in sync storage)
 * 
 * @param {ProxyRule[]} rules - Array of proxy rules to store
 * @returns {Promise<void>}
 */
export async function setProxyRules(rules: ProxyRule[]): Promise<void> {

    try {
        // Calculate chunk size
        const chunkSize = Math.ceil(rules.length / PROXY_RULES_CHUNK_COUNT)

        // Split rules into chunks and save
        const promises: Promise<void>[] = []

        for (let i = 0; i < PROXY_RULES_CHUNK_COUNT; i++) {
            const start = i * chunkSize
            const end = start + chunkSize
            const chunk = rules.slice(start, end)
            const key = `${STORAGE_KEYS.PROXY_RULES}_${i}`

            // Save chunk (empty array if no data for this chunk)
            promises.push(syncStorage.set(key, chunk))
        }

        await Promise.all(promises)

        console.log(`💾 Saved ${rules.length} proxy rules to ${PROXY_RULES_CHUNK_COUNT} chunks`)
    } catch (error) {
        console.error('Error saving proxy rules:', error)
        throw error
    }
}
