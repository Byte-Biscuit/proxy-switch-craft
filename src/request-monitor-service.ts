import type { GeneralSettings, ProxyRule, FailedRequest, PendingRequest } from './types/common'
import generalSettingsService from '~general-settings-service'
import proxyRuleService from "~proxy-rule-service"

class RequestMonitorService {
    private failedRequestsByHostname: Map<string, FailedRequest[]> = new Map()
    private pendingRequests: Map<string, PendingRequest> = new Map()

    addPendingRequest(request: PendingRequest) {
        this.pendingRequests.set(request.requestId, request)
    }

    updatePendingRequestTabHostname(requestId: string, currentTabHostname: string) {
        const pending = this.pendingRequests.get(requestId)
        if (pending) {
            pending.currentTabHostname = currentTabHostname
        }
    }

    removePendingRequest(requestId: string) {
        this.pendingRequests.delete(requestId)
    }

    getPendingRequest(requestId: string) {
        return this.pendingRequests.get(requestId)
    }

    async isProxyEnabled(): Promise<boolean> {
        const settings = await generalSettingsService.getSettings()
        return settings?.proxyEnabled === true
    }

    async isMonitoringEnabled(): Promise<boolean> {
        return await this.isProxyEnabled()
    }

    getFailedRequestsCurrentTabHostname(currentTabHostname: string): FailedRequest[] {
        return this.failedRequestsByHostname.get(currentTabHostname) || []
    }

    removeFailedRequestsForHostname(currentTabHostname: string) {
        this.failedRequestsByHostname.delete(currentTabHostname)
    }

    async getActiveTabHostname(): Promise<string> {
        try {
            const [tab] = await chrome.tabs.query({
                active: true,
                currentWindow: true
            })
            if (tab?.url) {
                return new URL(tab.url).hostname
            }
        } catch (error) {
            console.error('Error getting active tab hostname:', error)
        }
        return ''
    }

    async resolveTabHostname(tabId: number): Promise<string> {
        try {
            const tab = await chrome.tabs.get(tabId)
            if (tab.url) {
                return new URL(tab.url).hostname
            }
        } catch (error) {
            console.error('Error resolving tab hostname:', error)
        }
        return ''
    }

    async updateBadgeForActiveTab() {
        const activeTabHostname = await this.getActiveTabHostname()
        await this.updateBadge(activeTabHostname)
    }

    async updateBadge(currentTabHostname: string) {
        try {
            if (!(await this.isMonitoringEnabled())) {
                chrome.action.setBadgeText({ text: '' })
                return
            }
            if (!currentTabHostname || currentTabHostname.trim() === "") {
                chrome.action.setBadgeText({ text: '' })
                return
            }
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
        if (!(await this.isMonitoringEnabled())) {
            return
        }
        const currentTabHostname = request.currentTabHostname;
        if (!currentTabHostname) {
            console.error("No current tab hostname provided for failed request:", request);
            return;
        }
        let failedRequests = this.failedRequestsByHostname.get(currentTabHostname) || []

        if (failedRequests.find(r => r.hostname === request.hostname)) {
            return
        }
        failedRequests.push(request)
        this.failedRequestsByHostname.set(currentTabHostname, failedRequests)
        await this.updateBadgeForActiveTab()
    }

    updateFailedRequestsForCurrentTab(currentTabHostname: string, hostnames: string[]) {
        const failedRequests = this.getFailedRequestsCurrentTabHostname(currentTabHostname);
        const remainingRequests = failedRequests.filter(req => !hostnames.includes(req.hostname));
        if (remainingRequests.length > 0) {
            this.failedRequestsByHostname.set(currentTabHostname, remainingRequests);
        } else {
            this.failedRequestsByHostname.delete(currentTabHostname);
        }
        this.updateBadgeForActiveTab()
    }

    /**
     * Configure selective proxy using PAC script
     * Only domains matching user rules will use proxy, others go direct
     */
    async configureSelectiveProxy() {
        const generalSettings = await generalSettingsService.getSettings();
        if (!generalSettings?.proxyEnabled) {
            await this.setDirectConnection()
            await this.updateBadgeForActiveTab()
            return
        }
        const proxyRules = await proxyRuleService.getRules();
        if (!proxyRules || proxyRules.length === 0) {
            await this.setDirectConnection()
            return
        }

        const pacScript = this.generatePacScript(generalSettings, proxyRules)
        const proxyConfig = {
            mode: "pac_script" as const,
            pacScript: {
                data: pacScript
            }
        }

        console.log('🔧 Generated PAC Script:\n', pacScript)
        console.log('🔧 Configuring selective proxy with rules:', proxyConfig)

        try {
            await chrome.proxy.settings.set({
                value: proxyConfig,
                scope: 'regular'
            })

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
            await chrome.proxy.settings.set({
                value: { mode: "direct" },
                scope: 'regular'
            })

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
     * Convert a rule pattern to a PAC condition using shExpMatch/dnsDomainIs
     */
    private ruleToPacCondition(pattern: string): string {
        if (pattern.startsWith('*.')) {
            const domain = pattern.substring(2)
            return `(host === "${domain}" || dnsDomainIs(host, ".${domain}"))`
        }
        if (pattern.includes('*') || pattern.includes('?')) {
            return `shExpMatch(host, "${pattern}")`
        }
        return `(host === "${pattern}" || dnsDomainIs(host, ".${pattern}"))`
    }

    /**
     * Generate PAC script based on current settings and rules
     */
    generatePacScript(generalSettings: GeneralSettings, proxyRules: ProxyRule[]): string {
        if (!generalSettings || !proxyRules || proxyRules.length === 0) {
            return 'function FindProxyForURL(url, host) { return "DIRECT"; }'
        }

        let proxyString = ""
        const scheme = generalSettings.proxyServerScheme.toLowerCase()
        const address = generalSettings.proxyServerAddress
        const port = generalSettings.proxyServerPort

        if (scheme === "socks5" || scheme === "socks4") {
            proxyString = `SOCKS ${address}:${port}`
        } else {
            proxyString = `PROXY ${address}:${port}`
        }

        const conditions = proxyRules.map(rule => {
            const condition = this.ruleToPacCondition(rule.pattern)
            return `if (${condition}) { return "${proxyString}"; }`
        }).join('\n    ')

        return `function FindProxyForURL(url, host) {
        if (host === 'localhost' || host === '127.0.0.1') { return "DIRECT"; }

        ${conditions}

        return "DIRECT";
    }`
    }
}

const requestMonitorService = new RequestMonitorService();
export default requestMonitorService;
