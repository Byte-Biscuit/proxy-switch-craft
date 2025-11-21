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
import type { FailedRequest } from './types/common'

/**
 * Intercept all network requests and log proxy decisions
 * This is for monitoring and debugging purposes
 */
chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
        proxyRuleService.isInRules(details.url).then((isInRules) => {
            if (isInRules) {
                return
            }
            const hostname = new URL(details.url).hostname
            // Exclude localhost and 127.0.0.1 from proxy
            if (
                hostname === 'localhost' ||
                hostname === '127.0.0.1' ||
                hostname.startsWith('127.') // covers 127.x.x.x
            ) {
                return
            }
            // Track request start time for non-proxy requests
            if (details.tabId && details.tabId !== -1) {
                // Get current tab hostname asynchronously
                chrome.tabs.get(details.tabId).then(tab => {
                    if (tab.url) {
                        try {
                            const currentTabHostname = new URL(tab.url).hostname
                            const pendingRequest = {
                                requestId: details.requestId,
                                url: details.url,
                                hostname: hostname,
                                currentTabHostname: currentTabHostname,
                                startTime: Date.now(),
                            }
                            requestMonitorService.addPendingRequest(pendingRequest)
                            console.log("🌐 Request intercepted:", pendingRequest)
                        } catch (error) {
                            console.error('Error parsing tab URL:', error)
                        }
                    }
                }).catch(error => {
                    console.error('Error getting tab info:', error)
                })
            }
        });

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
        generalSettingsService.getSettings().then(generalSettings => {
            if (!(pendingRequest && generalSettings)) {
                return
            }
            const responseTime = Date.now() - pendingRequest.startTime
            const currentTabHostname = pendingRequest.currentTabHostname;
            // Check if response time exceeds threshold
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
                requestMonitorService.addFailedRequest(failedRequest)
                console.log("⚠️ Slow request detected:", failedRequest)
            }
        }).finally(() => {
            // Clean up pending request
            requestMonitorService.removePendingRequest(details.requestId)
        });
    },
    { urls: ["http://*/*", "https://*/*"] }
)

/**
 * Monitor request errors (network failures, timeouts, etc.)
 */
chrome.webRequest.onErrorOccurred.addListener(
    (details) => {
        const pendingRequest = requestMonitorService.getPendingRequest(details.requestId)
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
            proxyRuleService.isInRules(details.url).then((isInRules) => {
                if (isInRules) {
                    return
                }
                const hostname = proxyRuleService.formatPattern(pendingRequest.url)
                const currentTabHostname = pendingRequest.currentTabHostname;
                const failedRequest = {
                    url: pendingRequest.url,
                    hostname: hostname,
                    currentTabHostname: currentTabHostname,
                    error: details.error,
                    timestamp: Date.now()
                }
                requestMonitorService.addFailedRequest(failedRequest)
                console.log("❌ Request failed:", failedRequest)
            }).finally(() => { requestMonitorService.removePendingRequest(details.requestId) })
        }
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
                requestMonitorService.updateBadge(currentTabHostname);
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
                proxyRuleService.addRules(proxyRules).then(() => {
                    requestMonitorService.updateFailedRequestsForCurrentTab(currentTabHostname, hostnames);
                    requestMonitorService.configureSelectiveProxy();
                });
                sendResponse({ success: true });
                break;
            case 'updateBadge':
                await requestMonitorService.updateBadge(currentTabHostname);
                sendResponse({ success: true });
                break;
            case 'configureSelectiveProxy':
                requestMonitorService.configureSelectiveProxy();
                sendResponse({ success: true });
                break;
            default:
                console.warn('Unknown action:', action);
        }
    })();
    // Keep message channel open for async response
    return true
})

/**
 * Listen for tab activation (switching tabs)
 * Update badge to show failed requests count for the newly active tab
 */
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
        const tab = await chrome.tabs.get(activeInfo.tabId)
        if (tab.url) {
            const hostname = new URL(tab.url).hostname
            await requestMonitorService.updateBadge(hostname)
        } else {
            await requestMonitorService.updateBadge("")
        }
    } catch (error) {
        console.error('Error getting tab hostname on activation:', error)
    }
})

/**
 * Listen for tab URL updates
 * Update badge when user navigates to a different URL in the same tab
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    // Only update when URL changes and tab is active
    if (changeInfo.url && tab.active) {
        try {
            const hostname = new URL(changeInfo.url).hostname
            await requestMonitorService.updateBadge(hostname)
        } catch (error) {
            console.error('Error parsing URL on tab update:', error)
        }
    }
})
