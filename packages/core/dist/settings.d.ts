import type { TeamSightSettings } from './types.js';
export declare const SETTINGS_SCHEMA_VERSION = 4;
export declare const DEFAULT_TAPD_BASE_URL = "https://api.tapd.cn";
export declare function createDefaultSettings(now?: Date): TeamSightSettings;
export declare function normalizeSettings(raw: unknown, now?: Date): {
    settings: TeamSightSettings;
    warning?: string;
};
/** 读取旧 App 的 settings.json，只迁移业务配置；凭据字段永不进入 SQLite。 */
export declare function importLegacySettings(raw: unknown, now?: Date): {
    settings: TeamSightSettings;
    ignoredCredential: boolean;
    warning?: string;
};
