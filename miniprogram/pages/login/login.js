const { ensureLogin } = require('../../utils/auth');

Page({
  data: {
    loading: false
  },

  async login() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      await ensureLogin();
      wx.showToast({ title: '登录成功', icon: 'success' });
      setTimeout(() => {
        const pages = getCurrentPages();
        if (pages.length > 1) {
          wx.navigateBack();
        } else {
          wx.switchTab({ url: '/pages/mine/mine' });
        }
      }, 600);
    } catch (e) {
      wx.showToast({ title: '登录失败，请重试', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  }
});
