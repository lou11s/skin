const { request } = require('./request');

/**
 * 登录态工具：token 存取 + 静默登录
 */
function getToken() {
  return wx.getStorageSync('token') || '';
}

function getUser() {
  return wx.getStorageSync('user') || null;
}

/**
 * 确保已登录：有 token 直接成功；否则 wx.login 换 code 调后端登录
 */
function ensureLogin() {
  return new Promise((resolve, reject) => {
    const token = getToken();
    if (token) {
      resolve(getUser());
      return;
    }
    wx.login({
      success(res) {
        if (!res.code) {
          reject(new Error('获取登录凭证失败'));
          return;
        }
        request('/auth/login', { method: 'POST', data: { code: res.code } })
          .then((data) => {
            wx.setStorageSync('token', data.token);
            wx.setStorageSync('user', data.user);
            resolve(data.user);
          })
          .catch(reject);
      },
      fail() {
        reject(new Error('微信登录失败'));
      }
    });
  });
}

function logout() {
  wx.removeStorageSync('token');
  wx.removeStorageSync('user');
}

module.exports = { getToken, getUser, ensureLogin, logout };
