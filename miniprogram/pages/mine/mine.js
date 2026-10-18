const { request } = require('../../utils/request');
const { getToken } = require('../../utils/auth');
const { formatDate } = require('../../utils/format');

Page({
  data: {
    skins: [],
    groups: [],
    page: 1,
    pages: 1,
    loadingMore: false,
    loggedIn: false
  },

  onShow() {
    // tabBar 两项：我的作品 / 我的抠图（原生底部导航，无需隐藏）
    this.setData({ loggedIn: !!getToken(), skins: [], groups: [], page: 1, pages: 1 });
    if (this.data.loggedIn) {
      this.loadMine(true);
    }
  },

  onReachBottom() {
    if (this.data.loadingMore || this.data.page >= this.data.pages) return;
    this.setData({ loadingMore: true });
    this.loadMine(false).finally(() => this.setData({ loadingMore: false }));
  },

  loadMine(reset) {
    const page = reset ? 1 : this.data.page + 1;
    this.setData({ page });
    return request('/skins/mine?page=' + page + '&size=10').then((data) => {
      const list = (data.list || []).map((s) => Object.assign({}, s, {
        createdAtText: formatDate(s.createdAt)
      }));
      const skins = reset ? list : this.data.skins.concat(list);
      this.setData({
        skins,
        groups: this.groupByCarModel(skins),
        pages: data.pages || 1
      });
    }).catch(() => {});
  },

  /**
   * 作品按车型分组：[{name, list, count}]
   */
  groupByCarModel(list) {
    const map = new Map();
    list.forEach((s) => {
      const name = s.carModelName || '未分类';
      if (!map.has(name)) map.set(name, []);
      map.get(name).push(s);
    });
    return Array.from(map).map(([name, items]) => ({
      name,
      list: items,
      count: items.length
    }));
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/login/login' });
  },

  goCreate() {
    // 开始创作：经 storage 通知创作页重置为全新创作（navigateTo 页面可带 query，此处沿用 storage 更稳妥）
    if (!getToken()) {
      wx.navigateTo({ url: '/pages/login/login' });
      return;
    }
    wx.setStorageSync('create_reset', true);
    wx.navigateTo({ url: '/pages/create/create' });
  },

  /**
   * 修改作品：直接修改原作品，保存后覆盖
   * 通过 storage 传参给创作页恢复设计；直传成品无设计数据不支持图层修改
   */
  editSkin(e) {
    this.startEdit(e, 'edit');
  },

  /**
   * 复制修改：载入原设计另存为新作品，原作品不受影响
   */
  editSkinCopy(e) {
    this.startEdit(e, 'copy');
  },

  startEdit(e, mode) {
    if (!getToken()) return;
    const id = Number(e.currentTarget.dataset.id);
    const skin = this.data.skins.find((s) => s.id === id);
    if (!skin) return;
    if (!skin.hasDesign) {
      wx.showToast({ title: '该作品无设计数据（旧版本创作），无法修改；重新创作即可', icon: 'none', duration: 2500 });
      return;
    }
    wx.setStorageSync('edit_skin', { id: id, edit: mode });
    wx.navigateTo({ url: '/pages/create/create' });
  },

  /**
   * 删除作品：二次确认后从列表移除
   */
  deleteSkin(e) {
    if (!getToken()) return;
    const id = Number(e.currentTarget.dataset.id);
    const skin = this.data.skins.find((s) => s.id === id);
    if (!skin) return;
    wx.showModal({
      title: '删除作品',
      content: '删除后不可恢复，确定删除「' + (skin.title || '该作品') + '」吗？',
      confirmText: '删除',
      confirmColor: '#e54d42',
      success: (r) => {
        if (!r.confirm) return;
        request('/skins/' + id, { method: 'DELETE' }).then(() => {
          wx.showToast({ title: '已删除', icon: 'success' });
          this.setData({ skins: [], groups: [], page: 1, pages: 1 });
          this.loadMine(true);
        }).catch(() => {});
      }
    });
  }
});
