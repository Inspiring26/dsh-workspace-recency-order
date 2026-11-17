/**
 * Browser half: order the sidebar's workspace folders by the newest session
 * update inside each folder.
 *
 * The shipped sidebar browser renders its folder sections in the order of
 * `WorkspaceSnapshot.items`. There is no dedicated sorting seat, so this
 * plugin wraps the public Workspace list source (`ctx.get('workspaces').list`)
 * and returns the same snapshot with `items` stably reordered. The wrapper
 * reads the Session list source for `updatedAt` and memoizes its result by both
 * snapshot identities, so it stays a valid `useSyncExternalStore` source and
 * costs nothing while neither snapshot changes.
 *
 * A workspace-menu action pauses or resumes the automatic order for the page.
 * Pausing matters because the shipped browser's folder drag commits the manual
 * Host order; while automatic sorting is paused that drag is what the user
 * sees, so the saved order and the visible order agree. Disabling the plugin
 * restores the original source methods.
 */
window.__ModuleLoader__.load({
  id: '@weeh/dsh-workspace-recency-order',
  factory() {
    /** Sessions that the sidebar hides as rows; their updates do not move a folder. */
    const HIDDEN_ORIGIN = 'subagent'
    /** Locale namespace owned by this plugin's runtime copy. */
    const NS = 'workspaceRecencyOrder'
    const DICTS = {
      en: {
        pause: 'Pause folder auto-sort',
        resume: 'Resume folder auto-sort',
      },
      zh: {
        pause: '暂停文件夹自动排序',
        resume: '恢复文件夹自动排序',
      },
    }

    /**
     * Newest `updatedAt` among one folder's sessions.
     * @param {object} workspace - WorkspaceView from the Workspace snapshot.
     * @param {Record<string, object>} sessionById - Session summaries keyed by Session id.
     * @returns {number | undefined} epoch milliseconds, or undefined when no loaded session belongs to the folder.
     */
    function latestSessionUpdate(workspace, sessionById) {
      const ids = Array.isArray(workspace.sessionIds) ? workspace.sessionIds : []
      let latest
      for (const id of ids) {
        const session = sessionById[id]
        if (session === undefined || session === null || session.origin === HIDDEN_ORIGIN) continue
        const updatedAt = session.updatedAt
        if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) continue
        if (latest === undefined || updatedAt > latest) latest = updatedAt
      }
      return latest
    }

    /**
     * Stable comparison: newest first, folders without a loaded session last,
     * original host order breaking every tie.
     */
    function compareFolders(a, b) {
      if (a.latest === undefined && b.latest === undefined) return a.index - b.index
      if (a.latest === undefined) return 1
      if (b.latest === undefined) return -1
      if (a.latest !== b.latest) return b.latest - a.latest
      return a.index - b.index
    }

    /**
     * Reorder one Workspace snapshot without touching any other field.
     * @param {object} snapshot - WorkspaceSnapshot from the Workspace list source.
     * @param {Record<string, object>} sessionById - Session summaries keyed by Session id.
     * @returns {object} the original snapshot when the order is already correct, else a reordered copy.
     */
    function orderWorkspaces(snapshot, sessionById) {
      const items = Array.isArray(snapshot.items) ? snapshot.items : []
      if (items.length < 2) return snapshot
      const ranked = items.map((workspace, index) => ({
        workspace,
        index,
        latest: latestSessionUpdate(workspace, sessionById),
      }))
      ranked.sort(compareFolders)
      let changed = false
      for (let index = 0; index < ranked.length; index += 1) {
        if (ranked[index].workspace !== items[index]) {
          changed = true
          break
        }
      }
      if (!changed) return snapshot
      return { ...snapshot, items: ranked.map(entry => entry.workspace) }
    }

    /** One page-local boolean source so the menu reflects pause/resume without a page reload. */
    function createToggleStore(initial) {
      let enabled = initial
      const listeners = new Set()
      return {
        getSnapshot: () => enabled,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        set: (next) => {
          if (next === enabled) return
          enabled = next
          for (const listener of [...listeners]) {
            try {
              listener()
            } catch (error) {
              console.warn('[workspace-recency-order] toggle listener failed:', error)
            }
          }
        },
      }
    }

    return {
      inject: ['workspaces', 'sessions', 'contextMenus', 'locale'],
      apply(ctx) {
        const workspaces = ctx.get('workspaces')
        const sessions = ctx.get('sessions')
        if (workspaces?.list === undefined || sessions?.list === undefined) return
        const source = workspaces.list
        const sessionSource = sessions.list
        if (typeof source.getSnapshot !== 'function' || typeof source.subscribe !== 'function'
          || typeof sessionSource.getSnapshot !== 'function') return

        const enabled = createToggleStore(true)
        let notifyWorkspaceSubscribers = () => {}

        // Patch the public Workspace source for this plugin's lifetime. The
        // plugin owns the installed wrapper; a foreign replacement is left alone.
        ctx.effect(() => {
          const originalGetSnapshot = source.getSnapshot
          const originalSubscribe = source.subscribe
          const hadOwnGetSnapshot = Object.prototype.hasOwnProperty.call(source, 'getSnapshot')
          const hadOwnSubscribe = Object.prototype.hasOwnProperty.call(source, 'subscribe')
          const tracked = new Set()
          let cachedWorkspaceSnapshot
          let cachedSessionSnapshot
          let cachedResult

          const sortedGetSnapshot = function getSnapshot() {
            const workspaceSnapshot = originalGetSnapshot.call(source)
            if (!enabled.getSnapshot()) return workspaceSnapshot
            const sessionSnapshot = sessionSource.getSnapshot()
            if (workspaceSnapshot === cachedWorkspaceSnapshot && sessionSnapshot === cachedSessionSnapshot) {
              return cachedResult
            }
            const result = orderWorkspaces(workspaceSnapshot, sessionSnapshot?.byId ?? {})
            cachedWorkspaceSnapshot = workspaceSnapshot
            cachedSessionSnapshot = sessionSnapshot
            cachedResult = result
            return result
          }

          const trackedSubscribe = function subscribe(listener) {
            if (typeof listener !== 'function') return originalSubscribe.call(source, listener)
            let active = true
            const wrapped = () => {
              if (!active) return
              listener()
            }
            tracked.add(wrapped)
            const unsubscribe = originalSubscribe.call(source, wrapped)
            return () => {
              if (!active) return
              active = false
              tracked.delete(wrapped)
              if (typeof unsubscribe === 'function') unsubscribe()
            }
          }

          notifyWorkspaceSubscribers = () => {
            for (const listener of [...tracked]) {
              try {
                listener()
              } catch (error) {
                console.warn('[workspace-recency-order] workspace listener failed:', error)
              }
            }
          }

          source.getSnapshot = sortedGetSnapshot
          source.subscribe = trackedSubscribe
          const installed = source.getSnapshot === sortedGetSnapshot && source.subscribe === trackedSubscribe
          if (!installed) {
            if (source.getSnapshot === sortedGetSnapshot) {
              if (hadOwnGetSnapshot) source.getSnapshot = originalGetSnapshot
              else delete source.getSnapshot
            }
            if (source.subscribe === trackedSubscribe) {
              if (hadOwnSubscribe) source.subscribe = originalSubscribe
              else delete source.subscribe
            }
            notifyWorkspaceSubscribers = () => {}
            console.warn('[workspace-recency-order] could not wrap the Workspace list source; no reordering applied')
            return () => {}
          }

          return () => {
            if (source.getSnapshot === sortedGetSnapshot) {
              if (hadOwnGetSnapshot) source.getSnapshot = originalGetSnapshot
              else delete source.getSnapshot
            }
            if (source.subscribe === trackedSubscribe) {
              if (hadOwnSubscribe) source.subscribe = originalSubscribe
              else delete source.subscribe
            }
            tracked.clear()
            notifyWorkspaceSubscribers = () => {}
          }
        }, 'workspace-recency-order: workspace source')

        // Optional locale seat for the workspace-menu action. A missing locale
        // service leaves the English fallback in place; sorting is unaffected.
        let translate = key => DICTS.en[key]
        const locale = ctx.get('locale')
        if (locale !== undefined && typeof locale.register === 'function' && typeof locale.bind === 'function') {
          ctx.effect(() => {
            let dispose = () => {}
            try {
              dispose = locale.register(NS, DICTS)
              const bound = locale.bind(NS)
              if (typeof bound === 'function') translate = key => bound(key)
            } catch (error) {
              console.warn('[workspace-recency-order] locale registration failed; keeping English menu copy:', error)
            }
            return () => {
              translate = key => DICTS.en[key]
              if (typeof dispose === 'function') dispose()
            }
          }, 'workspace-recency-order: locale')
        }

        // Optional workspace context-menu entry: a real control at the point
        // where manual workspace order is managed. The entry reflects the
        // page-local pause state, and the shipped drag keeps working whenever
        // automatic sorting is paused.
        const contextMenus = ctx.get('contextMenus')
        if (contextMenus !== undefined && typeof contextMenus.register === 'function') {
          ctx.effect(() => contextMenus.register({
            id: 'workspace-recency-order.toggle',
            target: 'workspace',
            order: 900,
            observe: () => locale !== undefined && typeof locale.getSnapshot === 'function'
              ? [enabled, locale]
              : [enabled],
            resolve: () => {
              const on = enabled.getSnapshot()
              return [{
                id: 'workspace-recency-order.toggle',
                label: translate(on ? 'pause' : 'resume'),
                run: () => {
                  enabled.set(!enabled.getSnapshot())
                  notifyWorkspaceSubscribers()
                },
              }]
            },
          }), 'workspace-recency-order: workspace menu action')
        }
      },
    }
  },
})
