/**
 * Get current active tab's hostname
 */
export async function getCurrentTabHostname(): Promise<string | null> {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        if (tab?.url) {
            const url = new URL(tab.url)
            console.log("Current tab URL:", tab.url, "Hostname:", url.hostname);
            return url.hostname
        }
    } catch (error) {
        console.error('Error getting current tab hostname:', error)
    }
    return null
}