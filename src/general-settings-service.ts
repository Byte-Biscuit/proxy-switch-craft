import type { GeneralSettings } from '~types/common'
import { STORAGE_KEYS } from "~types/common"
import {
    localStorage
} from "~utils/storage"
class GeneralSettingsService {
    async getSettings(): Promise<GeneralSettings | null> {
        return await localStorage.get<GeneralSettings>(
            STORAGE_KEYS.GENERAL_SETTINGS
        )
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