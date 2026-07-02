import type { GeneralSettings } from '~types/common'
import { STORAGE_KEYS } from "~types/common"
import {
    localStorage
} from "~utils/storage"

const DEFAULT_SETTINGS: GeneralSettings = {
    responseTimeThreshold: 5000,
    proxyServerAddress: "",
    proxyServerPort: 8080,
    proxyServerScheme: "http",
    proxyUsername: "",
    proxyPassword: "",
    proxyEnabled: false,
}

class GeneralSettingsService {
    async getSettings(): Promise<GeneralSettings> {
        const settings = await localStorage.get<GeneralSettings>(
            STORAGE_KEYS.GENERAL_SETTINGS
        )
        return {
            ...DEFAULT_SETTINGS,
            ...settings,
            proxyEnabled: settings?.proxyEnabled === true,
        }
    }

    async saveSettings(settings: GeneralSettings) {
        await localStorage.set(
            STORAGE_KEYS.GENERAL_SETTINGS,
            settings
        )
    }
}
const generalSettingsService = new GeneralSettingsService();
export default generalSettingsService;