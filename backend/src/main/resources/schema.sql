-- 特斯拉皮肤小程序建表脚本（MySQL 8）
CREATE DATABASE IF NOT EXISTS model DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE model;

DROP TABLE IF EXISTS skin;
DROP TABLE IF EXISTS user_cutout;
DROP TABLE IF EXISTS car_model;
DROP TABLE IF EXISTS user;

-- 用户表
CREATE TABLE user (
  id          BIGINT       PRIMARY KEY AUTO_INCREMENT,
  openid      VARCHAR(64)  NOT NULL,
  unionid     VARCHAR(64)  NULL COMMENT '预留',
  nickname    VARCHAR(64)  NULL,
  avatar_url  VARCHAR(512) NULL,
  status      TINYINT      NOT NULL DEFAULT 1 COMMENT '预留：0封禁 1正常',
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_openid (openid)
) ENGINE = InnoDB COMMENT = '用户表';

-- 用户抠图库：上传原图抠图得到透明背景 PNG，配图时选用
CREATE TABLE user_cutout (
  id         BIGINT       PRIMARY KEY AUTO_INCREMENT,
  user_id    BIGINT       NOT NULL,
  type       VARCHAR(16)  NOT NULL DEFAULT 'portrait' COMMENT 'portrait 人像 / product 物品图案',
  cos_key    VARCHAR(255) NOT NULL COMMENT '透明背景 PNG 的 COS key，删除时清理对象',
  image_url  VARCHAR(512) NOT NULL COMMENT '透明背景 PNG 公有读 URL',
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user (user_id, id)
) ENGINE = InnoDB COMMENT = '用户抠图库';

-- 车型表（扩展新车型 = 插一行 + 放一个遮罩资产）
CREATE TABLE car_model (
  id          BIGINT       PRIMARY KEY AUTO_INCREMENT,
  code        VARCHAR(32)  NOT NULL COMMENT '车型编码，如 huanxinmodel3，同时作为 COS key 前缀',
  name        VARCHAR(64)  NOT NULL COMMENT '车型名，如 换新Model3',
  mask_path   VARCHAR(255) NOT NULL COMMENT '刀版遮罩 classpath 路径，如 mask/model3_mask.png',
  mask_width  INT          NOT NULL DEFAULT 1024,
  mask_height INT          NOT NULL DEFAULT 1024,
  preview_url VARCHAR(512) NULL COMMENT '车型预览图（遮罩白图 URL）',
  status      TINYINT      NOT NULL DEFAULT 1,
  sort_order  INT          NOT NULL DEFAULT 0,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_code (code)
) ENGINE = InnoDB COMMENT = '车型表';

-- 皮肤作品表
CREATE TABLE skin (
  id             BIGINT       PRIMARY KEY AUTO_INCREMENT,
  user_id        BIGINT       NOT NULL,
  car_model_id   BIGINT       NOT NULL,
  title          VARCHAR(128) NOT NULL,
  source_key     VARCHAR(255) NOT NULL COMMENT '用户原图 COS key',
  skin_key       VARCHAR(255) NOT NULL COMMENT '成品 PNG COS key',
  skin_url       VARCHAR(512) NOT NULL COMMENT '成品完整 URL（冗余，列表免拼接）',
  file_size      BIGINT       NULL COMMENT '成品字节数',
  design_data    MEDIUMTEXT   NULL COMMENT '创作设计数据 JSON（车型/每面每层变换与背景色），用于作品修改',
  status         TINYINT      NOT NULL DEFAULT 1 COMMENT '1正常 2已删除（我的作品列表不可见）',
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_user (user_id)
) ENGINE = InnoDB COMMENT = '皮肤作品表';

-- 初始车型数据：code/name 取基底照片文件名，mask 由 GenerateMask.java 预生成
INSERT INTO car_model (code, name, mask_path, mask_width, mask_height, sort_order) VALUES
('23年后model3',  '23年后model3',  'templates/mask/23年后model3_mask.png',  1024, 1024, 0),
('23年后model3P', '23年后model3P', 'templates/mask/23年后model3P_mask.png', 1024, 1024, 1),
('23年前model3',  '23年前model3',  'templates/mask/23年前model3_mask.png',  1024, 1024, 2),
('25年后modelY',  '25年后modelY',  'templates/mask/25年后modelY_mask.png',  1024, 1024, 3),
('25年后modelYL', '25年后modelYL', 'templates/mask/25年后modelYL_mask.png',  938,  938, 4),
('25年前modelY',  '25年前modelY',  'templates/mask/25年前modelY_mask.png',  1024, 1024, 5),
('modelS', 'modelS', 'templates/mask/modelS_mask.png', 1024, 1024, 6),
('modelX', 'modelX', 'templates/mask/modelX_mask.png', 1024, 1024, 7);
