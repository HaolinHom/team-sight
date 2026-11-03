import type { DateRange, HoursSettings, HoursSnapshot, MemberEntry, ProjectConfig } from '@teamsight/core';
import { TapdClient } from './client.js';
export interface HoursQuery {
    projects: readonly ProjectConfig[];
    members: readonly MemberEntry[];
    range: DateRange;
    today: string;
    settings: HoursSettings;
    credentialRevision?: number;
    accountIdentities?: boolean;
}
export interface HoursLoadOptions {
    signal?: AbortSignal;
    onProgress?: (progress: {
        stage: string;
        completed: number;
        total: number;
    }) => void;
}
/** 按已配置成员查询工作项，完整覆盖跨窗、缺日期、逾期任务，不扫描项目全量工作项。 */
export declare function fetchHoursSnapshot(query: HoursQuery, client: TapdClient, options?: HoursLoadOptions): Promise<HoursSnapshot>;
