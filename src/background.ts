/**
 * Background Script for Proxy Switch Craft Extension
 * 
 * This script manages selective proxy configuration based on user-defined rules.
 * It uses PAC (Proxy Auto-Configuration) scripts to automatically decide
 * whether each request should use proxy or direct connection.
 */

import type { GeneralSettings, ProxyRule } from './types/common'
import { STORAGE_KEYS } from './types/common'
import { syncStorage, localStorage } from '~utils/storage'

// Global variables to store extension settings
let generalSettings: GeneralSettings | null = null
let proxyRules: ProxyRule[] = []
let currentProxyMode: 'direct' | 'selective' = 'direct'

/**
 * Convert hostname to wildcard domain, e.g. www.baidu.com => *.baidu.com, ditu.baidu.com => *.ditu.baidu.com
 * @param hostname Original hostname
 * @returns Wildcard domain
 */
function toWildcardDomain(hostname: string): string {
    const parts = hostname.split(".")
    if (parts.length <= 2) return hostname
    parts[0] = "*"
    return parts.join(".")
}

// Monitoring state for network failures
interface FailedRequest {
    url: string
    hostname: string
    responseTime?: number
    error?: string
    timestamp: number
    status?: number
}

let failedRequests: FailedRequest[] = []
let pendingRequests: Map<string, { startTime: number; url: string; hostname: string }> = new Map()

/**
 * Update badge with failed requests count
 */
function updateBadge() {
    const count = failedRequests.length
    if (count > 0) {
        chrome.action.setBadgeText({ text: count.toString() })
        chrome.action.setBadgeBackgroundColor({ color: '#FF0000' })
    } else {
        chrome.action.setBadgeText({ text: '' })
    }
}

/**
 * Add failed request to monitoring list
 */
function addFailedRequest(request: FailedRequest) {
    // Remove duplicates for same hostname
    failedRequests = failedRequests.filter(req => req.hostname !== request.hostname)

    // Add new failed request
    failedRequests.push(request)

    // Keep only last 10 failed requests
    if (failedRequests.length > 10) {
        failedRequests = failedRequests.slice(-10)
    }

    updateBadge()
}

/**
 * Load settings from Chrome storage and configure proxy
 */
async function loadSettings() {
    try {
        generalSettings = await localStorage.get(STORAGE_KEYS.GENERAL_SETTINGS) || null
        proxyRules = await syncStorage.get(STORAGE_KEYS.PROXY_RULES) || []
        console.log('📦 Settings loaded:', { generalSettings, proxyRules })

        // Configure selective proxy based on loaded rules
        await configureSelectiveProxy()
    } catch (error) {
        console.error('Error loading settings:', error)
    }
}

/**
 * Wildcard pattern matching function
 * Converts user-friendly wildcard patterns to regex for domain matching
 * Supports both exact domain and subdomain matching
 * 
 * @param pattern - Wildcard pattern (e.g., "*.google.com", "google.com")
 * @param url - URL to test against the pattern
 * @returns {boolean} - True if URL matches the pattern
 */
function matchWildcard(pattern: string, url: string): boolean {
    // Extract hostname from URL
    const hostname = new URL(url).hostname

    // Handle different pattern types
    let regexPattern: string

    if (pattern.startsWith('*.')) {
        // Pattern like "*.google.com" should match both "google.com" and "subdomain.google.com"
        const domain = pattern.substring(2) // Remove "*."
        regexPattern = `(.*\\.)?${domain.replace(/\./g, '\\.')}`
    } else {
        // Exact domain pattern
        regexPattern = pattern
            .replace(/\./g, '\\.')  // Escape dots
            .replace(/\*/g, '.*')   // Convert * to .*
            .replace(/\?/g, '.')    // Convert ? to .
    }

    const regex = new RegExp('^' + regexPattern + '$', 'i')
    return regex.test(hostname)
}

/**
 * Check if URL should use proxy based on configured rules
 * 
 * @param url - URL to check
 * @returns {boolean} - True if URL matches any proxy rule
 */
function shouldUseProxy(url: string): boolean {
    if (!proxyRules || proxyRules.length === 0) {
        return false
    }

    return proxyRules.some(rule => matchWildcard(rule.pattern, url))
}

/**
 * Configure selective proxy using PAC script
 * Only domains matching user rules will use proxy, others go direct
 */
