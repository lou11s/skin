const { API_BASE } = require('../config');

/**
 * 统一请求封装：自动带 token；code!==0 时 reject；401 清 token 跳登录
 */
function request(path, options = {}) {
  const { method = 'GET', data, header = {} } = options;
  return new Promise((resolve, reject) => {
    wx.request({
      url: API_BASE + path,
      method,
      data,
      header: Object.assign(authHeader(), header),
      success(res) {
        if (res.statusCode === 401 || (res.data && res.data.code === 401)) {
          handleUnauthorized();
          reject(new Error(res.data && res.data.message ? res.data.message : '请先登录'));
          return;
        }
        if (res.data && res.data.code === 0) {
          resolve(res.data.data);
        } else {
          const msg = res.data && res.data.message ? res.data.message : '请求失败';
          wx.showToast({ title: msg, icon: 'none' });
          reject(new Error(msg));
        }
      },
      fail() {
        wx.showToast({ title: '网络开小差了，请重试', icon: 'none' });
        reject(new Error('网络错误'));
      }
    });
  });
}

/**
 * 上传文件封装（multipart）：filePath + 表单字段
 */
function uploadFile(filePath, path, formData = {}) {
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: API_BASE + path,
      filePath,
      name: 'file',
      formData,
      header: authHeader(),
      success(res) {
        if (res.statusCode === 401) {
          handleUnauthorized();
          reject(new Error('请先登录'));
          return;
        }
        let body = {};
        try { body = JSON.parse(res.data); } catch (e) { /* ignore */ }
        if (body.code === 0) {
          resolve(body.data);
        } else {
          const msg = body.message || '上传失败';
          wx.showToast({ title: msg, icon: 'none' });
          reject(new Error(msg));
        }
      },
      fail() {
        wx.showToast({ title: '网络开小差了，请重试', icon: 'none' });
        reject(new Error('网络错误'));
      }
    });
  });
}

function authHeader() {
  const token = wx.getStorageSync('token');
  return token ? { Authorization: 'Bearer ' + token } : {};
}

function handleUnauthorized() {
  wx.removeStorageSync('token');
  wx.removeStorageSync('user');
  wx.navigateTo({ url: '/pages/login/login' });
}

module.exports = { request, uploadFile };
