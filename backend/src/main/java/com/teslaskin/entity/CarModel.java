package com.teslaskin.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("car_model")
public class CarModel {

    @TableId(type = IdType.AUTO)
    private Long id;

    /** 车型编码，如 huanxinmodel3；同时作为 COS key 前缀 skins/{code}/ */
    private String code;

    /** 车型名，如 Model 3 */
    private String name;

    /** 刀版遮罩 classpath 路径，如 templates/mask/model3_mask.png */
    private String maskPath;

    private Integer maskWidth;

    private Integer maskHeight;

    /** 车型预览图 URL */
    private String previewUrl;

    /** 0 停用 1 启用 */
    private Integer status;

    private Integer sortOrder;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;
}
