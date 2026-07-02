/**
 * Background Script for Proxy Switch Craft Extension
 * 
 * This script manages selective proxy configuration based on user-defined rules.
 * It uses PAC (Proxy Auto-Configuration) scripts to automatically decide
 * whether each request should use proxy or direct connection.
 */
import proxyRuleService from "~proxy-rule-service"
import generalSettingsService from "~general-settings-service"
import requestMonitorService from "~request-monitor-service"
import { generateId } from "~utils/util"
import { STORAGE_KEYS } from './types/common'
import type { FailedRequest } from './types/common'

const IGNORED_ERRORS = [
    'net::ERR_ABORTED',
    'net::ERR_INTERNET_DISCONNECTED',
    'net::ERR_CONNECTION_ABORTED',
    'net::ERR_BLOCKED_BY_CLIENT',
    'net::ERR_CACHE_MISS',
]

function isLocalhost(hostname: string): boolean {
    return hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname.startsWith('127.')
}

async function recordFailedRequest(
    pendingRequest: { url: string; currentTabHostname: string },
    details: chrome.webRequest.WebResponseErrorDetails
) {
    const isInRules = await proxyRuleService.isInRules(details.url)
    if (isInRules) {
        return
    }
    const hostname = proxyRuleService.formatPattern(pendingRequest.url)
    const failedRequest = {
        url: pendingRequest.url,
        hostname: hostname,
        currentTabHostname: pendingRequest.currentTabHostname,
        error: details.error,
        timestamp: Date.now()
    }
    await requestMonitorService.addFailedRequest(failedRequest)
    console.log("❌ Request failed:", failedRequest)
}

/**
 * Intercept all network requests and log proxy decisions
 * This is for monitoring and debugging purposes
 */
chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
        console.log("🔍 Intercepted request:", details.url)

        let hostname: string
        try {
            hostname = new URL(details.url).hostname
        } catch {
            return
        }

        if (isLocalhost(hostname)) {
            return
        }

        if (!details.tabId || details.tabId === -1) {
            return
        }

        // Sync record to avoid race with onCompleted/onErrorOccurred
        requestMonitorService.addPendingRequest({
            requestId: details.requestId,
            url: details.url,
            hostname: hostname,
            currentTabHostname: '',
            tabId: details.tabId,
            startTime: Date.now(),
        })

        requestMonitorService.isMonitoringEnabled().then((enabled) => {
            if (!enabled) {
                requestMonitorService.removePendingRequest(details.requestId)
                return
            }

            proxyRuleService.isInRules(details.url).then((isInRules) => {
                if (isInRules) {
                    requestMonitorService.removePendingRequest(details.requestId)
                    return
                }

                chrome.tabs.get(details.tabId).then(tab => {
                    if (tab.url) {
                        try {
                            const currentTabHostname = new URL(tab.url).hostname
                            requestMonitorService.updatePendingRequestTabHostname(
                                details.requestId,
                                currentTabHostname
                            )
                            console.log("🌐 Request intercepted:", {
                                requestId: details.requestId,
                                url: details.url,
                                hostname,
                                currentTabHostname,
                            })
                        } catch (error) {
                            console.error('Error parsing tab URL:', error)
                        }
                    }
                }).catch(error => {
                    console.error('Error getting tab info:', error)
                })
            })
        })
    },
    { urls: ["http://*/*", "https://*/*"] },
    ["requestBody"]
)

/**
 * Monitor request completion for performance tracking
 * Logs when requests are completed with status codes and measures response time
 */
chrome.webRequest.onCompleted.addListener(
    (details) => {
        const pendingRequest = requestMonitorService.getPendingRequest(details.requestId)
        generalSettingsService.getSettings().then(async generalSettings => {
            if (!(pendingRequest && generalSettings)) {
                return
            }
            if (!generalSettings.proxyEnabled) {
                return
            }

            let currentTabHostname = pendingRequest.currentTabHostname
            if (!currentTabHostname && pendingRequest.tabId) {
                currentTabHostname = await requestMonitorService.resolveTabHostname(pendingRequest.tabId)
            }
            if (!currentTabHostname) {
                return
            }

            const responseTime = Date.now() - pendingRequest.startTime
            if (responseTime > generalSettings.responseTimeThreshold) {
                const hostname = proxyRuleService.formatPattern(pendingRequest.url)
                const failedRequest = {
                    url: pendingRequest.url,
                    hostname: hostname,
                    currentTabHostname: currentTabHostname,
                    responseTime: responseTime,
                    timestamp: Date.now(),
                    status: details.statusCode
                }
                await requestMonitorService.addFailedRequest(failedRequest)
                console.log("⚠️ Slow request detected:", failedRequest)
            }
        }).finally(() => {
            requestMonitorService.removePendingRequest(details.requestId)
        })
    },
    { urls: ["http://*/*", "https://*/*"] }
)

