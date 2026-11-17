/**
 * Node-level checks for the browser half's pure ordering, source wrapper, and
 * optional workspace-menu control.
 * The bundle file registers itself through a global module loader, so the test
 * evaluates it in a VM with a minimal loader stand-in; no browser is needed.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import vm from 'node:vm'

const bundlePath = fileURLToPath(new URL('../client.js', import.meta.url))
const bundleCode = readFileSync(bundlePath, 'utf8')

function loadBundle() {
  let registration
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(specification) {
          registration = specification
        },
      },
    },
  }
  vm.runInNewContext(bundleCode, sandbox, { filename: bundlePath })
  assert.equal(registration.id, '@weeh/dsh-workspace-recency-order')
  return registration.factory()
}

function workspace(id, sessionIds) {
  return { workspaceId: id, path: `/tmp/${id}`, title: id, sessionIds }
}

function session(id, updatedAt, extra = {}) {
  return { id, updatedAt, blank: false, ...extra }
}

function createSources(items, byId) {
  let workspaceSnapshot = { items, archivedSessionIds: [], pinnedSessionIds: [], state: 'ready', phase: 'ready', error: null }
  let sessionSnapshot = { ids: Object.keys(byId), byId, phase: 'ready' }
  const workspaceListeners = new Set()
  const workspaceSource = {
    getSnapshot: () => workspaceSnapshot,
    subscribe: (listener) => {
      workspaceListeners.add(listener)
      return () => { workspaceListeners.delete(listener) }
    },
  }
  const sessionSource = {
    getSnapshot: () => sessionSnapshot,
    subscribe: () => () => {},
  }
  return {
    workspaces: { list: workspaceSource },
    sessions: { list: sessionSource },
    workspaceListeners,
    setWorkspaces(next) {
      workspaceSnapshot = next
    },
    setSessions(next) {
      sessionSnapshot = next
    },
    workspaceSource,
  }
}

function createContext(workspaces, sessions, extras = {}) {
  const cleanups = []
  return {
    ctx: {
      get(name) {
        if (name === 'workspaces') return workspaces
        if (name === 'sessions') return sessions
        if (name === 'locale') return extras.locale
        if (name === 'contextMenus') return extras.contextMenus
        return undefined
      },
      effect(callback) {
        const cleanup = callback()
        if (typeof cleanup === 'function') cleanups.push(cleanup)
      },
    },
    dispose() {
      for (const cleanup of cleanups.reverse()) cleanup()
    },
  }
}

function createContextMenus() {
  const contributions = []
  const disposals = []
  return {
    register(contribution) {
      contributions.push(contribution)
      const dispose = () => {
        const index = contributions.indexOf(contribution)
        if (index !== -1) contributions.splice(index, 1)
        disposals.push(contribution.id)
      }
      return dispose
    },
    contributions,
    disposals,
  }
}

function createLocale() {
  const dictionaries = new Map()
  return {
    register(namespace, dicts) {
      dictionaries.set(namespace, dicts)
      return () => dictionaries.delete(namespace)
    },
    bind(namespace) {
      return key => dictionaries.get(namespace)?.en?.[key] ?? key
    },
    getSnapshot: () => ({ active: 'en', revision: 0 }),
  }
}

test('orders folders by newest session update, newest first', () => {
  const plugin = loadBundle()
  const sources = createSources(
    [workspace('a', ['s1']), workspace('b', ['s2']), workspace('c', ['s3'])],
    {
      s1: session('s1', 100),
      s2: session('s2', 300),
      s3: session('s3', 200),
    },
  )
  const { ctx } = createContext(sources.workspaces, sources.sessions)
  plugin.apply(ctx)

  const ordered = sources.workspaceSource.getSnapshot()
  assert.deepEqual(ordered.items.map(item => item.workspaceId), ['b', 'c', 'a'])
  // Other fields survive the reorder.
  assert.equal(ordered.phase, 'ready')
  assert.equal(ordered.archivedSessionIds.length, 0)
})

test('returns a stable identity for unchanged inputs and refreshes with sessions', () => {
  const plugin = loadBundle()
  const sources = createSources(
    [workspace('a', ['s1']), workspace('b', ['s2'])],
    { s1: session('s1', 100), s2: session('s2', 300) },
  )
  const { ctx } = createContext(sources.workspaces, sources.sessions)
  plugin.apply(ctx)

  const first = sources.workspaceSource.getSnapshot()
  assert.equal(sources.workspaceSource.getSnapshot(), first, 'repeat reads reuse the memoized snapshot')

  sources.setSessions({
    ids: ['s1', 's2'],
    byId: { s1: session('s1', 400), s2: session('s2', 300) },
    phase: 'ready',
  })
  const second = sources.workspaceSource.getSnapshot()
  assert.notEqual(second, first)
  assert.deepEqual(second.items.map(item => item.workspaceId), ['a', 'b'])
})

test('uses the newest session in a folder, ignores subagents, and keeps ties stable', () => {
  const plugin = loadBundle()
  const sources = createSources(
    [workspace('a', ['old', 'new']), workspace('b', ['tie']), workspace('c', ['child'])],
    {
      old: session('old', 50),
      new: session('new', 200),
      tie: session('tie', 200),
      child: session('child', 900, { origin: 'subagent' }),
    },
  )
  const { ctx } = createContext(sources.workspaces, sources.sessions)
  plugin.apply(ctx)

  const ordered = sources.workspaceSource.getSnapshot()
  assert.deepEqual(ordered.items.map(item => item.workspaceId), ['a', 'b', 'c'])
})

test('keeps folders without a loaded session last in host order', () => {
  const plugin = loadBundle()
  const sources = createSources(
    [workspace('empty-1', []), workspace('active', ['s1']), workspace('empty-2', ['missing'])],
    { s1: session('s1', 100) },
  )
  const { ctx } = createContext(sources.workspaces, sources.sessions)
  plugin.apply(ctx)

  const ordered = sources.workspaceSource.getSnapshot()
  assert.deepEqual(ordered.items.map(item => item.workspaceId), ['active', 'empty-1', 'empty-2'])
})

test('returns the original snapshot when the host order is already correct', () => {
  const plugin = loadBundle()
  const sources = createSources(
    [workspace('a', ['s1']), workspace('b', ['s2'])],
    { s1: session('s1', 300), s2: session('s2', 100) },
  )
  const original = sources.workspaceSource.getSnapshot()
  const { ctx } = createContext(sources.workspaces, sources.sessions)
  plugin.apply(ctx)

  assert.equal(sources.workspaceSource.getSnapshot(), original)
})

test('keeps the host snapshot identity when session changes do not change the order', () => {
  const plugin = loadBundle()
  const sources = createSources(
    [workspace('a', ['s1']), workspace('b', ['s2'])],
    { s1: session('s1', 300), s2: session('s2', 100) },
  )
  const original = sources.workspaceSource.getSnapshot()
  const { ctx } = createContext(sources.workspaces, sources.sessions)
  plugin.apply(ctx)

  const first = sources.workspaceSource.getSnapshot()
  assert.equal(first, original, 'already-correct host order stays the original object')

  sources.setSessions({
    ids: ['s1', 's2'],
    byId: { s1: session('s1', 301), s2: session('s2', 101) },
    phase: 'ready',
  })
  assert.equal(sources.workspaceSource.getSnapshot(), original, 'a session refresh without an order change stays stable')
})

test('does nothing when the services are absent', () => {
  const plugin = loadBundle()
  const { ctx } = createContext(undefined, undefined)
  assert.doesNotThrow(() => plugin.apply(ctx))
})

test('workspace menu action pauses and resumes the automatic order', () => {
  const plugin = loadBundle()
  const sources = createSources(
    [workspace('a', ['s1']), workspace('b', ['s2'])],
    { s1: session('s1', 100), s2: session('s2', 300) },
  )
  const contextMenus = createContextMenus()
  const locale = createLocale()
  const { ctx } = createContext(sources.workspaces, sources.sessions, { contextMenus, locale })
  plugin.apply(ctx)

  assert.equal(contextMenus.contributions.length, 1)
  const contribution = contextMenus.contributions[0]
  assert.equal(contribution.target, 'workspace')
  const observed = contribution.observe()
  assert.equal(observed.length, 2)
  assert.equal(observed[0].getSnapshot(), true)
  assert.equal(observed[1], locale)

  let action = contribution.resolve()[0]
  assert.equal(action.label, 'Pause folder auto-sort')
  assert.deepEqual(sources.workspaceSource.getSnapshot().items.map(item => item.workspaceId), ['b', 'a'])

  let notifications = 0
  const unsubscribe = sources.workspaceSource.subscribe(() => { notifications += 1 })
  action.run()
  assert.equal(notifications, 1, 'pausing notifies current workspace subscribers')
  assert.deepEqual(sources.workspaceSource.getSnapshot().items.map(item => item.workspaceId), ['a', 'b'])

  action = contribution.resolve()[0]
  assert.equal(action.label, 'Resume folder auto-sort')
  action.run()
  assert.equal(notifications, 2)
  assert.deepEqual(sources.workspaceSource.getSnapshot().items.map(item => item.workspaceId), ['b', 'a'])
  unsubscribe()
})

test('restores the original source methods and menu when the plugin is disposed', () => {
  const plugin = loadBundle()
  const sources = createSources(
    [workspace('a', ['s1']), workspace('b', ['s2'])],
    { s1: session('s1', 100), s2: session('s2', 300) },
  )
  const originalGetSnapshot = sources.workspaceSource.getSnapshot
  const originalSubscribe = sources.workspaceSource.subscribe
  const contextMenus = createContextMenus()
  const locale = createLocale()
  const { ctx, dispose } = createContext(sources.workspaces, sources.sessions, { contextMenus, locale })
  plugin.apply(ctx)
  assert.notEqual(sources.workspaceSource.getSnapshot, originalGetSnapshot)
  assert.notEqual(sources.workspaceSource.subscribe, originalSubscribe)
  assert.equal(contextMenus.contributions.length, 1)

  dispose()
  assert.equal(sources.workspaceSource.getSnapshot, originalGetSnapshot)
  assert.equal(sources.workspaceSource.subscribe, originalSubscribe)
  assert.equal(contextMenus.contributions.length, 0)
  assert.equal(originalGetSnapshot().items.length, 2)
})