async function configureSelectiveProxy() {
    if (!generalSettings || !proxyRules || proxyRules.length === 0) {
        // No settings or rules, use direct connection
        await setDirectConnection()
        return
    }

    // Build proxy configuration with PAC script
    const proxyConfig = {
        mode: "pac_script",
        pacScript: {
            data: generatePacScript()
        }
    }

    console.log('🔧 Configuring selective proxy with rules:', proxyConfig)

    try {
        // Configure proxy for regular sessions
        await chrome.proxy.settings.set({
            value: proxyConfig,
            scope: 'regular'
        })

        // Configure proxy for incognito sessions (if permission granted)
        try {
            await chrome.proxy.settings.set({
                value: proxyConfig,
                scope: 'incognito_persistent'
            })
            console.log('🔧 Incognito proxy also configured')
        } catch (incognitoError) {
            console.warn('⚠️ Could not configure incognito proxy:', incognitoError)
        }

        currentProxyMode = 'selective'
        console.log('🔧 Selective proxy configured:', {
            mode: 'selective',
            rules: proxyRules.map(r => r.pattern),
            proxyServer: `${generalSettings.proxyServerScheme}://${generalSettings.proxyServerAddress}:${generalSettings.proxyServerPort}`
        })
    } catch (error) {
        console.error('Error configuring selective proxy:', error)
        await setDirectConnection()
    }
}

/**
 * Set direct connection mode (no proxy)
 * Applied to both regular and incognito sessions
 */
async function setDirectConnection() {
    try {
        // Configure direct connection for regular sessions
        await chrome.proxy.settings.set({
            value: { mode: "direct" },
            scope: 'regular'
        })

        // Configure direct connection for incognito sessions (if permission granted)
        try {
            await chrome.proxy.settings.set({
                value: { mode: "direct" },
                scope: 'incognito_persistent'
            })
            console.log('🔧 Incognito direct connection also configured')
        } catch (incognitoError) {
            console.warn('⚠️ Could not configure incognito direct connection:', incognitoError)
        }

        currentProxyMode = 'direct'
        console.log('🔧 Direct connection configured (no proxy)')
    } catch (error) {
        console.error('Error setting direct connection:', error)
    }
}

/**
 * Generate PAC script based on current settings and rules
 * 
 * @returns {string} - JavaScript PAC script as string
 */
function generatePacScript(): string {
    if (!generalSettings || !proxyRules || proxyRules.length === 0) {
        return 'function FindProxyForURL(url, host) { return "DIRECT"; }'
    }

    const proxyString = `${generalSettings.proxyServerScheme.toUpperCase()} ${generalSettings.proxyServerAddress}:${generalSettings.proxyServerPort}`

    // Convert rules to PAC script conditions
    const conditions = proxyRules.map(rule => {
        let pattern: string

        if (rule.pattern.startsWith('*.')) {
            // Pattern like "*.google.com" should match both "google.com" and "subdomain.google.com"
            const domain = rule.pattern.substring(2) // Remove "*."
            pattern = `(.*\\.)?${domain.replace(/\./g, '\\.')}`
        } else {
            // Exact domain pattern
            pattern = rule.pattern
                .replace(/\./g, '\\.')  // Escape dots
                .replace(/\*/g, '.*')   // Convert * to .*
                .replace(/\?/g, '.')    // Convert ? to .
        }

        return `if (/${pattern}/i.test(host)) { return "${proxyString}"; }`
    }).join('\n    ')

    return `function FindProxyForURL(url, host) {
    // Check if host matches any proxy rule
    ${conditions}
    
    // Default to direct connection
    return "DIRECT";
}`
}

/**
 * Intercept all network requests and log proxy decisions
 * This is for monitoring and debugging purposes
 */
chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
        const shouldProxy = shouldUseProxy(details.url)
        const hostname = new URL(details.url).hostname

        // Track request start time for non-proxy requests
        if (!shouldProxy) {
            pendingRequests.set(details.requestId, {
                startTime: Date.now(),
                url: details.url,
                hostname: hostname
            })
        }

        console.log("🌐 Request intercepted:", {
            url: details.url,
            hostname: hostname,
            method: details.method,
            type: details.type,
            tabId: details.tabId,
            shouldProxy: shouldProxy,
            currentMode: currentProxyMode,
            willUseProxy: shouldProxy ? 'YES (via PAC script)' : 'NO (direct connection)',
            timeStamp: new Date(details.timeStamp).toISOString(),
            requestId: details.requestId
        })

        // Log POST request body if present
        if (details.requestBody) {
            console.log("📤 Request body:", details.requestBody)
        }
    },
    { urls: ["http://*/*", "https://*/*"] },
    ["requestBody"]
)

