import type { ProxyRule } from './types/common'
import { getProxyRules, saveProxyRules } from "~utils/storage"
class ProxyRuleService {
    /**static */
    private static readonly IPV4PATTERN = /^(\d{1,3}\.){3}\d{1,3}$/

    /**
     * toWildcardDomain
     * Convert a hostname to a wildcard domain
     * www.example.com -> *.example.com
     * aa.bb.cc.example.com -> *.bb.cc.example.com
     * IP addresses (IPv4/IPv6) are returned as-is
     * @param hostname 
     * @returns 
     */
    formatPattern(url: string): string {
        const hostname = new URL(url).hostname
        if (ProxyRuleService.IPV4PATTERN.test(hostname)) {
            return hostname
        }
        // Check if it's an IPv6 address (surrounded by brackets in URL, but hostname won't have them)
        if (hostname.includes(':') || hostname.startsWith('[')) {
            return hostname
        }
        const parts = hostname.split(".")
        if (parts.length <= 2) return hostname
        parts[0] = "*"
        return parts.join(".")
    }

    /**
     * Check if a URL matches any proxy rule
     * Uses wildcard matching to check if URL should use proxy
     * @param url - Full URL to check
     * @returns true if URL matches any rule, false otherwise
     */
    async isInRules(url: string): Promise<boolean> {
        const proxyRules = await this.getRules()
        if (!proxyRules || proxyRules.length === 0) {
            return false
        }
        const pattern = this.formatPattern(url);
        return proxyRules.some(rule => rule.pattern === pattern)
    }

    async addRule(rule: ProxyRule): Promise<ProxyRule[]> {
        const proxyRules = await this.getRules()
        // Check if pattern already exists
        const exists = proxyRules.some(r => r.pattern === rule.pattern)
        if (!exists) {
            proxyRules.push(rule)
            await this.saveRules(proxyRules)
        }
        return proxyRules
    }

    async addRules(rules: ProxyRule[]): Promise<ProxyRule[]> {
        const proxyRules = await this.getRules()
        const existingPatterns = new Set(proxyRules.map(r => r.pattern))

        const newRules = rules.filter(rule => !existingPatterns.has(rule.pattern))

        if (newRules.length > 0) {
            proxyRules.push(...newRules)
            await this.saveRules(proxyRules)
        }

        return proxyRules
    }

    async getRules(): Promise<ProxyRule[]> {
        return await getProxyRules();
    }

    async updateProxyRule(ruleId: string, updatedRule: Partial<ProxyRule>): Promise<boolean> {
        const proxyRules = await this.getRules()
        const index = proxyRules.findIndex(rule => rule.id === ruleId)
        if (index !== -1) {
            proxyRules[index] = {
                ...proxyRules[index],
                ...updatedRule,
                id: ruleId // Ensure ID cannot be changed
            }
            await this.saveRules(proxyRules)
            return true
        }
        return false
    }

    async deleteRule(ruleId: string): Promise<ProxyRule[]> {
        const proxyRules = await this.getRules()
        const updatedRules = proxyRules.filter(rule => rule.id !== ruleId)
        if (updatedRules.length !== proxyRules.length) {
            await this.saveRules(updatedRules)
        }
        return updatedRules
    }

    async saveRules(rules: ProxyRule[]) {
        await saveProxyRules(rules)
    }

}
const proxyRuleService = new ProxyRuleService()
export default proxyRuleService