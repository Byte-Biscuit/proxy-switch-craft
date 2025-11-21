import type { GeneralSettings, ProxyRule, FailedRequest, PendingRequest } from './types/common'
import generalSettingsService from '~general-settings-service'
import proxyRuleService from "~proxy-rule-service"

class RequestMonitorService {
    private failedRequestsByHostname: Map<string, FailedRequest[]> = new Map()
    private pendingRequests: Map<string, PendingRequest> = new Map()

    addPendingRequest(request: PendingRequest) {
        this.pendingRequests.set(request.requestId, request)
    }

    removePendingRequest(requestId: string) {
        this.pendingRequests.delete(requestId)
    }

    getPendingRequest(requestId: string) {
        return this.pendingRequests.get(requestId)
    }

    getFailedRequestsCurrentTabHostname(currentTabHostname: string): FailedRequest[] {
        return this.failedRequestsByHostname.get(currentTabHostname) || []
    }

    removeFailedRequestsForHostname(currentTabHostname: string) {
        this.failedRequestsByHostname.delete(currentTabHostname)
    }

    async updateBadge(currentTabHostname: string) {
        try {
            if (!currentTabHostname || currentTabHostname.trim() === "") {
                chrome.action.setBadgeText({ text: '' })
                return
            }
            // Get failed requests for current hostname (exact match)
            const failedRequests = this.failedRequestsByHostname.get(currentTabHostname) || []
            const count = failedRequests.length

            if (count > 0) {
                chrome.action.setBadgeText({ text: count.toString() })
                chrome.action.setBadgeBackgroundColor({ color: '#FF0000' })
            } else {
                chrome.action.setBadgeText({ text: '' })
            }
        } catch (error) {
            console.error('Error updating badge:', error)
            chrome.action.setBadgeText({ text: '' })
        }
    }

    /**
     * Add failed request to monitoring list (grouped by hostname)
     */
    async addFailedRequest(request: FailedRequest) {
        const currentTabHostname = request.currentTabHostname;
        if (!currentTabHostname) {
            console.error("No current tab hostname provided for failed request:", request);
            return;
        }
        // Get existing failed requests for this hostname
        let failedRequests = this.failedRequestsByHostname.get(currentTabHostname) || []

        // Add new failed request
        if (failedRequests.find(r => r.hostname === request.hostname)) {
            // Duplicate entry, skip
            return
        }
        failedRequests.push(request)
        // Update the map
        this.failedRequestsByHostname.set(currentTabHostname, failedRequests)
        console.log("Total failed requests for", this.failedRequestsByHostname);
        // Update badge for current tab
        this.updateBadge(currentTabHostname)
    }

    updateFailedRequestsForCurrentTab(currentTabHostname: string, hostnames: string[]) {
        const failedRequests = this.getFailedRequestsCurrentTabHostname(currentTabHostname);
        const remainingRequests = failedRequests.filter(req => !hostnames.includes(req.hostname));
        if (remainingRequests.length > 0) {
            this.failedRequestsByHostname.set(currentTabHostname, remainingRequests);
        } else {
            this.failedRequestsByHostname.delete(currentTabHostname);
        }
        this.updateBadge(currentTabHostname)
    }

    /**
     * Configure selective proxy using PAC script
     * Only domains matching user rules will use proxy, others go direct
     */
    async configureSelectiveProxy() {
        const generalSettings = await generalSettingsService.getSettings();
        const proxyRules = await proxyRuleService.getRules();
        if (!generalSettings || !proxyRules || proxyRules.length === 0) {
            // No settings or rules, use direct connection
            await this.setDirectConnection()
            return
        }

        // Build proxy configuration with PAC script
        const proxyConfig = {
            mode: "pac_script",
            pacScript: {
                data: this.generatePacScript(generalSettings, proxyRules)
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

            console.log('🔧 Selective proxy configured:', {
                mode: 'selective',
                rules: proxyRules.map(r => r.pattern),
                proxyServer: `${generalSettings.proxyServerScheme}://${generalSettings.proxyServerAddress}:${generalSettings.proxyServerPort}`
            })
        } catch (error) {
            console.error('Error configuring selective proxy:', error)
            await this.setDirectConnection()
        }
    }

    /**
     * Set direct connection mode (no proxy)
     * Applied to both regular and incognito sessions
     */
    async setDirectConnection() {
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
    generatePacScript(generalSettings: GeneralSettings, proxyRules: ProxyRule[]): string {
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
}

const requestMonitorService = new RequestMonitorService();
export default requestMonitorService;