import { describe, expect, it } from 'vitest';
import { normalizeSettings } from '@/types/settings';
import { createHoursSettings, normalizeHoursSettings, validateHoursSettings } from './settings';
describe('工时配置兼容',()=>{
 it('v1配置保留项目成员并增加默认8h',()=>{const {settings}=normalizeSettings({schemaVersion:1,projects:[{id:'p',name:'项目',enabled:true}],members:[{staffId:'100',name:'甲'}]});expect(settings.schemaVersion).toBe(3);expect(settings.hours).toEqual(createHoursSettings());expect(settings.chinaCalendar).toEqual({enabled:false,years:{}});expect(settings.projects[0].enabled).toBe(true);expect(settings.members[0].staffId).toBe('100');});
 it.each([0,-1,Infinity,'bad',null,true])('损坏目标 %s 回退8h',value=>{expect(normalizeHoursSettings({dailyRequiredHours:value}).dailyRequiredHours).toBe(8);});
 it('旧手动日期全部忽略，豁免合法条目保留',()=>{const settings=normalizeHoursSettings({calendarOverrides:[null,{date:'oops'}, {date:'2026-10-10',working:true}],exemptions:[{}, {staffId:'100',date:'2026-10-14'}]});expect(settings).not.toHaveProperty('calendarOverrides');expect(settings.exemptions).toEqual([{staffId:'100',date:'2026-10-14',note:''}]);});
 it('正小数目标合法，空状态和无效日期不合法',()=>{expect(validateHoursSettings({...createHoursSettings(),dailyRequiredHours:7.5})).toBe('');expect(validateHoursSettings({...createHoursSettings(),completedStates:[{projectId:'p',type:'task',values:[]}]})).toContain('结束状态');expect(validateHoursSettings({...createHoursSettings(),exemptions:[{staffId:'100',date:'invalid',note:''}]})).toContain('豁免');});
});
