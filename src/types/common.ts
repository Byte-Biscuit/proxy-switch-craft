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

// Storage key name constants
export const STORAGE_KEYS = {
    GENERAL_SETTINGS: 'generalSettings',
    PROXY_RULES: 'proxyRules'
} as const

// Proxy protocol types
export type ProxyScheme = 'http' | 'https' | 'socks4' | 'socks5'

// Supported proxy protocol list
export const PROXY_SCHEMES: ProxyScheme[] = ['http', 'https', 'socks4', 'socks5']
