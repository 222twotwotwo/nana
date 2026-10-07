import { defineStore } from 'pinia'

/** 数据变更版本号：收藏/导入/删除等操作后 bump，驱动主页/书库/音乐列表刷新 */
export const useLibStore = defineStore('lib', {
  state: () => ({ rev: 0 }),
  actions: {
    bump() { this.rev++ }
  }
})
