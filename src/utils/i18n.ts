/**
 * Internationalization utility functions
 * For handling multi-language support in browser extensions
 */

/**
 * Get internationalized text
 * @param key Translation key name
 * @param replacements Placeholder replacement object
 * @returns Translated text
 */
export const t = (key: string, replacements?: Record<string, string>): string => {
    try {
        let message = chrome.i18n.getMessage(key)

        // If no translation found, output warning and return key name
        if (!message) {
            console.warn(`Missing translation for key: ${key}`)
            return key
        }

        // Handle placeholder replacement
        if (replacements) {
            Object.keys(replacements).forEach((placeholder) => {
                message = message.replace(`{${placeholder}}`, replacements[placeholder])
            })
        }

        return message
    } catch (error) {
        console.error(`Error getting translation for key: ${key}`, error)
        return key
    }
}

/**
 * Get current language environment
 * @returns Current language code
 */
export const getCurrentLanguage = (): string => {
    try {
        return chrome.i18n.getUILanguage()
    } catch (error) {
        console.error('Error getting current language:', error)
        return 'en'
    }
}

/**
 * Check if current environment is Chinese
 * @returns Whether it's Chinese
 */
export const isChinese = (): boolean => {
    const lang = getCurrentLanguage()
    return lang.startsWith('zh')
}

/**
 * Batch get translations
 * @param keys Array of translation key names
 * @returns Translation result object
 */
export const getTranslations = (keys: string[]): Record<string, string> => {
    const translations: Record<string, string> = {}

    keys.forEach(key => {
        translations[key] = t(key)
    })

    return translations
}

/**
 * Format numbers (based on language environment)
 * @param num Number
 * @returns Formatted number string
 */
export const formatNumber = (num: number): string => {
    const lang = getCurrentLanguage()
    try {
        return new Intl.NumberFormat(lang).format(num)
    } catch (error) {
        return num.toString()
    }
}

/**
 * Format date (based on language environment)
 * @param date Date object
 * @returns Formatted date string
 */
export const formatDate = (date: Date): string => {
    const lang = getCurrentLanguage()
    try {
        return new Intl.DateTimeFormat(lang).format(date)
    } catch (error) {
        return date.toLocaleDateString()
    }
}