// Initialize: load settings and configure proxy
loadSettings()

// Initialize badge
updateBadge()

/**
 * Listen for storage changes and reconfigure proxy
 * Triggered when user updates settings in options page
 */
chrome.storage.onChanged.addListener((changes) => {
    if (changes[STORAGE_KEYS.GENERAL_SETTINGS] || changes[STORAGE_KEYS.PROXY_RULES]) {
        console.log('⚙️ Settings changed, reloading and reconfiguring proxy...')
        loadSettings()
    }
})

/**
 * Monitor request completion for performance tracking
 * Logs when requests are completed with status codes and measures response time
 */
chrome.webRequest.onCompleted.addListener(
    (details) => {
        const pendingRequest = pendingRequests.get(details.requestId)

        if (pendingRequest && generalSettings) {
            const responseTime = Date.now() - pendingRequest.startTime

            // Check if response time exceeds threshold
            if (responseTime > generalSettings.responseTimeThreshold) {
                const hostname = toWildcardDomain(pendingRequest.hostname)
                addFailedRequest({
                    url: pendingRequest.url,
                    hostname: hostname,
                    responseTime: responseTime,
                    timestamp: Date.now(),
                    status: details.statusCode
                })

                console.log("⚠️ Slow request detected:", {
                    url: pendingRequest.url,
                    hostname: hostname,
                    responseTime: responseTime,
                    threshold: generalSettings.responseTimeThreshold,
                    statusCode: details.statusCode
                })
            }
        }

        // Clean up pending request
        pendingRequests.delete(details.requestId)

        console.log("✅ Request completed:", {
            url: details.url,
            statusCode: details.statusCode,
            method: details.method,
            type: details.type,
            timeStamp: new Date(details.timeStamp).toISOString(),
            requestId: details.requestId,
            responseTime: pendingRequest ? Date.now() - pendingRequest.startTime : 'N/A'
        })
    },
    { urls: ["http://*/*", "https://*/*"] }
)

/**
 * Monitor request errors (network failures, timeouts, etc.)
 */
chrome.webRequest.onErrorOccurred.addListener(
    (details) => {
        const pendingRequest = pendingRequests.get(details.requestId)
        // For net::ERR_ABORTED, net::ERR_INTERNET_DISCONNECTED type errors, don't add to request failure list
        // Ignore aborted and disconnected errors
        const ignoredErrors = [
            'net::ERR_ABORTED',
            'net::ERR_INTERNET_DISCONNECTED',
            'net::ERR_CONNECTION_ABORTED',
            'net::ERR_BLOCKED_BY_CLIENT',
            'net::ERR_CACHE_MISS',
        ]
        if (ignoredErrors.includes(details.error)) {
            console.warn("⚠️ Request aborted, not logging:", {
                url: details.url,
                requestId: details.requestId
            })
            return
        }
        if (pendingRequest) {
            const hostname = toWildcardDomain(pendingRequest.hostname)
            addFailedRequest({
                url: pendingRequest.url,
                hostname: hostname,
                error: details.error,
                timestamp: Date.now()
            })

            console.log("❌ Request failed:", {
                url: pendingRequest.url,
                hostname: hostname,
                error: details.error,
                requestId: details.requestId
            })
        }

        // Clean up pending request
        pendingRequests.delete(details.requestId)
    },
    { urls: ["http://*/*", "https://*/*"] }
)

/**
 * Handle messages from popup
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getFailedRequests') {
        sendResponse({ failedRequests })
    } else if (request.action === 'clearFailedRequests') {
        failedRequests = []
        updateBadge()
        sendResponse({ success: true })
    } else if (request.action === 'addToProxyRules') {
        const { hostname } = request
        if (hostname) {
            // Check if rule already exists
            const exists = proxyRules.some(rule => rule.pattern === hostname)
            if (exists) {
                sendResponse({ success: false, message: 'Rule already exists' })
                return
            }
            // Add to proxy rules
            const newRule = {
                id: Date.now().toString(),
                pattern: hostname
            }
            proxyRules.push(newRule)

            syncStorage.set(STORAGE_KEYS.PROXY_RULES, proxyRules)

            // Remove from failed requests
            failedRequests = failedRequests.filter(req => req.hostname !== hostname)
            updateBadge()

            // Reconfigure proxy
            configureSelectiveProxy()

            sendResponse({ success: true })
        }
    }

    return true // Keep message channel open for async response
})
