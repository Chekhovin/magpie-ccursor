const input = document.getElementById('enabled')
const status = document.getElementById('status')
const title = document.getElementById('title')
const description = document.getElementById('description')
const restart = document.getElementById('restart')
let options = {}
let saving = false
let loaded = false
let notice = ''
let lang = 'zh'

const words = {
  zh: {
    title: 'Cursor 中文界面',
    description: '汉化 Cursor 的侧栏、设置和 Agents 窗口。默认开启，不影响模型连接。',
    restart: '保存后等待自动接入完成，再完全退出并重新打开 Cursor。未匹配的版本会保留原界面，详情见插件日志。',
    on: '已开启', off: '已关闭', saving: '正在保存…',
    saved: '设置已保存。后台将更新汉化，请重启 Cursor 后查看。',
    failure: '保存失败，开关已恢复。请稍后重试。',
    loadFailure: '无法读取插件设置，请刷新 Magpie 页面后重试。',
  },
  en: {
    title: 'Cursor Chinese interface',
    description: 'Translate Cursor’s sidebar, settings and Agents Window. Enabled by default; model connections are unchanged.',
    restart: 'Wait for automatic setup, then fully quit and reopen Cursor. Unmatched versions keep their original interface; see plugin logs for details.',
    on: 'Enabled', off: 'Disabled', saving: 'Saving…',
    saved: 'Preference saved. The background service will update localization; reopen Cursor to see it.',
    failure: 'Could not save. The switch was restored; please try again later.',
    loadFailure: 'Could not read plugin options. Refresh the Magpie page and try again.',
  },
}
function render() {
  const text = words[lang]
  title.textContent = text.title
  description.textContent = text.description
  restart.textContent = text.restart
  input.setAttribute('aria-label', text.title)
  input.checked = options.localize !== false
  input.disabled = saving || !loaded
  status.textContent = text[notice] || (input.checked ? text.on : text.off)
}
function theme(value) { lang = /^zh/.test(value?.lang || '') ? 'zh' : 'en'; render() }

input.addEventListener('change', async () => {
  if (saving || !loaded) return
  const desired = input.checked
  saving = true; notice = 'saving'; input.disabled = true
  status.textContent = words[lang].saving
  try {
    // Read again so saving this toggle does not replace other plugin preferences.
    const latest = await magpie.options.get() || {}
    options = await magpie.options.set({ ...latest, localize: desired })
    notice = 'saved'
  } catch {
    notice = 'failure'
  } finally {
    // Magpie accepts at most one options write per second.
    render()
    setTimeout(() => {
      saving = false; render()
      // Reload only this panel: serving a hosted panel starts Magpie's new plugin host.
      if (notice === 'saved') window.location.reload()
    }, 1100)
  }
})

magpie.ready.then(async value => {
  theme(value || magpie.theme)
  magpie.onTheme?.(theme)
  try { options = await magpie.options.get() || {}; loaded = true; notice = '' }
  catch { notice = 'loadFailure' }
  render()
}).catch(() => { notice = 'loadFailure'; render() })
