# 工作区最近更新排序

左侧工作区文件夹按各自内部会话的**最近更新时间**排列：最近有会话更新的文件夹排在最前，其余按时间依次向下。

- GitHub：https://github.com/Inspiring26/dsh-workspace-recency-order
- npm：https://www.npmjs.com/package/@weeh/dsh-workspace-recency-order

## 安装

```sh
npm install @weeh/dsh-workspace-recency-order
```

或者用 DSH CLI 安装到当前 profile：

```sh
dsh plugin --profile web add @weeh/dsh-workspace-recency-order@0.1.0
```

安装后刷新页面。开发目录里同时保留着 `@local/workspace-recency-order` 的本地链接；不要和 npm 版本同时启用，两者会包装同一个工作区列表源。

## 行为

- 统计一个文件夹内所有非子代理会话的 `updatedAt`，取其中最大值作为该文件夹的排序键。
- 子代理会话不计入，因此后台子任务的更新不会让文件夹跳位。
- 已归档会话仍然计入；这样在“隐藏已归档 / 全部对话 / 仅显示已归档”之间切换时，文件夹顺序保持稳定。
- 当前空白新会话也计入，新建工作区或新会话通常会让对应文件夹立即升到前面。
- 没有任何已加载会话的文件夹保留 DSH 宿主顺序，并统一排在末尾。
- 时间相同时保留宿主顺序。
- 支持“按工作区”和“按工作区树”两种分组；平铺会话列表没有文件夹，不受影响。
- 会话新建或更新后，排序随会话列表变化刷新；启用插件即生效，无需配置。如果当前页面在启用后没有立即变化，刷新一次页面即可。

## 与内置控件的关系

- 视图选项里的 **手动 / 最近更新** 只决定**文件夹内会话行**的顺序，不决定文件夹顺序；文件夹顺序始终由本插件负责。
- 文件夹的“...”菜单新增 **暂停文件夹自动排序 / 恢复文件夹自动排序**。暂停后显示 DSH 宿主的手动顺序，此时拖动文件夹会保持你放置的位置；恢复后重新按最近会话排序。暂停状态只在当前页面有效，刷新页面后恢复为自动排序。
- 自动排序期间拖动文件夹，DSH 仍会写入并保存手动顺序，但当前显示会继续按最近会话排序，因此看起来会弹回原位。需要手动排序时，请先在文件夹菜单中选择暂停。
- 工作区选择器读取同一份工作区列表，因此打开时显示相同顺序；它只在工作区变化时更新，打开期间不会因会话更新时间变化而实时重排。

## 限制

- 插件只在浏览器端计算并显示顺序，不写入工作区注册表，也不修改任何会话或目录。
- 树形分组下，每个文件夹按**自己的**会话排序；子文件夹的活跃程度不会抬高其父级。
- 本插件依赖 DSH 公开的 Workspace 列表源（`workspaces.list`）来注入显示顺序；当前未提供专门的“文件夹排序”扩展点。实现按 DSH `0.2.2-rc.2` 验证，升级 DSH 后若排序失效，请检查该列表源的方法是否仍然可包装。
- 没有任何可见的时间戳标注文件夹的排序键；可以在会话行看到各自的更新时间。

## 关闭插件

在 **设置 → 插件** 中停用 **Workspace recency order**，工作区文件夹恢复 DSH 内置的宿主顺序。停用会移除浏览器端的列表包装，不需要重启；如果页面没有立即变化，刷新一次即可。

如果暂停/恢复后文件夹没有立即变化，也请刷新一次页面。

## English

Sorts the sidebar's workspace folders by the newest session update inside each folder, newest first. Subagent sessions are ignored; archived and current blank sessions count; folders without a loaded session keep their host order and go last.

The workspace "..." menu offers **Pause folder auto-sort** / **Resume folder auto-sort**. While paused, the sidebar shows DSH's saved manual order, so dragging a folder stays where you drop it. While automatic sorting is active, a folder drag still writes the saved manual order but does not change the visible order; pause the automatic sort first if you want to reorder by hand.

The View options "Manual / Updated" choice only orders session rows inside a folder, not the folders themselves. The workspace picker reads the same sorted list when it opens, but it does not re-sort live while open. The plugin computes the order in the browser only and does not persist it. It relies on DSH's public Workspace list source and was verified against DSH `0.2.2-rc.2`.

