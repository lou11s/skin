App({
  globalData: {
    user: null
  },

  onLaunch() {
    // 登录延迟到需要时再触发（如发布皮肤），避免启动时 wx.login 阻塞
  }
});
