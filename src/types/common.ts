// Common type definitions file

export interface GeneralSettings {
    responseTimeThreshold: number
    proxyServerAddress: string
    proxyServerPort: number
    proxyServerScheme: string
    proxyUsername: string
    proxyPassword: string
}

export interface ProxyRule {
    id: string
    pattern: string
}

// Proxy configuration related types
export interface ProxyConfig {
    mode: "fixed_servers" | "direct"
    rules?: {
        singleProxy?: {
            scheme: string
            host: string
            port: number
        }
    }
}

export interface PendingRequest {
    requestId: string
    url: string
    hostname: string
    currentTabHostname: string
    startTime: number
}

// Monitoring state for network failures
export interface FailedRequest {
    url: string
    hostname: string
    currentTabHostname: string
    responseTime?: number
    error?: string
    timestamp: number
    status?: number
}

// Storage key name constants
export const STORAGE_KEYS = {
    GENERAL_SETTINGS: 'generalSettings',
    PROXY_RULES: 'proxyRules'
} as const
// Number of chunks to split proxy rules into for storage
export const PROXY_RULES_CHUNK_COUNT = 50

// Proxy protocol types
export type ProxyScheme = 'http' | 'https' | 'socks4' | 'socks5'

// Supported proxy protocol list
export const PROXY_SCHEMES: ProxyScheme[] = ['http', 'https', 'socks4', 'socks5']