/**
 * Monitor request errors (network failures, timeouts, etc.)
 */
chrome.webRequest.onErrorOccurred.addListener(
    (details) => {
        if (IGNORED_ERRORS.includes(details.error)) {
            console.warn("⚠️ Request aborted, not logging:", {
                url: details.url,
                requestId: details.requestId
            })
            requestMonitorService.removePendingRequest(details.requestId)
            return
        }

        const pendingRequest = requestMonitorService.getPendingRequest(details.requestId)

        const handleError = async () => {
            if (!(await requestMonitorService.isMonitoringEnabled())) {
                return
            }

            let currentTabHostname = pendingRequest?.currentTabHostname || ''
            const url = pendingRequest?.url || details.url
            const tabId = pendingRequest?.tabId ?? details.tabId

            if (!currentTabHostname && tabId && tabId !== -1) {
                currentTabHostname = await requestMonitorService.resolveTabHostname(tabId)
            }
            if (!currentTabHostname) {
                return
            }

            await recordFailedRequest(
                { url, currentTabHostname },
                details
            )
        }

        handleError().finally(() => {
            requestMonitorService.removePendingRequest(details.requestId)
        })
    },
    { urls: ["http://*/*", "https://*/*"] }
)

/**
 * Handle messages from popup
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    (async () => {
        let currentTabHostname: string = request.currentTabHostname;
        if (!currentTabHostname && sender.tab && sender.tab.url) {
            try {
                currentTabHostname = new URL(sender.tab.url).hostname
            } catch (error) {
                console.error('Error parsing sender tab URL:', error)
            }
        }
        const action = request.action;
        console.log("Received message action:", action, "from sender:", sender, "with parameters:", request);
        switch (action) {
            case 'getFailedRequests':
                const failedRequests: FailedRequest[] = requestMonitorService.getFailedRequestsCurrentTabHostname(currentTabHostname);
                console.log("Returning failed requests for hostname:", currentTabHostname, failedRequests);
                sendResponse({ failedRequests: failedRequests });
                break;
            case 'clearFailedRequests':
                requestMonitorService.removeFailedRequestsForHostname(currentTabHostname);
                await requestMonitorService.updateBadgeForActiveTab();
                sendResponse({ success: true });
                break;
            case 'addProxyRules':
                const { hostnames } = request;
                const proxyRules = []
                for (const hostname of hostnames) {
                    const proxyRule = {
                        id: generateId(),
                        pattern: hostname
                    };
                    proxyRules.push(proxyRule);
                }
                await proxyRuleService.addRules(proxyRules);
                requestMonitorService.updateFailedRequestsForCurrentTab(currentTabHostname, hostnames);
                await requestMonitorService.configureSelectiveProxy();
                sendResponse({ success: true });
                break;
            case 'updateBadge':
                await requestMonitorService.updateBadgeForActiveTab();
                sendResponse({ success: true });
                break;
            case 'configureSelectiveProxy':
                await requestMonitorService.configureSelectiveProxy();
                sendResponse({ success: true });
                break;
            case 'getProxyEnabled':
                sendResponse({ proxyEnabled: await requestMonitorService.isProxyEnabled() });
                break;
            case 'setProxyEnabled': {
                const settings = await generalSettingsService.getSettings();
                const updatedSettings = {
                    ...settings,
                    proxyEnabled: request.enabled === true,
                };
                await generalSettingsService.saveSettings(updatedSettings);
                await requestMonitorService.configureSelectiveProxy();
                sendResponse({ success: true, proxyEnabled: updatedSettings.proxyEnabled });
                break;
            }
            default:
                console.warn('Unknown action:', action);
        }
    })();
    return true
})

/**
 * Listen for tab activation (switching tabs)
 * Update badge to show failed requests count for the newly active tab
 */
chrome.tabs.onActivated.addListener(async () => {
    await requestMonitorService.updateBadgeForActiveTab()
})

/**
 * Listen for tab URL updates
 * Update badge when user navigates to a different URL in the same tab
 */
chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
    if (changeInfo.url && tab.active) {
        await requestMonitorService.updateBadgeForActiveTab()
    }
})

/**
 * Initialize proxy on install, browser startup, and service worker load
 */
function initializeProxy() {
    requestMonitorService.configureSelectiveProxy().catch((error) => {
        console.error('Error initializing proxy:', error)
    })
}

chrome.runtime.onInstalled.addListener(() => {
    initializeProxy()
})

chrome.runtime.onStartup.addListener(() => {
    initializeProxy()
})

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && Object.keys(changes).some(k => k.startsWith(STORAGE_KEYS.PROXY_RULES))) {
        initializeProxy()
    }
    if (area === 'local' && changes[STORAGE_KEYS.GENERAL_SETTINGS]) {
        initializeProxy()
    }
})

initializeProxy()
