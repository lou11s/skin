const { request, uploadFile } = require('../../utils/request');
const { getToken } = require('../../utils/auth');

/**
 * 我的抠图（tabBar 第二项）：素材资产管理页
 * - 抠图：选照片 → 人像/物品 → 云端抠图入库
 * - 上传抠图：已抠好的透明 PNG 免抠直存（type=plain）
 * - 点击预览放大，长按删除
 * 创作页配图时点「＋ 抠图素材」从本页维护的素材库中选用
 */
Page({
  data: {
    loggedIn: false,
    cutouts: null,   // null = 尚未加载过
    loading: false,
    uploading: false
  },

  onShow() {
    const loggedIn = !!getToken();
    this.setData({ loggedIn, cutouts: loggedIn ? this.data.cutouts : null });
    if (loggedIn) this.loadCutouts();
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/login/login' });
  },

  loadCutouts() {
    this.setData({ loading: true });
    request('/cutouts')
      .then((list) => this.setData({ cutouts: list || [], loading: false }))
      .catch(() => this.setData({ loading: false }));
  },

  /**
   * 抠图：选任意照片 → 选人像/物品 → 云端抠图入库
   */
  cutoutNew() {
    if (this.data.uploading) return;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: (res) => {
        const file = res.tempFiles[0];
        if (file.size > 10 * 1024 * 1024) {
          wx.showToast({ title: '图片不能超过 10MB', icon: 'none' });
          return;
        }
        wx.showActionSheet({
          itemList: ['抠出人像', '抠出物品 / 图案'],
          success: (r) => {
            this.uploadToLibrary(file.tempFilePath, r.tapIndex === 0 ? 'portrait' : 'product');
          }
        });
      }
    });
  },

  /**
   * 上传抠图：已抠好的透明背景 PNG 免抠直存
   */
  uploadPlain() {
    if (this.data.uploading) return;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: (res) => {
        const file = res.tempFiles[0];
        if (file.size > 10 * 1024 * 1024) {
          wx.showToast({ title: '图片不能超过 10MB', icon: 'none' });
          return;
        }
        this.uploadToLibrary(file.tempFilePath, 'plain');
      }
    });
  },

  /**
   * 上传入库：portrait/product 云端抠图，plain 免抠直存；完成后列表置顶新素材
   */
  uploadToLibrary(path, type) {
    this.setData({ uploading: true });
    wx.showLoading({ title: type === 'plain' ? '上传中...' : '抠图中...', mask: true });
    uploadFile(path, '/cutouts', { type: type })
      .then((item) => {
        wx.hideLoading();
        this.setData({ cutouts: [item].concat(this.data.cutouts || []), uploading: false });
        wx.showToast({ title: '已添加到素材库', icon: 'none' });
      })
      .catch(() => {
        wx.hideLoading();
        this.setData({ uploading: false });
      });
  },

  /**
   * 点击预览放大
   */
  previewCutout(e) {
    const id = Number(e.currentTarget.dataset.id);
    const item = (this.data.cutouts || []).find((c) => c.id === id);
    if (!item) return;
    wx.previewImage({ urls: [item.url] });
  },

  /**
   * 长按删除：删记录 + COS 对象
   */
  removeCutout(e) {
    const id = Number(e.currentTarget.dataset.id);
    wx.showModal({
      title: '删除素材',
      content: '删除后不可恢复，确定删除吗？',
      confirmText: '删除',
      confirmColor: '#e54d42',
      success: (r) => {
        if (!r.confirm) return;
        request('/cutouts/' + id, { method: 'DELETE' })
          .then(() => {
            this.setData({ cutouts: (this.data.cutouts || []).filter((c) => c.id !== id) });
            wx.showToast({ title: '已删除', icon: 'none' });
          })
          .catch(() => {});
      }
    });
  }
});
