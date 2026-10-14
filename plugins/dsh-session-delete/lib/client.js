/**
 * dsh-session-delete — browser half.
 *
 * One surface: a "Delete session" row in the Session row's "..." menu, plus the
 * confirmation dialog that answers it.
 *
 * Why the menu slot instead of DOM work: ui-workspace declares its session-row
 * actions as slot entries — the shipped Pin, Rename, Fork and Archive entries
 * are registered exactly the way a plugin's are — so this plugin registers into
 * `sidebar.workspaces.session.menu.item` with an order after Archive (400) and
 * inherits the menu's styling, keyboard walk and positioning. The entry
 * receives the row identity (`sessionId`, `displayTitle`) and nothing else; it
 * reads no other plugin's DOM.
 *
 * Why the clip is a dialog and not a native confirm: deletion is permanent, so
 * the sentence that says so belongs in the host's own surface. The dialog is a
 * `shell.overlay` entry driven by this plugin's snapshot store, the same shape
 * the shipped archive confirmation uses.
 *
 * After the Host removes the log, `ctx.sessions.refresh()` re-pulls the Session
 * baseline, so the row disappears without a page reload.
 *
 * @module dsh-session-delete/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-session-delete',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { createSnapshotStore } = require('@deepseek-ai/dsh-client-store')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = React.createElement

    /** Locale namespace for this plugin's copy; also the slot registrations' `locale`. */
    const NS = 'session-delete'

    /** Host route that performs the deletion. */
    const DELETE_ROUTE = '/dsh-session-delete/delete'

    /** Copy, in the shape `ctx.locale.register` takes. */
    const zh = {
      'menu.delete': '删除会话',
      'confirm.title': '删除会话',
      'confirm.desc': '将彻底删除「{title}」的会话记录，包括它的子代理会话，并从工作区里移除。此操作不可恢复。',
      'confirm.action': '删除',
      'confirm.pending': '正在删除…',
      'cancel': '取消',
      'close': '关闭',
      'failed.running': '这个会话正在运行，先停止它再删除。',
      'failed.open': '这个会话还开在本机，等它释放之后再删。',
      'failed.unknown': '这个会话已经不在磁盘上了。',
      'failed.refused': '本机拒绝了这次请求。',
      'failed.partial': '部分数据未能删除，请重试或检查文件权限。',
      'failed.generic': '删除失败，请重试。',
    }
    const en = {
      'menu.delete': 'Delete session',
      'confirm.title': 'Delete session',
      'confirm.desc': 'This permanently deletes “{title}” — including its subagent sessions — and removes it from the workspace. It cannot be undone.',
      'confirm.action': 'Delete',
      'confirm.pending': 'Deleting…',
      'cancel': 'Cancel',
      'close': 'Close',
      'failed.running': 'This session is running. Stop it first, then delete it.',
      'failed.open': 'This session is still open on this machine. Delete it once it is released.',
      'failed.unknown': 'This session is no longer on disk.',
      'failed.refused': 'This machine refused the request.',
      'failed.partial': 'Part of the data could not be removed. Retry, or check file permissions.',
      'failed.generic': 'Deletion failed. Try again.',
    }

    /** Stylesheet for the confirm dialog's one plugin-owned accent. */
    const STYLESHEET = `
.dsh-session-delete-danger { color: var(--dsw-alias-state-error-primary, currentColor); }
.dsh-session-delete-body { display: flex; flex-direction: column; gap: 8px; }
.dsh-session-delete-note { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.dsh-session-delete-status { color: var(--dsw-alias-label-secondary, currentColor); font-size: 12px; line-height: 18px; }
.dsh-session-delete-error { color: var(--dsw-alias-state-error-primary, currentColor); font-size: 12px; line-height: 18px; }
`

    /** The pending confirmation: `{ sessionId, displayTitle }`, or `null` when closed. */
    const requestStore = createSnapshotStore(null)

    /** One reason phrase per Host refusal. */
    function messageFor(payload, t) {
      const reason = payload !== null && typeof payload === 'object' ? payload.reason : undefined
      if (reason === 'active') return t('failed.running')
      if (reason === 'open') return t('failed.open')
      if (reason === 'unknown') return t('failed.unknown')
      if (reason === 'refused' || reason === 'invalid-id' || reason === 'bad-request') return t('failed.refused')
      if (reason === 'unlink-failed' || reason === 'failed') return t('failed.partial')
      return t('failed.generic')
    }

    /**
     * Subscribe one component to the pending-confirmation store.
     *
     * @returns the current request, or `null`.
     */
    function useRequest() {
      return React.useSyncExternalStore(requestStore.subscribe, requestStore.getSnapshot)
    }

    /**
     * One menu row.
     *
     * The row closes the menu before asking, so the dialog it opens is not
     * stacked behind an open menu layer.
     *
     * @param props - the row identity, the menu's open-state hook, and the
     *   plugin's request callback.
     * @returns the menu item.
     */
    function DeleteSessionMenuItem({ sessionId, displayTitle, useMenuOpenState, requestDelete, t }) {
      const [, setMenuOpen] = useMenuOpenState()
      return h(
        primitives.MenuItemButton,
        {
          separatorBefore: true,
          icon: h(primitives.IconTrashOutlineRegular, { size: 14 }),
          onSelect: () => {
            setMenuOpen(false)
            requestDelete(sessionId, displayTitle)
          },
        },
        t('menu.delete'),
      )
    }

    /**
     * The confirmation dialog.
     *
     * @param props - the pending request, the deletion hop, its settlement, and
     *   the locale seat.
     * @returns the open dialog, or `null`.
     */
    function DeleteConfirmDialog({ performDelete, settleDelete, t }) {
      const request = useRequest()
      if (request === null) return null
      return h(DeleteConfirmForm, { request, performDelete, settleDelete, t }, request.sessionId)
    }

    /** One request's dialog; its in-flight and error state die with it. */
    function DeleteConfirmForm({ request, performDelete, settleDelete, t }) {
      const [deleting, setDeleting] = React.useState(false)
      const [error, setError] = React.useState(null)

      const close = () => {
        if (deleting) return
        settleDelete()
      }

      const confirm = () => {
        setDeleting(true)
        setError(null)
        performDelete(request.sessionId)
          .then(() => {
            setDeleting(false)
            settleDelete()
          })
          .catch((reason) => {
            setDeleting(false)
            setError(reason instanceof Error ? reason.message : String(reason))
          })
      }

      return h(
        primitives.Modal,
        {
          open: true,
          onClose: close,
          closeLabel: t('close'),
          title: t('confirm.title'),
          description: t('confirm.desc', { title: request.displayTitle }),
          footer: h(React.Fragment, null, [
            h(primitives.Button, { variant: 'outline', disabled: deleting, onClick: close, key: 'cancel' }, t('cancel')),
            h(
              primitives.Button,
              { variant: 'outline', className: 'dsh-session-delete-danger', disabled: deleting, onClick: confirm, key: 'confirm' },
              t('confirm.action'),
            ),
          ]),
        },
        h('div', { className: 'dsh-session-delete-body' }, [
          deleting ? h('div', { className: 'dsh-session-delete-status', role: 'status', key: 'status' }, t('confirm.pending')) : null,
          error !== null ? h('div', { className: 'dsh-session-delete-error', role: 'alert', key: 'error' }, error) : null,
        ]),
      )
    }

    /**
     * Install both surfaces.
     *
     * The plugin waits for the Session controller alongside the slot service,
     * because the refresh that makes the deleted row disappear is part of the
     * operation rather than an afterthought.
     *
     * @param ctx - client root context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-session-delete: dictionaries')

      const style = document.createElement('style')
      style.setAttribute('data-dsh-session-delete', '')
      style.textContent = STYLESHEET
      ctx.effect(() => {
        document.head.append(style)
        return () => style.remove()
      }, 'dsh-session-delete: stylesheet')

      /** Open the confirmation for one row. */
      const requestDelete = (sessionId, displayTitle) => {
        requestStore.set({ sessionId, displayTitle })
      }

      /** Close the confirmation without deleting. */
      const settleDelete = () => {
        requestStore.set(null)
      }

      /**
       * Delete one session through the Host, then re-pull the Session baseline.
       *
       * @param sessionId - the session to delete.
       * @returns resolution once the Host removed it and the list caught up.
       * @throws when the Host refused or the request itself failed.
       */
      const performDelete = async (sessionId) => {
        const bind = ctx.locale.bind(NS)
        let response
        try {
          response = await fetch(DELETE_ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId }),
            credentials: 'same-origin',
          })
        } catch {
          throw new Error(bind('failed.generic'))
        }

        let payload = null
        try {
          payload = await response.json()
        } catch {
          // A body-less failure keeps its status-only verdict below.
        }

        if (!response.ok || payload === null || payload.ok !== true) {
          throw new Error(messageFor(payload, bind))
        }

        await ctx.sessions.refresh()
        return payload
      }

      ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register({
        name: 'sidebar.workspaces.session.menu.item',
        id: 'dsh-session-delete.menu',
        order: 500,
        locale: NS,
        inject: () => ({ requestDelete }),
      }, DeleteSessionMenuItem))

      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'dsh-session-delete.confirm',
        locale: NS,
        inject: () => ({ performDelete, settleDelete }),
      }, DeleteConfirmDialog))
    }

    exports.apply = apply
    exports.inject = ['slots', 'locale', 'sessions']
    return module.exports
  },
})
