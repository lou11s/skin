package com.teslaskin.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;

@Data
@ConfigurationProperties(prefix = "tesla.wx")
public class WxProperties {

    private String appid;

    private String secret;

    /** 开发期 true：跳过 code2session，直接返回固定 mock 用户 */
    private boolean mockEnabled = false;
}
