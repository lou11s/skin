// API 基础地址
// 真机调试：必须用开发机的局域网 IP（手机与 Mac 同一 WiFi / 热点），localhost 指向手机自身
// IP 查看：ipconfig getifaddr en0；热点或路由器重新分配后需同步更新
// 上线前换成 HTTPS 备案域名，并在小程序后台配置 request/uploadFile/downloadFile 合法域名
const API_BASE = 'http://192.168.1.10:8080/api/v1';

module.exports = { API_BASE };
