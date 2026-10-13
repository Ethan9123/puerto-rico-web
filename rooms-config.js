// GitHub Pages 等静态镜像也连接同一房间服务；离线包保留本机多标签模式。
window.PR_ROOMS_URL = location.protocol === 'file:' ? '' :
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? location.origin : 'https://puerto-rico.try-board-game.uk');
