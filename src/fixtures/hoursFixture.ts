import { addDays, isWeekend } from '@/gantt/dateUtils';
import type { HoursSnapshot } from '@/types/hours';
import type { ScheduleTask, ProjectConfig } from '@/types/schedule';
import type { MemberEntry } from '@/types/settings';
import { buildTapdUrl } from '@/services/tapd/mapper';

export function createHoursFixture(today: string): { snapshot: HoursSnapshot; projects: ProjectConfig[]; members: MemberEntry[] } {
  const project = { id: 'demo', name: '演示项目', enabled: true, color: '#3b82f6' };
  const members = [{ staffId: '100', name: '张三' }, { staffId: '200', name: '李四' }];
  let first = today;
  while (isWeekend(first)) first = addDays(first, 1);
  const nextWorkday = (date: string) => { let next = addDays(date, 1); while (isWeekend(next)) next = addDays(next, 1); return next; };
  const second = nextWorkday(first), third = nextWorkday(second);
  const tasks: ScheduleTask[] = [['A',first,first,'4'],['B',first,first,'2'],['C',first,second,'6'],['D',second,second,'2'],['E',second,third,'4'],['F',third,third,'6']].map(([id,startDate,dueDate,effort]) => ({ id, sourceType: 'task', title: '任务 ' + id, projectId: project.id, projectName: project.name, projectColor: project.color, assigneeId: '100', assigneeIds: ['100'], assigneeName: '张三', startDate, dueDate, status: 'open', effort, tapdUrl: buildTapdUrl(project.id,'task',id) }));
  tasks.push({ ...tasks[0], id:'G', title:'接口联调', assigneeId:'200',assigneeIds:['200'],assigneeName:'李四',effort:'5' });
  let yesterday = addDays(today, -1);
  while(isWeekend(yesterday)) yesterday=addDays(yesterday,-1);
  return { projects: [project], members, snapshot: { tasks, records: [{ id:'actual-1',projectId:project.id,entityType:'task',entityId:'finished-1',staffId:'100',spentDate:yesterday,hours:6 },{ id:'actual-2',projectId:project.id,entityType:'task',entityId:'finished-2',staffId:'200',spentDate:yesterday,hours:8 }], issues:[],status:'complete' } };
}
