package com.teslaskin.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("`user`")
public class User {

    @TableId(type = IdType.AUTO)
    private Long id;

    private String openid;

    private String unionid;

    private String nickname;

    private String avatarUrl;

    /** 预留：0 封禁 1 正常 */
    private Integer status;

    /** 由数据库默认值填充 */
    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;
}
