/**
 * Host half of the workspace-recency-order bundle.
 *
 * The display order is computed in the browser from Workspace and Session
 * snapshots that the Client already holds, so the Host contributes no
 * service, RPC, or persisted state. This half exists because every bundle row
 * is a Host loader entry.
 */
export function apply() {}
