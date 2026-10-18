package com.teslaskin.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("skin")
public class Skin {

    @TableId(type = IdType.AUTO)
    private Long id;

    private Long userId;

    private Long carModelId;

    private String title;

    /** 用户原图 COS key */
    private String sourceKey;

    /** 成品 PNG COS key */
    private String skinKey;

    /** 成品完整 URL（冗余） */
    private String skinUrl;

    private Long fileSize;

    /** 创作设计数据 JSON（车型/每面每层变换与背景色），用于作品修改；直传作品为空 */
    private String designData;

    /** 1 正常 / 2 已删除（我的作品列表不可见） */
    private Integer status;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;
}
