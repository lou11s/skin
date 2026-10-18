package com.teslaskin.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 用户抠图库：上传原图抠图得到的透明背景 PNG
 */
@Data
@TableName("user_cutout")
public class UserCutout {

    @TableId(type = IdType.AUTO)
    private Long id;

    private Long userId;

    /** portrait 人像 / product 物品图案 */
    private String type;

    /** 透明背景 PNG 的 COS key，删除时清理对象 */
    private String cosKey;

    /** 透明背景 PNG 公有读 URL */
    private String imageUrl;

    /** 由数据库默认值填充 */
    private LocalDateTime createdAt;
}
