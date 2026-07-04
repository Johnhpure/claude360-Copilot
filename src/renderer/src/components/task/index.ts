/**
 * 跨工作台任务 Feature 组件出口（阶段4 落地，父任务 07-03-oneui-redesign §4.8）。
 *
 * TaskCard 带业务语义（生成任务），按分层规约独立落位 components/task/
 * 而非 components/ui/（ui/ 只放消费 token 的原子）。chat / canvas / music 共用。
 */
export { TaskCard } from './TaskCard'
export type { TaskCardStatus } from './TaskCard'
