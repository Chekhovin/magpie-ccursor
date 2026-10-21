// The host owns credentials. This page only displays setup instructions.
magpie.ready.then(() => {
  document.getElementById('host-status').textContent = '已连接 Magpie 页面。桥接服务状态请查看插件日志或运行 status 命令。'
}).catch(() => {
  document.getElementById('host-status').textContent = '页面连接失败，请重新打开插件页面。'
})
