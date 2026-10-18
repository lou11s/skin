const { request, uploadFile } = require('../../utils/request');
const { ensureLogin } = require('../../utils/auth');
const { API_BASE } = require('../../config');

const MIN_SCALE = 0.05; // 缩放下限：允许缩小到 cover-fit 的 0.05 倍（可缩到很小的贴纸效果）
const MAX_SCALE = 20;
// 遮罩版本：遮罩文件更新后必须修改此值，绕过微信图片缓存（服务端 CacheControl 30天）
const MASK_VERSION = '20261007b';

Page({
  data: {
    mode: 'crop',     // crop 按车型逐面裁剪 / direct 直接上传成品
    models: [],
    selectedModelId: null,
    selectedModelName: '',
    // direct 模式：本地临时图
    imagePath: '',
    // crop 模式：逐面配图
    faces: [],            // 后端返回的面列表 [{index,x,y,w,h}]
    facePhotos: [],       // 每面已选照片路径（与 faces 平行，空串 = 未配图）
    filledCount: 0,
    allFacesFilled: false,
    activeFace: -1,
    activeLayerIdx: -1,  // 当前选中的图层下标（数组末尾 = 最上层 = 选中层）
    layerThumbs: [],     // 当前面各图层缩略图路径（图层条显示）
    adjusting: false,    // 调整模式：点「调整图片」后才解锁手势（拖动/缩放/旋转）
    rotDeg: '',          // 旋转角度输入框显示值（度，0-360）
    facesLoading: false,
    previewMode: false,   // 整车预览模式：true 时隐藏当前面高亮，只看整体效果
    // 抠图素材库：在「我的抠图」页维护，配图时弹层选用
    cutouts: null,        // null=未加载过
    cutoutsLoading: false,
    cutoutPickerVisible: false,
    // 背景填充：预设色块（'' = 不填充，沿用默认淡灰底）
    bgSwatches: ['', '#ffffff', '#1c1c1e', '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#007aff', '#af52de', '#ff2d55', '#8e8e93'],
    activeBg: '',         // 当前面所选背景色
    bgCode: '',           // 颜色代码输入框显示值（如 #FF5500）
    // 饱和度 / 明度滑条的渐变端点随色相动态变化（色相条为固定彩虹渐变）
    // 注意必须带 background: 前缀，否则内联 style 解析不生效、滑条显示空白
    satBarStyle: 'background:linear-gradient(to right,#ffffff,#ff0000)',
    valBarStyle: 'background:linear-gradient(to right,#000000,#ff0000)',
    title: '',
    editMode: '',         // 作品修改模式：'' 新创作 / 'edit' 直接修改 / 'copy' 副本修改
    publishing: false,    // 发布中
    loading: true,        // 车型加载中
    loadError: '',        // 加载错误信息
    statusBarHeight: 20   // 自定义导航栏需让出状态栏高度（px）
  },

  onLoad() {
    console.log('[create] onLoad');
    // 自定义导航栏：读取状态栏高度
    const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.setData({ statusBarHeight: win.statusBarHeight || 20 });
    // 取色滑条初始状态（红 = h0 s1 v1），与 data 里的渐变默认值一致
    this.bgHue = 0;
    this.bgSat = 1;
    this.bgVal = 1;
    this.loadCarModels();
    // 抠图库预加载：第 3 步弹层秒开
    this.loadCutouts();
  },

  onShow() {
    // 非 tab 页（navigateTo 进入）不显示 tabBar，无需隐藏
    // 作品修改 / 开始创作均经 storage 传参，每次进入都检查
    const editSkin = wx.getStorageSync('edit_skin');
    if (editSkin && editSkin.id) {
      wx.removeStorageSync('edit_skin');
      this.beginEdit(editSkin);
      return;
    }
    // 「开始创作」：从作品列表进入时重置为全新创作
    if (wx.getStorageSync('create_reset')) {
      wx.removeStorageSync('create_reset');
      this.exitEdit();
      this.setData({ title: '', mode: 'crop' });
      if (!this.data.loading && this.data.selectedModelId) {
        this.loadFaces(this.data.selectedModelId);
      }
    }
  },

  loadCarModels() {
    request('/car-models').then((models) => {
      const list = models || [];
      // 作品修改：选作品车型并恢复设计数据（onShow 中 beginEdit 已写入 editSkinId）
      if (this.editSkinId) {
        this.loadSkinForEdit(list);
        return;
      }
      const first = list[0];
      this.setData({
        models: list,
        selectedModelId: first ? first.id : null,
        selectedModelName: first ? first.name : '',
        loading: false,
        loadError: ''
      });
      if (first && this.data.mode === 'crop') {
        this.loadFaces(first.id);
      }
    }).catch((err) => {
      console.error('[create] car-models error:', err);
      this.setData({ loading: false, loadError: '车型加载失败，请下拉刷新重试' });
    });
  },

  onReady() {
    this.ensureHiddenCanvases();
  },

  // ==================== 车型 ====================

  switchModel(e) {
    const id = Number(e.currentTarget.dataset.id);
    const model = this.data.models.find((m) => m.id === id);
    if (!model || id === this.data.selectedModelId) return;
    this.setData({
      selectedModelId: id,
      selectedModelName: model.name
    });
    // 裁剪模式：面列表随车型变化，全部重置
    if (this.data.mode === 'crop') {
      this.loadFaces(id);
    }
  },

  // ==================== 作品修改（编辑模式） ====================

  /**
   * 进入作品修改：edit='edit' 直接修改（保存覆盖原作品）/ 'copy' 生成副本修改（保存为新作品）
   * 由 mine 页经 storage 传参触发（tab 页无法带 query）
   */
  beginEdit(editSkin) {
    this.editSkinId = editSkin.id;
    this.editMode = editSkin.edit === 'edit' ? 'edit' : 'copy';
    // 修改固定走逐面配图模式（设计数据只在此模式下产生）
    this.setData({ editMode: this.editMode, publishing: false, mode: 'crop' });
    // 车型尚未加载完成：loadCarModels 完成后按 editSkinId 自动接管
    if (this.data.loading) return;
    if (this.data.models.length) this.loadSkinForEdit(this.data.models);
  },

  /**
   * 加载作品详情并恢复到编辑器：校验设计数据，选作品车型；副本模式标题加"（副本）"
   */
  loadSkinForEdit(models) {
    request('/skins/' + this.editSkinId).then((detail) => {
      let design = null;
      try { design = detail.designData ? JSON.parse(detail.designData) : null; } catch (e) { design = null; }
      const model = (models || []).find((m) => m.id === detail.carModelId);
      // 直传作品无设计数据 / 车型已下架：退回新创作
      if (!design || !design.faces || !model) {
        wx.showToast({ title: '该作品不支持修改', icon: 'none' });
        this.exitEdit();
        this.setData({ loading: false, loadError: '' });
        const first = (models || [])[0];
        if (first && this.data.mode === 'crop') this.loadFaces(first.id);
        return;
      }
      this.editDesign = design;
      let title = detail.title || '';
      if (this.editMode === 'copy') title = (title + '（副本）').slice(0, 60);
      this.setData({
        models: models || [],
        selectedModelId: model.id,
        selectedModelName: model.name,
        title: title,
        loading: false,
        loadError: ''
      });
      this.loadFaces(model.id);
    }).catch((err) => {
      console.error('[create] load skin for edit error:', err);
      this.setData({ loading: false, loadError: '作品加载失败，请返回重试' });
    });
  },

  /**
   * 从设计数据恢复编辑器状态：每面底色 + 每层图片与变换。
   * 图层 path 直接用持久化 URL（发布时 http 开头的层跳过上传，实现图片复用）
   */
  restoreDesign() {
    const design = this.editDesign;
    if (!design) return;
    const faces = this.data.faces;
    const dFaces = design.faces || [];
    const loads = [];
    wx.showLoading({ title: '恢复设计中...', mask: true });
    for (let i = 0; i < faces.length && i < dFaces.length; i++) {
      const df = dFaces[i] || {};
      this.faceBgs[i] = df.bg || '';
      const layers = df.layers || [];
      this.faceLayers[i] = this.faceLayers[i] || [];
      for (const l of layers) {
        if (!l || !l.url) continue;
        // 先同步占位保持层序，图片异步加载后补引用
        const layer = { path: l.url, img: null, imgW: l.imgW || 0, imgH: l.imgH || 0,
          scale: l.scale || 1, tx: l.tx || 0, ty: l.ty || 0, rot: l.rot || 0 };
        this.faceLayers[i].push(layer);
        loads.push(new Promise((resolve) => {
          const img = this.composeCanvas.createImage();
          img.onload = () => {
            layer.img = img;
            if (!layer.imgW) layer.imgW = img.width;
            if (!layer.imgH) layer.imgH = img.height;
            resolve();
          };
          img.onerror = () => resolve(); // 容错：单层加载失败不阻塞整体恢复
          img.src = layer.path;
        }));
      }
    }
    Promise.all(loads).then(() => {
      wx.hideLoading();
      // 顶层路径驱动完成度 / 面缩略图 / 图层条
      const facePhotos = faces.map((_, i) => {
        const ls = this.faceLayers[i] || [];
        return ls.length ? ls[ls.length - 1].path : '';
      });
      const index = this.data.activeFace;
      const bg = (this.faceBgs && this.faceBgs[index]) || '';
      const top = index >= 0 && (this.faceLayers[index] || []).length
        ? this.faceLayers[index][this.faceLayers[index].length - 1] : null;
      const patch = Object.assign({
        facePhotos,
        activeBg: bg,
        bgCode: bg ? bg.toUpperCase() : '',
        rotDeg: top ? String(this.layerAngleDeg(top)) : ''
      }, this.fillState(facePhotos), this.syncLayerThumbs(index), this.syncBgBars(bg));
      this.setData(patch);
      this.renderActiveFace();
      this.renderOverview();
      wx.nextTick(() => this.initBarRects());
      wx.showToast({
        title: this.editMode === 'edit' ? '已载入原设计，可继续修改' : '已载入副本，保存后生成新作品',
        icon: 'none', duration: 2000
      });
    });
  },

  /**
   * 退出编辑状态（不清画布内容，配合 loadFaces 重置为全新创作）
   */
  exitEdit() {
    this.editSkinId = null;
    this.editMode = '';
    this.editDesign = null;
    this.setData({ editMode: '' });
  },

  /**
   * 取消修改：放弃当前编辑状态，回到全新创作
   */
  cancelEdit() {
    wx.showModal({
      title: '取消修改',
      content: '放弃当前修改内容，回到全新创作？',
      confirmText: '确定',
      confirmColor: '#e54d42',
      success: (r) => {
        if (!r.confirm) return;
        this.exitEdit();
        this.setData({ title: '' });
        if (this.data.selectedModelId) this.loadFaces(this.data.selectedModelId);
      }
    });
  },

  /**
   * 返回"我的作品"页：tab 页无原生返回按钮，顶部自定义返回
   * 有未保存内容（已配图 / 编辑中）时先确认，避免误触丢失
   */
  goBack() {
    const hasContent = this.editSkinId
      || this.data.imagePath
      || (this.data.facePhotos || []).some((p) => p);
    if (!hasContent) {
      wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/mine/mine' }) });
      return;
    }
    wx.showModal({
      title: '离开创作',
      content: '当前修改尚未保存，离开后将丢失，确定离开吗？',
      confirmText: '离开',
      confirmColor: '#e54d42',
      success: (r) => {
        if (r.confirm) wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/mine/mine' }) });
      }
    });
  },

  // ==================== 逐面配图（crop 模式） ====================

  loadFaces(modelId) {
    this.faceLayers = [];   // 每面图层数组：[{path,img,imgW,imgH,scale,tx,ty,rot}]，末尾 = 最上层
    this.faceMaskImages = [];
    this.faceBgs = [];
    this.fullMaskImage = null;
    this.gesture = null;
    // 取色滑条面板随 wx:if 卸载，位置缓存必须失效
    this.barRects = null;
    // facesLoading 会卸载编辑器画布与整车预览画布节点，缓存引用必须失效
    this.editorNode = null;
    this.editorCtx = null;
    this.view = null;
    this.overviewCanvas = null;
    this.overviewCtx = null;
    this.overviewW = 0;
    this.overviewH = 0;
    this.overviewDpr = 1;
    this.setData(Object.assign({
      facesLoading: true,
      faces: [],
      facePhotos: [],
      filledCount: 0,
      allFacesFilled: false,
      activeFace: -1,
      activeLayerIdx: -1,
      layerThumbs: [],
      adjusting: false,
      rotDeg: '',
      previewMode: false,
      activeBg: '',
      bgCode: ''
    }, this.syncBgBars('')));
    this.ensureHiddenCanvases()
      .then(() => request('/car-models/' + modelId + '/faces'))
      .then((faces) => {
        const list = faces || [];
        this.faceLayers = list.map(() => []);
        // setData 回调在渲染完成后触发，此时 #faceCanvas 与 #overviewCanvas 才真正存在
        this.setData({
          faces: list,
          facePhotos: list.map(() => ''),
          filledCount: 0,
          allFacesFilled: false,
          facesLoading: false,
          activeFace: list.length ? 0 : -1,
          activeLayerIdx: -1,
          layerThumbs: []
        }, () => {
          Promise.all([
            this.initOverviewCanvas(),
            this.loadFaceMasks(modelId, list.length),
            this.loadFullMask(modelId)
          ])
            .then(() => this.initEditorCanvas())
            .then(() => {
              this.renderActiveFace();
              this.renderOverview();
              // 恢复修改中的设计数据（车型一致时）；换车型视为重新设计，不再恢复
              if (this.editDesign) {
                if (this.editDesign.carModelId === modelId) {
                  this.restoreDesign();
                } else {
                  this.editDesign = null;
                }
              }
            });
        });
      })
      .catch(() => this.setData({ facesLoading: false }));
  },

  /**
   * 预加载每个面的形状遮罩图（用后端返回的原始栅格序号请求）
   */
  loadFaceMasks(modelId, count) {
    const loads = [];
    const faces = this.data.faces;
    for (let i = 0; i < count; i++) {
      loads.push(new Promise((resolve) => {
        if (!this.composeCanvas) {
          resolve();
          return;
        }
        const img = this.composeCanvas.createImage();
        const origIdx = (faces[i] && faces[i].index !== undefined) ? faces[i].index : i;
        img.onload = () => {
          this.faceMaskImages[i] = img;
          resolve();
        };
        img.onerror = () => resolve(); // 容错：缺遮罩时退化为矩形面
        img.src = API_BASE + '/car-models/' + modelId + '/faces/' + origIdx + '/mask?v=' + MASK_VERSION;
      }));
    }
    return Promise.all(loads);
  },

  /**
   * 预加载完整遮罩图（templates/mask 原图，整车 silhouette 用）
   * 与逐面 mask 合成相比，像素级一致，规避缺图/坐标错位
   */
  loadFullMask(modelId) {
    return new Promise((resolve) => {
      if (!this.composeCanvas) {
        resolve();
        return;
      }
      const img = this.composeCanvas.createImage();
      img.onload = () => {
        this.fullMaskImage = img;
        resolve();
      };
      img.onerror = () => resolve();
      img.src = API_BASE + '/car-models/' + modelId + '/full-mask?v=' + MASK_VERSION;
    });
  },

  selectFace(e) {
    this.activateFace(Number(e.currentTarget.dataset.index));
  },

  /**
   * 激活指定面：整车图点击选面共用。
   * 切面自动退出预览/调整模式，同步取色滑条与图层条；不自动弹选图，由用户自选照片或抠图素材
   */
  activateFace(index) {
    const bg = (this.faceBgs && this.faceBgs[index]) || '';
    // 切面中断进行中的手势
    this.gesture = null;
    this.setData(Object.assign({
      activeFace: index,
      previewMode: false,
      adjusting: false,
      activeBg: bg,
      bgCode: bg ? bg.toUpperCase() : ''
    }, this.syncBgBars(bg), this.syncLayerThumbs(index)));
    // 切换面时立即重绘整车预览高亮
    this.renderOverview();
    wx.nextTick(() => {
      this.initBarRects();
      this.initEditorCanvas().then(() => {
        this.renderActiveFace();
      });
    });
  },

  chooseFacePhoto() {
    const index = this.data.activeFace;
    if (index < 0) return;
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
        this.addLayerToFace(index, file.tempFilePath);
      }
    });
  },

  /**
   * 整车预览模式切换：预览时隐藏当前面高亮，只看已配图的整体效果
   */
  togglePreview() {
    this.setData({ previewMode: !this.data.previewMode }, () => {
      this.renderOverview();
    });
  },

  /**
   * 为指定面新增一个图层：一个面可叠加无数张照片 / 抠图，新层初始 cover-fit 满铺 + 居中
   */
  addLayerToFace(index, path) {
    if (!this.composeCanvas) {
      wx.showToast({ title: '画布初始化中，请稍后重试', icon: 'none' });
      return;
    }
    const img = this.composeCanvas.createImage();
    img.onload = () => {
      if (!this.faceLayers) this.faceLayers = [];
      if (!this.faceLayers[index]) this.faceLayers[index] = [];
      this.faceLayers[index].push({ path: path, img: img, imgW: img.width, imgH: img.height, scale: 1, tx: 0, ty: 0, rot: 0 });
      // facePhotos 保存顶层层路径，驱动完成度、面缩略图与"已配图"判断
      const facePhotos = this.data.facePhotos.slice();
      facePhotos[index] = path;
      // 新层未旋转，同步旋转角度输入框
      this.setData(Object.assign({ facePhotos, rotDeg: '0' }, this.fillState(facePhotos), this.syncLayerThumbs(index)));
      this.renderActiveFace();
      this.renderOverview();
      // 背景填充面板随 wx:if 首次出现，需重新量取取色滑条位置
      wx.nextTick(() => this.initBarRects());
    };
    img.onerror = () => {
      wx.showToast({ title: '图片加载失败，请换一张试试', icon: 'none' });
    };
    img.src = path;
  },

  /**
   * 替换指定图层内容（智能抠图结果替换所选层）：重置为 cover-fit 满铺 + 居中
   */
  replaceLayerImage(index, layerIdx, path) {
    if (!this.composeCanvas) {
      wx.showToast({ title: '画布初始化中，请稍后重试', icon: 'none' });
      return;
    }
    const img = this.composeCanvas.createImage();
    img.onload = () => {
      const layers = (this.faceLayers && this.faceLayers[index]) || [];
      const layer = layers[layerIdx];
      if (!layer) return;
      layer.path = path;
      layer.img = img;
      layer.imgW = img.width;
      layer.imgH = img.height;
      layer.scale = 1;
      layer.tx = 0;
      layer.ty = 0;
      layer.rot = 0;
      const facePhotos = this.data.facePhotos.slice();
      // 替换的是顶层时同步 facePhotos 显示路径；替换后 transform 重置，同步角度输入框
      if (layerIdx === layers.length - 1) facePhotos[index] = path;
      this.setData(Object.assign({ facePhotos, rotDeg: '0' }, this.syncLayerThumbs(index)));
      this.renderActiveFace();
      this.renderOverview();
    };
    img.onerror = () => {
      wx.showToast({ title: '图片加载失败，请换一张试试', icon: 'none' });
    };
    img.src = path;
  },

  /**
   * 同步图层条数据：当前面各层缩略图 + 选中层下标（数组末尾 = 最上层 = 选中层）
   */
  syncLayerThumbs(index) {
    const layers = (this.faceLayers && this.faceLayers[index]) || [];
    return {
      layerThumbs: layers.map((l) => l.path),
      activeLayerIdx: layers.length ? layers.length - 1 : -1
    };
  },

  /**
   * 点击图层条缩略图：选中该层并置顶（移到数组末尾），手势随后操作该层
   */
  selectLayer(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const index = this.data.activeFace;
    const layers = (this.faceLayers && this.faceLayers[index]) || [];
    if (index < 0 || idx < 0 || idx >= layers.length) return;
    if (idx === layers.length - 1) return; // 已是最上层（选中层）
    const layer = layers.splice(idx, 1)[0];
    layers.push(layer);
    const facePhotos = this.data.facePhotos.slice();
    facePhotos[index] = layer.path;
    // 换选中层后同步其旋转角度到输入框
    this.setData(Object.assign({ facePhotos, rotDeg: String(this.layerAngleDeg(layer)) }, this.syncLayerThumbs(index)));
    this.renderActiveFace();
    this.renderOverview();
  },

  /**
   * 长按删除图层：删光后该面视为未配图（仅剩底色仍算完成，可直接发布纯色面）
   */
  removeLayer(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const index = this.data.activeFace;
    const layers = (this.faceLayers && this.faceLayers[index]) || [];
    if (index < 0 || idx < 0 || idx >= layers.length) return;
    wx.showModal({
      title: '删除图层',
      content: '删除后不可恢复，确定删除这个图层吗？',
      confirmText: '删除',
      confirmColor: '#e54d42',
      success: (r) => {
        if (!r.confirm) return;
        layers.splice(idx, 1);
        const facePhotos = this.data.facePhotos.slice();
        facePhotos[index] = layers.length ? layers[layers.length - 1].path : '';
        // 删光后退出调整模式；否则换顶层为选中层并同步角度
        this.setData(Object.assign({
          facePhotos,
          adjusting: layers.length ? this.data.adjusting : false,
          rotDeg: layers.length ? String(this.layerAngleDeg(layers[layers.length - 1])) : ''
        }, this.fillState(facePhotos), this.syncLayerThumbs(index)));
        this.renderActiveFace();
        this.renderOverview();
      }
    });
  },

  /**
   * 当前操作层：当前面图层中的选中层（无则 null，手势对其不响应）
   */
  activeLayer() {
    const i = this.data.activeFace;
    const layers = (this.faceLayers && this.faceLayers[i]) || [];
    return layers[this.data.activeLayerIdx] || null;
  },

  // ==================== 调整模式 / 旋转控制 ====================

  /**
   * 调整模式开关：点「调整图片」解锁手势（单指拖动 / 双指缩放旋转），再点锁定
   */
  toggleAdjust() {
    const layer = this.activeLayer();
    if (!this.data.adjusting && !layer) {
      wx.showToast({ title: '请先添加照片', icon: 'none' });
      return;
    }
    const adjusting = !this.data.adjusting;
    // 退出调整模式时清掉进行中的手势
    if (!adjusting) this.gesture = null;
    const patch = { adjusting: adjusting };
    // 进入调整模式时把选中层当前角度同步到输入框
    if (adjusting && layer) patch.rotDeg = String(this.layerAngleDeg(layer));
    this.setData(patch);
  },

  /**
   * 当前层的旋转角度（度，规范到 0-360）
   */
  layerAngleDeg(layer) {
    return ((Math.round((layer.rot || 0) * 180 / Math.PI) % 360) + 360) % 360;
  },

  /**
   * 快捷旋转：±90° / 180°，在当前角度基础上叠加
   */
  rotateLayer90(e) {
    const layer = this.activeLayer();
    if (!layer) return;
    const deg = Number(e.currentTarget.dataset.deg);
    const next = (this.layerAngleDeg(layer) + deg + 360) % 360;
    layer.rot = next * Math.PI / 180;
    this.syncLayerRot(layer);
  },

  onRotInput(e) {
    this.setData({ rotDeg: e.detail.value });
  },

  /**
   * 旋转到输入的角度（支持任意数字，负角度自动换算）
   */
  applyRotDeg() {
    const layer = this.activeLayer();
    if (!layer) return;
    const raw = (this.data.rotDeg || '').trim();
    if (!raw) {
      wx.showToast({ title: '请输入角度，如 45', icon: 'none' });
      return;
    }
    const deg = Number(raw);
    if (isNaN(deg)) {
      wx.showToast({ title: '请输入数字角度，如 45', icon: 'none' });
      return;
    }
    layer.rot = deg * Math.PI / 180;
    this.syncLayerRot(layer);
  },

  /**
   * 应用旋转并同步输入框显示（规范化到 0-360）
   */
  syncLayerRot(layer) {
    const face = this.data.faces[this.data.activeFace];
    this.clampSlot(layer, face);
    this.setData({ rotDeg: String(this.layerAngleDeg(layer)) });
    this.renderActiveFace();
    this.renderOverview();
  },

  /**
   * 智能抠图（腾讯云数据万象）：选择人像 / 物品图案，自动去除背景
   * 结果为透明背景 PNG，裁剪到主体后替换当前选中的图层（重置为居中满铺）
   */
  smartCutout() {
    const index = this.data.activeFace;
    if (index < 0) return;
    const layer = this.activeLayer();
    if (!layer) {
      wx.showToast({ title: '请先添加照片', icon: 'none' });
      return;
    }
    wx.showActionSheet({
      itemList: ['抠出人像', '抠出物品 / 图案'],
      success: (res) => {
        this.doCutout(layer.path, res.tapIndex === 0 ? 'portrait' : 'product', this.data.activeLayerIdx);
      }
    });
  },

  // ==================== 抠图素材库（弹层选用） ====================

  /**
   * 弹层空态跳转「我的抠图」tab 准备素材
   */
  goCutoutTab() {
    this.setData({ cutoutPickerVisible: false });
    wx.switchTab({ url: '/pages/cutout/cutout' });
  },

  /**
   * 打开素材选择弹层：点「＋ 抠图素材」显示已有抠图供选择（素材在「我的抠图」页维护）
   */
  openCutoutPicker() {
    if (this.data.activeFace < 0) {
      wx.showToast({ title: '请先点击整车选择要配图的面', icon: 'none' });
      return;
    }
    this.setData({ cutoutPickerVisible: true });
    if (!this.data.cutouts) this.loadCutouts();
  },

  closeCutoutPicker() {
    this.setData({ cutoutPickerVisible: false });
  },

  /**
   * 加载抠图库列表（onLoad 预加载 + 弹层兜底刷新）
   */
  loadCutouts() {
    this.setData({ cutoutsLoading: true });
    request('/cutouts')
      .then((list) => this.setData({ cutouts: list || [], cutoutsLoading: false }))
      .catch(() => this.setData({ cutoutsLoading: false }));
  },

  /**
   * 选用素材到当前面：裁掉透明边后作为新图层；同一个素材可反复选用、多张叠加
   */
  useCutout(e) {
    const id = Number(e.currentTarget.dataset.id);
    const item = (this.data.cutouts || []).find((c) => c.id === id);
    const index = this.data.activeFace;
    if (!item) return;
    if (index < 0) {
      wx.showToast({ title: '请先选中要配图的面', icon: 'none' });
      return;
    }
    if (!this.composeCanvas) {
      wx.showToast({ title: '画布初始化中，请稍后重试', icon: 'none' });
      return;
    }
    this.setData({ cutoutPickerVisible: false });
    wx.showLoading({ title: '处理中...', mask: true });
    this.trimCutout(index, item.url, item.type, -1);
  },

  /**
   * 长按删除素材：删记录 + COS 对象（已配到面上的照片是临时文件，不受影响）
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
  },

  doCutout(path, type, layerIdx) {
    const index = this.data.activeFace;
    wx.showLoading({ title: '抠图中...', mask: true });
    uploadFile(path, '/tools/matting', { type: type })
      .then((res) => {
        if (!res || !res.url) {
          wx.hideLoading();
          wx.showToast({ title: '抠图失败，请重试', icon: 'none' });
          return;
        }
        // layerIdx >= 0 替换该图层，否则为当前面新增一个图层
        this.trimCutout(index, res.url, type, layerIdx);
      })
      .catch(() => {
        wx.hideLoading();
      });
  },

  /**
   * 裁掉抠图结果的透明边缘（主体包围盒 + 1% 边距），导出临时 PNG
   * layerIdx >= 0：替换该图层；否则为当前面新增一个图层
   */
  trimCutout(index, url, type, layerIdx) {
    const img = this.composeCanvas.createImage();
    img.onload = () => {
      const W = img.width;
      const H = img.height;
      const cctx = this.composeCanvas.getContext('2d');
      this.composeCanvas.width = W;
      this.composeCanvas.height = H;
      cctx.setTransform(1, 0, 0, 1, 0, 0);
      cctx.clearRect(0, 0, W, H);
      cctx.drawImage(img, 0, 0);
      // 扫描 alpha 通道找主体包围盒
      let minX = W, minY = H, maxX = -1, maxY = -1;
      const data = cctx.getImageData(0, 0, W, H).data;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (data[(y * W + x) * 4 + 3] > 8) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      wx.hideLoading();
      if (maxX < 0) {
        // 结果为全透明：按来源提示（plain = 用户上传的免抠图本就全透明）
        wx.showToast({
          title: type === 'plain' ? '图片是完全透明的，无法使用' : (type === 'portrait' ? '未识别到人像，试试「抠出物品 / 图案」' : '未识别到主体，试试「抠出人像」'),
          icon: 'none'
        });
        return;
      }
      const pad = Math.round(Math.max(W, H) * 0.01) + 4;
      minX = Math.max(0, minX - pad);
      minY = Math.max(0, minY - pad);
      maxX = Math.min(W - 1, maxX + pad);
      maxY = Math.min(H - 1, maxY + pad);
      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      // 裁剪到 workCanvas 并导出临时文件（小程序 Canvas 2D 节点须用 wx.canvasToTempFilePath）
      this.workCanvas.width = bw;
      this.workCanvas.height = bh;
      const wctx = this.workCanvas.getContext('2d');
      wctx.setTransform(1, 0, 0, 1, 0, 0);
      wctx.clearRect(0, 0, bw, bh);
      wctx.drawImage(this.composeCanvas, minX, minY, bw, bh, 0, 0, bw, bh);
      wx.canvasToTempFilePath({
        canvas: this.workCanvas,
        fileType: 'png',
        quality: 1,
        success: (r) => {
          // layerIdx >= 0：替换该图层；否则新增图层（一个面可叠加无数张抠图）
          if (layerIdx >= 0) {
            this.replaceLayerImage(index, layerIdx, r.tempFilePath);
          } else {
            this.addLayerToFace(index, r.tempFilePath);
          }
        },
        fail: () => wx.showToast({ title: '抠图结果导出失败', icon: 'none' })
      }, this);
    };
    img.onerror = () => {
      wx.hideLoading();
      wx.showToast({ title: '抠图结果加载失败', icon: 'none' });
    };
    img.src = url;
  },

  // ==================== 编辑器画布 ====================

  /**
   * 隐藏合成画布（最终 1024 成品 + 逐面临时工作区）
   */
  ensureHiddenCanvases(attempt) {
    if (this.hiddenReady) return Promise.resolve();
    const tries = attempt || 0;
    return new Promise((resolve) => {
      const query = wx.createSelectorQuery();
      query.select('#composeCanvas').fields({ node: true });
      query.select('#workCanvas').fields({ node: true });
      query.exec((res) => {
        if (res && res[0] && res[0].node) {
          this.composeCanvas = res[0].node;
          this.composeCanvas.width = 1024;
          this.composeCanvas.height = 1024;
        }
        if (res && res[1] && res[1].node) {
          this.workCanvas = res[1].node;
        }
        this.hiddenReady = !!(this.composeCanvas && this.workCanvas);
        // onLoad 早于首帧渲染时取不到节点，重试等待
        if (!this.hiddenReady && tries < 5) {
          setTimeout(() => this.ensureHiddenCanvases(tries + 1).then(resolve), 100);
          return;
        }
        resolve();
      });
    });
  },

  initEditorCanvas() {
    if (this.editorNode) return Promise.resolve();
    return new Promise((resolve) => {
      wx.createSelectorQuery().select('#faceCanvas').fields({ node: true, size: true }).exec((res) => {
        if (!res || !res[0] || !res[0].node) {
          resolve();
          return;
        }
        const node = res[0].node;
        const dpr = wx.getWindowInfo().pixelRatio;
        node.width = res[0].width * dpr;
        node.height = res[0].height * dpr;
        this.editorNode = node;
        this.editorCtx = node.getContext('2d');
        this.editorDpr = dpr;
        this.renderActiveFace();
        resolve();
      });
    });
  },

  /**
   * 初始化整车预览画布（可见 canvas，显示所有面形状并高亮当前面）
   */
  initOverviewCanvas() {
    if (this.overviewCanvas) return Promise.resolve();
    return new Promise((resolve) => {
      wx.createSelectorQuery().select('#overviewCanvas').fields({ node: true, size: true }).exec((res) => {
        if (!res || !res[0] || !res[0].node) {
          resolve();
          return;
        }
        const node = res[0].node;
        const dpr = wx.getWindowInfo().pixelRatio;
        node.width = res[0].width * dpr;
        node.height = res[0].height * dpr;
        this.overviewCanvas = node;
        this.overviewCtx = node.getContext('2d');
        this.overviewDpr = dpr;
        this.overviewW = res[0].width;
        this.overviewH = res[0].height;
        resolve();
      });
    });
  },

  /**
   * 渲染整车预览：
   * 1) 把所有面 mask 合并成整车 silhouette 作浅灰底，提供"车型"上下文
   * 2) 已配图的面：直接显示用户上传的图片（被 mask 限制形状，应用 slot 缩放/平移）
   * 3) 当前面额外画红色描边突出位置（不论是否已配图）
   */
  renderOverview() {
    const canvas = this.overviewCanvas;
    const ctx = this.overviewCtx;
    if (!canvas || !ctx || !this.data.faces.length) return;
    const dpr = this.overviewDpr;
    const dispW = this.overviewW;
    const dispH = this.overviewH;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const faces = this.data.faces;
    // 计算整车实际包围盒（最小起点 + 最大终点），避免负坐标面被裁掉
    let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
    for (const f of faces) {
      if (f.x < minX) minX = f.x;
      if (f.y < minY) minY = f.y;
      if (f.x + f.w > maxX) maxX = f.x + f.w;
      if (f.y + f.h > maxY) maxY = f.y + f.h;
    }
    const carW = maxX - minX;
    const carH = maxY - minY;
    if (!carW || !carH) return;
    const scale = Math.min(dispW / carW, dispH / carH) * 0.92;
    const ox = (dispW - carW * scale) / 2 - minX * scale;
    const oy = (dispH - carH * scale) / 2 - minY * scale;
    // 供整车图点击选面反算坐标使用
    this.overviewTransform = { scale: scale, ox: ox, oy: oy };

    const wctx = this.workCanvas && this.workCanvas.getContext('2d');
    const active = this.data.activeFace;
    const facePhotos = this.data.facePhotos;

    // ---------- 1) 整车 silhouette 作浅灰底 ----------
    // 直接用 templates/mask 完整遮罩图作 silhouette，与原遮罩资产像素级一致，
    // 规避逐面 mask 缺图或坐标错位导致的形状偏差
    if (wctx && this.fullMaskImage) {
      const SIL = 1024;
      this.workCanvas.width = SIL;
      this.workCanvas.height = SIL;
      wctx.setTransform(1, 0, 0, 1, 0, 0);
      wctx.clearRect(0, 0, SIL, SIL);
      wctx.drawImage(this.fullMaskImage, 0, 0);
      wctx.globalCompositeOperation = 'source-in';
      wctx.fillStyle = '#9a9a9f';
      wctx.fillRect(0, 0, SIL, SIL);
      wctx.globalCompositeOperation = 'source-over';
      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.drawImage(this.workCanvas, 0, 0, SIL, SIL, ox, oy, SIL * scale, SIL * scale);
      ctx.restore();
    }

    // ---------- 2) 已配图的面：照片或底色（mask 限制形状） ----------
    // 当前面放最后画，避免被其他面遮盖
    const order = faces.map((_, i) => i).filter((i) => !!facePhotos[i] || !!(this.faceBgs || [])[i]);
    if (active >= 0 && order.indexOf(active) >= 0) {
      order.splice(order.indexOf(active), 1);
      order.push(active);
    }
    for (const i of order) {
      const face = faces[i];
      const mask = this.faceMaskImages[i];
      const layers = (this.faceLayers && this.faceLayers[i]) || [];
      const dx = face.x * scale + ox;
      const dy = face.y * scale + oy;
      const dw = face.w * scale;
      const dh = face.h * scale;
      if (!mask || !wctx) {
        ctx.save();
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = '#34c759';
        ctx.fillRect(dx, dy, dw, dh);
        ctx.restore();
        continue;
      }
      if (!layers.length) {
        // 仅设底色的面：mask 形状填所选颜色
        this.fillMaskOnWork(face.w, face.h, mask, this.faceBgs[i]);
        ctx.drawImage(this.workCanvas, 0, 0, face.w, face.h, dx, dy, dw, dh);
        continue;
      }
      // 在 workCanvas 上逐层绘制（数组顺序即层叠顺序）+ destination-in mask 限制形状
      this.workCanvas.width = face.w;
      this.workCanvas.height = face.h;
      wctx.setTransform(1, 0, 0, 1, 0, 0);
      wctx.clearRect(0, 0, face.w, face.h);
      // 背景填充色铺在最底层，随后一并被 mask 裁成面形状
      const bg = this.faceBgs[i];
      if (bg) {
        wctx.fillStyle = bg;
        wctx.fillRect(0, 0, face.w, face.h);
      }
      for (const layer of layers) {
        this.drawSlotPhoto(wctx, face, layer, layer.img);
      }
      wctx.globalCompositeOperation = 'destination-in';
      wctx.drawImage(mask, 0, 0, face.w, face.h);
      wctx.globalCompositeOperation = 'source-over';
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.drawImage(this.workCanvas, 0, 0, face.w, face.h, dx, dy, dw, dh);
      ctx.restore();
    }

    // ---------- 3) 当前面：红色描边突出位置（预览模式下隐藏，只看整体效果） ----------
    if (!this.data.previewMode && active >= 0 && active < faces.length) {
      const face = faces[active];
      const mask = this.faceMaskImages[active];
      const dx = face.x * scale + ox;
      const dy = face.y * scale + oy;
      const dw = face.w * scale;
      const dh = face.h * scale;
      if (mask && wctx) {
        // 黑色略放大版作外框
        const expand = Math.max(2, Math.min(dw, dh) * 0.06);
        this.fillMaskOnWork(face.w, face.h, mask, '#1a1a1a');
        ctx.save();
        ctx.globalAlpha = 1;
        ctx.drawImage(this.workCanvas, 0, 0, face.w, face.h,
          dx - expand, dy - expand, dw + 2 * expand, dh + 2 * expand);
        ctx.restore();
        // 红色中等放大版作描边外圈
        const expand2 = expand * 0.5;
        this.fillMaskOnWork(face.w, face.h, mask, '#ff3b30');
        ctx.save();
        ctx.globalAlpha = 1;
        ctx.drawImage(this.workCanvas, 0, 0, face.w, face.h,
          dx - expand2, dy - expand2, dw + 2 * expand2, dh + 2 * expand2);
        ctx.restore();
        // 当前面完全空白（无照片也无底色）时：在 silhouette 上叠加半透明红色填充作位置指示
        if (!facePhotos[active] && !((this.faceBgs || [])[active])) {
          this.fillMaskOnWork(face.w, face.h, mask, '#ff3b30');
          ctx.save();
          ctx.globalAlpha = 0.7;
          ctx.drawImage(this.workCanvas, 0, 0, face.w, face.h, dx, dy, dw, dh);
          ctx.restore();
        }
      } else {
        // 无 mask 兜底：红色描边矩形
        ctx.save();
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = '#ff3b30';
        ctx.lineWidth = 4;
        ctx.strokeRect(dx, dy, dw, dh);
        ctx.restore();
      }
    }
  },

  /**
   * 整车图点击选面：touch 坐标即画布局部坐标。
   * start 记录起点，end 时位移小、时长短才视为点击，避免滚动页面误触发
   */
  onOverviewTouchStart(e) {
    const t = e.touches;
    if (t && t.length === 1) {
      this.overviewTap = { x: t[0].x, y: t[0].y, t: Date.now() };
    }
  },

  onOverviewTouchEnd(e) {
    const tap = this.overviewTap;
    this.overviewTap = null;
    if (!tap) return;
    const c = e.changedTouches && e.changedTouches[0];
    if (!c) return;
    const dx = c.x - tap.x;
    const dy = c.y - tap.y;
    // 位移 12px 内且 400ms 内视为点击
    if (dx * dx + dy * dy < 144 && Date.now() - tap.t < 400) {
      this.pickFaceAt(c.x, c.y);
    }
  },

  /**
   * 画布显示坐标反算刀版坐标，命中包含该点的面（重叠时取面积最小者更精确）
   */
  pickFaceAt(x, y) {
    const tf = this.overviewTransform;
    const faces = this.data.faces;
    if (!tf || !faces.length) return;
    const lx = (x - tf.ox) / tf.scale;
    const ly = (y - tf.oy) / tf.scale;
    let hit = -1;
    let area = Infinity;
    faces.forEach((f, i) => {
      if (lx >= f.x && lx <= f.x + f.w && ly >= f.y && ly <= f.y + f.h) {
        const a = f.w * f.h;
        if (a < area) { area = a; hit = i; }
      }
    });
    if (hit >= 0) this.activateFace(hit);
  },

  /**
   * 在 workCanvas 上画指定颜色的 mask 形状：drawImage(mask) + source-in fillRect
   * 调用方负责 workCanvas 尺寸设置与 compositeOperation 复位
   */
  fillMaskOnWork(w, h, mask, color) {
    const wctx = this.workCanvas.getContext('2d');
    this.workCanvas.width = w;
    this.workCanvas.height = h;
    wctx.setTransform(1, 0, 0, 1, 0, 0);
    wctx.clearRect(0, 0, w, h);
    wctx.drawImage(mask, 0, 0, w, h);
    wctx.globalCompositeOperation = 'source-in';
    wctx.fillStyle = color;
    wctx.fillRect(0, 0, w, h);
    wctx.globalCompositeOperation = 'source-over';
  },

  /**
   * 按 slot 状态（缩放/旋转/平移）在面局部坐标系绘制照片：以照片中心为轴旋转
   * 编辑器（缩放到画布）与合成/整车预览（模板原坐标）统一使用
   */
  drawSlotPhoto(ctx, face, slot, img) {
    const s0 = Math.max(face.w / slot.imgW, face.h / slot.imgH);
    const s = s0 * slot.scale;
    const dw = slot.imgW * s;
    const dh = slot.imgH * s;
    const cx = face.w / 2 + slot.tx;
    const cy = face.h / 2 + slot.ty;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(slot.rot || 0);
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  },

  /**
   * 渲染当前面：包围盒裁剪 + 照片（缩放/旋转/平移）+ 面形状遮罩
   */
  renderActiveFace() {
    const node = this.editorNode;
    const ctx = this.editorCtx;
    const index = this.data.activeFace;
    if (!node || !ctx || index < 0 || !this.data.faces.length) return;
    const face = this.data.faces[index];
    const cw = node.width;
    const ch = node.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    // 模板(面局部)坐标 → 画布设备像素映射（0.8：面四周留出明显棋盘格空间，避免面顶满画布）
    const disp = Math.min(cw / face.w, ch / face.h) * 0.8;
    const ox = (cw - face.w * disp) / 2;
    const oy = (ch - face.h * disp) / 2;
    this.view = { disp, ox, oy };

    const layers = (this.faceLayers && this.faceLayers[index]) || [];
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, face.w * disp, face.h * disp);
    ctx.clip();
    // 面形状底色：用户选的背景填充色，未选时用淡灰（照片缩小到小于面时仍能看清面的位置与形状）
    if (this.faceMaskImages[index]) {
      const bg = (this.faceBgs && this.faceBgs[index]) || '#ededf0';
      this.fillMaskOnWork(face.w, face.h, this.faceMaskImages[index], bg);
      ctx.drawImage(this.workCanvas, ox, oy, face.w * disp, face.h * disp);
    }
    // 逐层绘制：数组顺序即层叠顺序，最后一层在最上
    for (const layer of layers) {
      // 面局部坐标 → 画布：平移 + 缩放后统一按层状态绘制（含旋转）
      ctx.save();
      ctx.translate(ox, oy);
      ctx.scale(disp, disp);
      this.drawSlotPhoto(ctx, face, layer, layer.img);
      ctx.restore();
    }
    ctx.restore();

    // 面形状：只保留该连通域内的像素
    const mask = this.faceMaskImages[index];
    if (mask) {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(mask, ox, oy, face.w * disp, face.h * disp);
      ctx.restore();
    }

    // 选中层虚线包围盒（仅调整模式显示；画在 mask 之后不被裁剪，便于看清当前操作的是哪一层）
    const sel = this.data.adjusting ? layers[this.data.activeLayerIdx] : null;
    if (sel) {
      const s0 = Math.max(face.w / sel.imgW, face.h / sel.imgH);
      const s = s0 * sel.scale;
      const hw = sel.imgW * s / 2 * disp;
      const hh = sel.imgH * s / 2 * disp;
      ctx.save();
      ctx.translate(ox + (face.w / 2 + sel.tx) * disp, oy + (face.h / 2 + sel.ty) * disp);
      ctx.rotate(sel.rot || 0);
      ctx.setLineDash([8, 5]);
      ctx.strokeStyle = '#ff3b30';
      ctx.lineWidth = 2;
      ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
      ctx.restore();
    }
  },

  // ==================== 背景填充 ====================

  /**
   * 量取三条取色滑条在页面坐标系中的位置（wx:if 出现后才有节点）
   * 用页面坐标而非视口坐标，避免页面滚动后错位
   */
  initBarRects() {
    const q = wx.createSelectorQuery();
    q.select('#hueBar').boundingClientRect();
    q.select('#satBar').boundingClientRect();
    q.select('#valBar').boundingClientRect();
    q.selectViewport().scrollOffset();
    q.exec((res) => {
      if (!res) return;
      const sl = res[3] ? res[3].scrollLeft : 0;
      const keys = ['h', 's', 'v'];
      const rects = this.barRects || {};
      for (let i = 0; i < 3; i++) {
        const r = res[i];
        if (r && r.width) rects[keys[i]] = { left: r.left + sl, width: r.width };
      }
      this.barRects = rects;
    });
  },

  /**
   * 预设色块：data-color 为空串表示取消填充，恢复默认淡灰底
   */
  pickBgSwatch(e) {
    const color = e.currentTarget.dataset.color || '';
    this.setFaceBg(color, true, this.syncBgBars(color));
  },

  /**
   * 把背景色反解为 HSV 同步到滑条，返回饱和度/明度滑条所需的渐变样式
   * 空串按默认红处理，与 data 里的初始渐变保持一致
   */
  syncBgBars(color) {
    const hsv = this.hexToHsv(color || '#ff0000');
    this.bgHue = hsv[0];
    this.bgSat = hsv[1];
    this.bgVal = hsv[2];
    return this.barStyles();
  },

  /**
   * 颜色代码输入：# 可省略，支持 3 位（#F60）或 6 位（#FF6600）hex
   */
  onBgCodeInput(e) {
    this.setData({ bgCode: e.detail.value });
  },

  applyBgCode() {
    const raw = (this.data.bgCode || '').trim();
    // 输入清空视同「无」，取消填充
    if (!raw) {
      this.setFaceBg('', true, this.syncBgBars(''));
      return;
    }
    const m = raw.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
    if (!m) {
      wx.showToast({ title: '颜色代码格式不对，如 #FF5500', icon: 'none' });
      return;
    }
    let hex = m[1];
    if (hex.length === 3) {
      hex = hex.split('').map((c) => c + c).join('');
    }
    const color = '#' + hex.toLowerCase();
    this.setFaceBg(color, true, this.syncBgBars(color));
  },

  /**
   * 取色滑条触摸：data-bar 指明改的是色相 h / 饱和度 s / 明度 v
   */
  onBarTouch(e) {
    const t = e.touches && e.touches[0];
    if (!t) return;
    // touchstart 时重新量取：异步返回后供本次拖动的 touchmove 使用，避免布局变化后错位
    if (e.type === 'touchstart') this.initBarRects();
    const key = e.currentTarget.dataset.bar;
    const r = this.barRects && this.barRects[key];
    if (!r) return;
    const x = (t.pageX !== undefined ? t.pageX : t.clientX) - r.left;
    const ratio = Math.max(0, Math.min(1, x / r.width));
    if (key === 'h') {
      this.bgHue = ratio * 360;
    } else if (key === 's') {
      this.bgSat = ratio;
    } else {
      this.bgVal = ratio;
    }
    // 拖动过程只重绘当前面，松手后再重绘整车预览
    this.setFaceBg(this.hsvToHex(this.bgHue, this.bgSat, this.bgVal), false, this.barStyles());
  },

  /**
   * 拖动结束：补一次整车预览重绘
   */
  onBarTouchEnd() {
    this.renderOverview();
  },

  /**
   * 一键把当前面的背景色应用到全部面
   */
  applyBgToAll() {
    const index = this.data.activeFace;
    if (index < 0) return;
    const color = (this.faceBgs && this.faceBgs[index]) || '';
    if (!color) {
      wx.showToast({ title: '请先为当前面选择背景色', icon: 'none' });
      return;
    }
    if (!this.faceBgs) this.faceBgs = [];
    const n = this.data.faces.length;
    for (let i = 0; i < n; i++) this.faceBgs[i] = color;
    this.setData(this.fillState(this.data.facePhotos));
    this.renderActiveFace();
    this.renderOverview();
    wx.showToast({ title: '已应用到全部 ' + n + ' 个面', icon: 'none' });
  },

  /**
   * 汇总完成度：已配图（照片或底色）的面数与是否全部完成
   */
  fillState(facePhotos) {
    const bgs = this.faceBgs || [];
    return {
      filledCount: facePhotos.filter((p, i) => !!(p || bgs[i])).length,
      allFacesFilled: facePhotos.length > 0 && facePhotos.every((p, i) => !!(p || bgs[i]))
    };
  },

  /**
   * 写入当前面背景色并重绘（成品在发布合成时才烘焙）
   * 未配图的面同样适用：编辑器/整车预览立即显示该色，发布时烘成纯色面
   * overview=false 时只重绘当前面，供拖动过程高频调用；patch 为需同步的滑条渐变
   */
  setFaceBg(color, overview, patch) {
    const index = this.data.activeFace;
    if (index < 0) return;
    if (!this.faceBgs) this.faceBgs = [];
    this.faceBgs[index] = color;
    this.setData(Object.assign({
      activeBg: color,
      bgCode: color ? color.toUpperCase() : ''
    }, this.fillState(this.data.facePhotos), patch));
    this.renderActiveFace();
    if (overview !== false) this.renderOverview();
  },

  /**
   * 饱和度 / 明度滑条的渐变端点：随当前色相与另一维度实时变化
   */
  barStyles() {
    return {
      satBarStyle: 'background:linear-gradient(to right,' +
        this.hsvToHex(this.bgHue, 0, this.bgVal) + ',' +
        this.hsvToHex(this.bgHue, 1, this.bgVal) + ')',
      valBarStyle: 'background:linear-gradient(to right,' +
        this.hsvToHex(this.bgHue, this.bgSat, 0) + ',' +
        this.hsvToHex(this.bgHue, this.bgSat, 1) + ')'
    };
  },

  /**
   * HSV → #rrggbb：不依赖 CSS hsl() 字符串，画布 fillStyle 与各端表现一致
   */
  hsvToHex(h, s, v) {
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let r = 0;
    let g = 0;
    let b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    const hex = (n) => {
      const t = Math.round((n + m) * 255).toString(16);
      return t.length === 1 ? '0' + t : t;
    };
    return '#' + hex(r) + hex(g) + hex(b);
  },

  /**
   * #rrggbb → [h, s, v]：点预设色块后反解，使滑条状态与该色一致
   */
  hexToHsv(hex) {
    const r = parseInt(hex.substr(1, 2), 16) / 255;
    const g = parseInt(hex.substr(3, 2), 16) / 255;
    const b = parseInt(hex.substr(5, 2), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d) {
      if (max === r) { h = ((g - b) / d) % 6; } else if (max === g) { h = (b - r) / d + 2; } else { h = (r - g) / d + 4; }
      h *= 60;
      if (h < 0) h += 360;
    }
    return [h, max ? d / max : 0, max];
  },

  // ==================== 手势：单指拖动 / 双指缩放 ====================

  onTouchStart(e) {
    // 调整模式才响应手势，未点「调整图片」时画布不拦截触摸
    if (!this.data.adjusting) return;
    const layer = this.activeLayer();
    if (!layer || !this.view) return;
    const t = e.touches;
    if (t.length === 1) {
      this.gesture = { type: 'pan', lx: t[0].x, ly: t[0].y };
    } else if (t.length >= 2) {
      // 记录两指方向角与图层当前角度的基准差：后续每帧用绝对角度计算，无累积误差
      const a0 = Math.atan2(t[1].y - t[0].y, t[1].x - t[0].x);
      this.gesture = { type: 'pinch', d0: this.touchDist(t), r0: layer.rot - a0 };
    }
  },

  onTouchMove(e) {
    const g = this.gesture;
    const layer = this.activeLayer();
    if (!g || !layer || !this.view) return;
    const t = e.touches;
    const face = this.data.faces[this.data.activeFace];
    if (g.type === 'pan' && t.length === 1) {
      layer.tx += (t[0].x - g.lx) * this.editorDpr / this.view.disp;
      layer.ty += (t[0].y - g.ly) * this.editorDpr / this.view.disp;
      g.lx = t[0].x;
      g.ly = t[0].y;
      this.clampSlot(layer, face);
      this.renderActiveFace();
    } else if (g.type === 'pinch' && t.length >= 2) {
      const d = this.touchDist(t);
      // 双指旋转：图层跟随两指方向角（绝对角度）
      const ang = Math.atan2(t[1].y - t[0].y, t[1].x - t[0].x);
      layer.rot = g.r0 + ang;
      // 缩放以图层中心为锚：旋转也围绕图层中心，中心不动，二者叠加自洽
      const center = { x: face.w / 2 + layer.tx, y: face.h / 2 + layer.ty };
      this.zoomSlotTo(layer, face, layer.scale * d / g.d0, center);
      g.d0 = d;
      this.renderActiveFace();
    }
  },

  onTouchEnd(e) {
    // 双指抬起一根：降级为单指拖动继续
    if (e.touches && e.touches.length === 1) {
      this.gesture = { type: 'pan', lx: e.touches[0].x, ly: e.touches[0].y };
      return;
    }
    if (this.gesture) {
      this.gesture = null;
      // 手势结束后把选中层最新角度同步到旋转输入框
      const layer = this.activeLayer();
      if (layer && this.data.adjusting) {
        this.setData({ rotDeg: String(this.layerAngleDeg(layer)) });
      }
    }
  },

  touchDist(t) {
    const dx = t[0].x - t[1].x;
    const dy = t[0].y - t[1].y;
    return Math.sqrt(dx * dx + dy * dy);
  },

  /**
   * 缩放到 newScale，保持 anchor（面局部坐标）处内容不动
   */
  zoomSlotTo(slot, face, newScale, anchor) {
    newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));
    const s0 = Math.max(face.w / slot.imgW, face.h / slot.imgH);
    const s = s0 * slot.scale;
    const px = (face.w - slot.imgW * s) / 2 + slot.tx;
    const py = (face.h - slot.imgH * s) / 2 + slot.ty;
    const qx = (anchor.x - px) / s;
    const qy = (anchor.y - py) / s;
    const s2 = s0 * newScale;
    slot.scale = newScale;
    slot.tx = anchor.x - qx * s2 - (face.w - slot.imgW * s2) / 2;
    slot.ty = anchor.y - qy * s2 - (face.h - slot.imgH * s2) / 2;
    this.clampSlot(slot, face);
  },

  /**
   * 限制平移范围（按旋转后的包围盒算）：
   * 照片放大后可一直平移到浏览自身任意部位，缩小后可推到贴边甚至部分超出面，
   * 上限取「面半径」与「照片包围盒半径」的较大值，保证照片始终与面有重叠、不会拖丢
   */
  clampSlot(slot, face) {
    const s0 = Math.max(face.w / slot.imgW, face.h / slot.imgH);
    const s = s0 * slot.scale;
    const hw = slot.imgW * s / 2;
    const hh = slot.imgH * s / 2;
    const c = Math.abs(Math.cos(slot.rot || 0));
    const sn = Math.abs(Math.sin(slot.rot || 0));
    const limX = Math.max(face.w / 2, c * hw + sn * hh);
    const limY = Math.max(face.h / 2, sn * hw + c * hh);
    slot.tx = Math.max(-limX, Math.min(limX, slot.tx));
    slot.ty = Math.max(-limY, Math.min(limY, slot.ty));
  },

  // ==================== 合成与发布 ====================

  /**
   * 隐藏画布合成 1024x1024 成品：逐面 照片×单面遮罩（避免相邻面包围盒重叠串色），再按包围盒位置贴到最终画布。
   * 仅发布时调用（合成图即成品，走 direct 通道上传）；页面内整体效果用整车预览画布实时渲染
   * 返回 null 表示画布未初始化或没有面
   */
  composite() {
    const faces = this.data.faces;
    if (!this.composeCanvas || !this.workCanvas || !faces.length) return Promise.resolve(null);
    const fctx = this.composeCanvas.getContext('2d');
    const wctx = this.workCanvas.getContext('2d');
    // trimCutout 会临时改写合成画布尺寸，重设回 1024 成品画布（赋值尺寸本身即清空画布）
    this.composeCanvas.width = 1024;
    this.composeCanvas.height = 1024;
    fctx.setTransform(1, 0, 0, 1, 0, 0);
    fctx.clearRect(0, 0, 1024, 1024);
    for (let i = 0; i < faces.length; i++) {
      const face = faces[i];
      const layers = (this.faceLayers && this.faceLayers[i]) || [];
      const bg = this.faceBgs[i];
      // 无图层也无底色、或缺遮罩的面跳过（保持透明）
      if (!this.faceMaskImages[i] || (!layers.length && !bg)) continue;
      // 工作画布重设为面尺寸（同时清空）
      this.workCanvas.width = face.w;
      this.workCanvas.height = face.h;
      wctx.setTransform(1, 0, 0, 1, 0, 0);
      // 背景填充色烘焙进成品：铺在所有图层之下，随后一并被 mask 裁成面形状
      if (bg) {
        wctx.fillStyle = bg;
        wctx.fillRect(0, 0, face.w, face.h);
      }
      // 逐层按数组顺序绘制（末尾 = 最上层）
      for (const layer of layers) {
        this.drawSlotPhoto(wctx, face, layer, layer.img);
      }
      wctx.globalCompositeOperation = 'destination-in';
      wctx.drawImage(this.faceMaskImages[i], 0, 0);
      wctx.globalCompositeOperation = 'source-over';
      // 贴回最终画布的面包围盒位置
      fctx.drawImage(this.workCanvas, 0, 0, face.w, face.h, face.x, face.y, face.w, face.h);
    }
    return new Promise((resolve) => {
      wx.canvasToTempFilePath({
        canvas: this.composeCanvas,
        fileType: 'png',
        quality: 1,
        success: (res) => resolve(res.tempFilePath),
        fail: () => resolve(null)
      }, this);
    });
  },

  // ==================== 标题 + 发布 ====================

  onTitleInput(e) {
    this.setData({ title: e.detail.value });
  },

  /**
   * 发布前把本地临时图层图上传 COS 换持久化 URL（http 开头的层已持久化，跳过）
   */
  uploadDesignLayers() {
    const uploads = [];
    for (const layers of this.faceLayers) {
      (layers || []).forEach((l) => {
        if (/^https?:/i.test(l.path)) return;
        uploads.push(uploadFile(l.path, '/tools/upload').then((res) => {
          if (res && res.url) l.path = res.url;
        }));
      });
    }
    return Promise.all(uploads);
  },

  /**
   * 序列化当前设计：车型 + 每面底色与每层变换（path 即持久化 URL），落库后支持作品修改
   */
  buildDesignData() {
    const faces = this.data.faces.map((_, i) => ({
      bg: (this.faceBgs || [])[i] || '',
      layers: (this.faceLayers[i] || []).map((l) => ({
        url: l.path, imgW: l.imgW, imgH: l.imgH, scale: l.scale, tx: l.tx, ty: l.ty, rot: l.rot
      }))
    }));
    return JSON.stringify({ carModelId: this.data.selectedModelId, faces: faces });
  },

  publish() {
    if (!this.canPublish() || this.data.publishing) return;
    ensureLogin()
      .then(() => {
        this.setData({ publishing: true });
        // 先上传图层原图持久化 → 序列化设计数据 → 合成成品上传
        return this.uploadDesignLayers().then(() => this.composite()).then((path) => {
          if (!path) {
            wx.showToast({ title: '请为每个面都上传照片', icon: 'none' });
            throw new Error('COMPOSITE_FAIL');
          }
          const designData = this.buildDesignData();
          // 直接修改：走 update 接口覆盖原作品；否则创建（副本修改此处生成新作品）
          if (this.editSkinId && this.editMode === 'edit') {
            return uploadFile(path, '/skins/' + this.editSkinId + '/update', {
              carModelId: String(this.data.selectedModelId),
              title: this.data.title,
              designData: designData
            });
          }
          return uploadFile(path, '/skins', {
            carModelId: String(this.data.selectedModelId),
            title: this.data.title,
            mode: 'direct',
            designData: designData
          });
        });
      })
      .then(() => {
        this.setData({ publishing: false });
        // 修改保存后回作品列表（直接修改已覆盖 / 副本修改已生成新作品）
        if (this.editSkinId) {
          const msg = this.editMode === 'edit' ? '修改已保存' : '副本已生成';
          this.exitEdit();
          wx.showToast({ title: msg, icon: 'success' });
          setTimeout(() => wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/mine/mine' }) }), 600);
          return;
        }
        wx.showToast({ title: '已保存到我的作品', icon: 'success' });
        // 发布后留在本页，可继续创作或从导航返回作品列表
      })
      .catch((err) => {
        this.setData({ publishing: false });
        if (err && err.message === 'COMPOSITE_FAIL') return;
        if (err && err.message && err.message.indexOf('登录') !== -1) {
          wx.showToast({ title: '登录失败，请重试', icon: 'none' });
        }
      });
  },

  canPublish() {
    const modelOk = !!(this.data.selectedModelId && this.data.title.trim());
    return !!(this.data.allFacesFilled && modelOk);
  }
});
