package com.teslaskin.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;

@Data
@ConfigurationProperties(prefix = "cos")
public class CosProperties {

    private String secretId;

    private String secretKey;

    private String bucket;

    /** 地域，如 ap-guangzhou */
    private String region;

    /** 可选自定义 CDN 域名，留空用默认桶域名 */
    private String urlPrefix;

    /** 预签名 URL 有效期（小时）；>0 时接口返回带签名临时链接（桶私有读场景）；0 = 直接返回明文 URL（桶公有读场景） */
    private long signedUrlExpireHours = 0;

    public boolean isConfigured() {
        return secretId != null && !secretId.isBlank()
                && secretKey != null && !secretKey.isBlank()
                && bucket != null && !bucket.isBlank()
                && region != null && !region.isBlank();
    }
}
